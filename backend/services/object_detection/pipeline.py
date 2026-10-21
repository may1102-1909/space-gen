"""Keyframe detections -> 3D oriented boxes.

Stages: detect per keyframe -> lift each 2D box to 3D with a point z-buffer of splat centres ->
cluster across views (label + 3D proximity) -> fit yaw-only OBBs -> cross-label NMS.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Sequence

import numpy as np
from pydantic import BaseModel, Field

from models.contracts import DetectionInterpretation, MaskRegion, OrientedBoundingBox

from .colmap import ColmapModel
from .detectors import DEFAULT_LABELS, Detection2D, Detector2D, Frame
from .geometry import (
    View,
    fit_obb,
    front_depth_group,
    make_view,
    obb_iou,
    project,
    split_similarity,
    visible_in_view,
    yaw_axes,
)

logger = logging.getLogger(__name__)

ProgressFn = Callable[[float, str], None]
IDENTITY = tuple(float(v) for v in np.eye(4).ravel())


@dataclass(frozen=True)
class PipelineConfig:
    labels: Sequence[str] = DEFAULT_LABELS
    max_keyframes: int | None = 24
    max_points: int = 600_000
    floor_y: float = 0.0
    floor_band: float = 0.05  # points this close to the floor are ignored when lifting and fitting
    min_box_points: int = 30
    depth_gap: float = 0.15
    depth_percentiles: tuple[float, float] = (5.0, 95.0)
    cluster_gap: float = 0.10  # max distance between lifted point extents of one object seen in two views
    min_views: int = 2  # clusters seen in fewer keyframes are treated as false positives
    min_visible_points: int = 25
    min_visible_fraction: float = 0.3  # of the object's points that must be unoccluded
    min_inframe_fraction: float = 0.7
    fit_trim: float = 1.0  # percentile trimmed from each end of the OBB extents
    nms_iou: float = 0.5
    feather: float = 0.05


@dataclass
class Lift:
    view: int
    label: str
    score: float
    idx: np.ndarray
    centre: np.ndarray
    lo: np.ndarray
    hi: np.ndarray


@dataclass
class Cluster:
    label: str
    lifts: list[Lift] = field(default_factory=list)
    lo: np.ndarray | None = None
    hi: np.ndarray | None = None

    @property
    def views(self) -> set[int]:
        return {lift.view for lift in self.lifts}

    def add(self, lift: Lift) -> None:
        self.lifts.append(lift)
        self.lo = lift.lo.copy() if self.lo is None else np.minimum(self.lo, lift.lo)
        self.hi = lift.hi.copy() if self.hi is None else np.maximum(self.hi, lift.hi)


class DetectionResult(BaseModel):
    detections: list[DetectionInterpretation]
    maskRegions: list[MaskRegion]
    diagnostics: dict[str, Any] = Field(default_factory=dict)


def aabb_gap(lo_a: np.ndarray, hi_a: np.ndarray, lo_b: np.ndarray, hi_b: np.ndarray) -> float:
    """Euclidean distance between two axis-aligned boxes (0 when they overlap)."""
    d = np.maximum(0.0, np.maximum(lo_a - hi_b, lo_b - hi_a))
    return float(np.linalg.norm(d))


def lift_detection(
    view: View,
    view_index: int,
    det: Detection2D,
    points: np.ndarray,
    proj: tuple[np.ndarray, np.ndarray, np.ndarray],
    candidates: np.ndarray,
    cfg: PipelineConfig,
) -> Lift | None:
    """Back-project the visible, non-floor points inside a 2D box using robust depth percentiles."""
    u, v, z = proj
    cam = view.camera
    x0, y0, x1, y1 = det.box
    inside = (
        candidates & (u >= x0 * cam.width) & (u <= x1 * cam.width) & (v >= y0 * cam.height) & (v <= y1 * cam.height)
    )
    idx = np.nonzero(inside)[0]
    if idx.size < cfg.min_box_points:
        return None
    depths = z[idx]
    group = front_depth_group(depths, cfg.depth_gap, min_points=cfg.min_box_points)
    if not group.any():
        return None
    idx, depths = idx[group], depths[group]
    d_lo, d_hi = np.percentile(depths, cfg.depth_percentiles)
    keep = (depths >= d_lo) & (depths <= d_hi)
    idx = idx[keep]
    if idx.size < cfg.min_box_points:
        return None
    pts = points[idx]
    lo, hi = np.percentile(pts, [2.0, 98.0], axis=0)
    return Lift(view_index, det.label, det.score, idx, np.median(pts, axis=0), lo, hi)


def cluster_lifts(lifts: Sequence[Lift], cfg: PipelineConfig) -> list[Cluster]:
    """Greedy clustering by label and 3D proximity; one detection per view per object."""
    clusters: list[Cluster] = []
    for lift in sorted(lifts, key=lambda item: -item.score):
        best: Cluster | None = None
        best_gap = math.inf
        for cluster in clusters:
            if cluster.label != lift.label or lift.view in cluster.views:
                continue
            gap = aabb_gap(cluster.lo, cluster.hi, lift.lo, lift.hi)
            if gap <= cfg.cluster_gap and gap < best_gap:
                best, best_gap = cluster, gap
        if best is None:
            best = Cluster(lift.label)
            clusters.append(best)
        best.add(lift)
    return clusters


def fit_cluster(cluster: Cluster, points: np.ndarray, cfg: PipelineConfig) -> tuple[np.ndarray, tuple, tuple, float]:
    """Return (point indices used, center, size, yaw); points seen in at least half the views win."""
    all_idx = np.concatenate([lift.idx for lift in cluster.lifts])
    uniq, counts = np.unique(all_idx, return_counts=True)
    voted = uniq[counts >= math.ceil(len(cluster.lifts) / 2)]
    idx = voted if voted.size >= cfg_min_fit_points(cfg) else uniq
    center, size, yaw = fit_obb(points[idx], trim=cfg.fit_trim)
    return idx, center, size, yaw


def cfg_min_fit_points(cfg: PipelineConfig) -> int:
    return max(cfg.min_box_points, 3 * cfg.min_visible_points)


def in_frame_fraction(view: View, obb: tuple) -> float:
    """Fraction of the projected OBB's 2D extent that lies inside the image (0 if any corner is behind)."""
    (cx, cy, cz), (sx, sy, sz), yaw = obb
    ax, az = yaw_axes(yaw)
    corners = np.array(
        [
            [
                cx + i * sx / 2 * ax[0] + k * sz / 2 * az[0],
                cy + j * sy / 2,
                cz + i * sx / 2 * ax[1] + k * sz / 2 * az[1],
            ]
            for i in (-1, 1)
            for j in (-1, 1)
            for k in (-1, 1)
        ]
    )
    u, v, z = project(view, corners)
    if not np.isfinite(z).all():
        return 0.0
    w, h = view.camera.width, view.camera.height
    full = (u.max() - u.min()) * (v.max() - v.min())
    clipped_w = min(u.max(), w) - max(u.min(), 0.0)
    clipped_h = min(v.max(), h) - max(v.min(), 0.0)
    if full <= 0 or clipped_w <= 0 or clipped_h <= 0:
        return 0.0
    return float(clipped_w * clipped_h / full)


def _is_expected(view: View, obb: tuple, visible: np.ndarray, cfg: PipelineConfig) -> bool:
    """A view should have detected an object when it is mostly in frame and not mostly occluded."""
    return (
        int(visible.sum()) >= cfg.min_visible_points
        and float(visible.mean()) >= cfg.min_visible_fraction
        and in_frame_fraction(view, obb) >= cfg.min_inframe_fraction
    )


def nms(boxes: list[dict[str, Any]], iou_threshold: float) -> list[dict[str, Any]]:
    """Cross-label NMS: keep the most confident box among overlapping ones."""
    kept: list[dict[str, Any]] = []
    for box in sorted(boxes, key=lambda b: -b["confidence"]):
        if all(obb_iou(box["obb"], other["obb"]) < iou_threshold for other in kept):
            kept.append(box)
    return kept


def _select_frames(model: ColmapModel, frames: Mapping[str, Frame], limit: int | None) -> list[Any]:
    images = sorted((img for img in model.images if img.name in frames), key=lambda img: img.name)
    if limit and len(images) > limit:
        images = [images[i] for i in np.linspace(0, len(images) - 1, limit).round().astype(int)]
    return images


def run_pipeline(
    splat_points: np.ndarray,
    model: ColmapModel,
    frames: Mapping[str, Frame],
    detector: Detector2D,
    scan_to_scene: Sequence[float] = IDENTITY,
    cfg: PipelineConfig | None = None,
    progress: ProgressFn | None = None,
) -> DetectionResult:
    """Run the full pipeline. ``splat_points`` are splat centres in the scan (COLMAP) frame."""
    cfg = cfg or PipelineConfig()
    report = progress or (lambda _fraction, _message: None)
    a, _, b = split_similarity(scan_to_scene)
    points = np.asarray(splat_points, dtype=np.float64) @ a.T + b
    if len(points) > cfg.max_points:
        points = points[np.random.default_rng(0).choice(len(points), cfg.max_points, replace=False)]
    non_floor = points[:, 1] > cfg.floor_y + cfg.floor_band

    images = _select_frames(model, frames, cfg.max_keyframes)
    lifts: list[Lift] = []
    views: list[View] = []
    visibility: list[np.ndarray] = []
    failed_frames = 0
    n_2d = 0
    for i, image in enumerate(images):
        report(0.9 * i / max(len(images), 1), f"Detecting objects in keyframe {i + 1}/{len(images)}")
        view = make_view(image, model.cameras[image.camera_id], scan_to_scene)
        try:
            detections = detector.detect(frames[image.name], list(cfg.labels))
        except Exception:  # one bad keyframe (network, decode) must not sink the scan
            logger.exception("Detector failed on keyframe %s", image.name)
            failed_frames += 1
            detections = []
        u, v, z, visible = visible_in_view(view, points)
        views.append(view)
        visibility.append(visible)
        n_2d += len(detections)
        candidates = visible & non_floor
        for det in detections:
            lift = lift_detection(view, i, det, points, (u, v, z), candidates, cfg)
            if lift is not None:
                lifts.append(lift)
    if images and failed_frames == len(images):
        raise RuntimeError(f"{detector.name} detector failed on every keyframe")

    report(0.92, "Clustering detections across views")
    clusters = cluster_lifts(lifts, cfg)
    required = min(cfg.min_views, len(images))
    fitted: list[dict[str, Any]] = []
    rejected = 0
    for cluster in clusters:
        n_views = len(cluster.views)
        if n_views < required:
            rejected += 1
            continue
        idx, center, size, yaw = fit_cluster(cluster, points, cfg)
        expected = sum(
            1
            for view, vis in zip(views, visibility, strict=True)
            if _is_expected(view, (center, size, yaw), vis[idx], cfg)
        )
        agreement = min(1.0, n_views / max(expected, n_views))
        mean_score = float(np.mean([lift.score for lift in cluster.lifts]))
        fitted.append(
            {
                "label": cluster.label,
                "obb": (center, size, yaw),
                "confidence": float(min(1.0, max(0.0, agreement * mean_score))),
                "views": n_views,
            }
        )

    report(0.97, "Suppressing overlapping boxes")
    kept = nms(fitted, cfg.nms_iou)
    detections_out: list[DetectionInterpretation] = []
    masks: list[MaskRegion] = []
    for n, box in enumerate(kept, start=1):
        center, size, yaw = box["obb"]
        det_id, mask_id = f"det_{n:03d}", f"mask_det_{n:03d}"
        obb = OrientedBoundingBox(center=center, size=size, yaw=yaw)
        detections_out.append(
            DetectionInterpretation(
                id=det_id,
                category=box["label"].strip().lower().replace(" ", "_"),
                label=box["label"],
                obb=obb,
                confidence=box["confidence"],
                maskRegionId=mask_id,
                status="auto",
                provenance="auto",
            )
        )
        masks.append(
            MaskRegion(id=mask_id, obb=obb, feather=cfg.feather, enabled=False, detectionId=det_id, ghost=False)
        )
    report(1.0, "Done")
    return DetectionResult(
        detections=detections_out,
        maskRegions=masks,
        diagnostics={
            "detector": detector.name,
            "keyframes": len(images),
            "failedKeyframes": failed_frames,
            "detections2d": n_2d,
            "lifted": len(lifts),
            "clusters": len(clusters),
            "rejectedClusters": rejected,
            "suppressedByNms": len(fitted) - len(kept),
            "splatPoints": int(len(points)),
        },
    )
