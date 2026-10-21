"""Lift per-view 2D detections to scene-frame OBBs using splat points as depth.

Per view, splat centers are z-buffered into a coarse depth map (a cheap rendered depth). Each point
then collects votes per label (space carving):
- for: it projects inside a detection of that label and lies at most `max_behind` behind the
  rendered surface (back faces of an object are hidden but still inside its silhouette);
- against: it is visible in the view and falls outside every detection of that label.
A point must also be seen (visible) inside detections in >= `min_visible_votes` views, and when
several labels claim it, the label with the most supporting views wins.
Points with enough agreeing views are grouped into voxel-connected instances, each fitted with a
yaw-only OBB. Confidence = view agreement (detecting views / views that observe the instance) x
mean detector score.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence

import numpy as np

from services.object_detection.detectors import Detection2D, Detector2D, Keyframe
from services.object_detection.geometry import CameraView, fit_obb


@dataclass
class LiftConfig:
    depth_cell_px: int = 6
    depth_rel_tol: float = 0.03
    depth_abs_tol: float = 0.05
    max_behind: float = 1.5  # meters behind the rendered surface that may still belong to the object
    min_votes: int = 3
    min_visible_votes: int = 2  # points never seen inside a detection are occluded background
    vote_ratio: float = 0.6
    voxel: float = 0.15
    min_points: int = 30
    min_relative_size: float = 0.15  # drop fragments much smaller than the label's largest instance
    floor_eps: float = 0.03
    support_fraction: float = 0.5
    observe_fraction: float = 0.3


@dataclass
class Lifted3D:
    label: str
    obb: dict
    confidence: float
    view_agreement: float
    score: float
    n_views: int
    n_points: int


@dataclass
class _ViewData:
    in_image: np.ndarray
    visible: np.ndarray
    dets: List[tuple]  # (Detection2D, point indices inside its region)


def render_depth(cam: CameraView, points: np.ndarray, cfg: LiftConfig):
    """Z-buffer splat centers on a coarse grid. Returns (in_image, visible, depth, surface depth per point)."""
    uv, depth = cam.project(points)
    inside = cam.in_image(uv, depth)
    surface = np.full(len(points), np.inf)
    idx = np.nonzero(inside)[0]
    if len(idx):
        gw = int(np.ceil(cam.width / cfg.depth_cell_px))
        gh = int(np.ceil(cam.height / cfg.depth_cell_px))
        cell = (uv[idx, 1] // cfg.depth_cell_px).astype(int) * gw + (uv[idx, 0] // cfg.depth_cell_px).astype(int)
        zbuf = np.full(gw * gh, np.inf)
        np.minimum.at(zbuf, cell, depth[idx])
        surface[idx] = zbuf[cell]
    visible = inside & (depth <= surface * (1 + cfg.depth_rel_tol) + cfg.depth_abs_tol)
    return inside, visible, uv, depth, surface


def _region_indices(det: Detection2D, uv: np.ndarray, candidates: np.ndarray) -> np.ndarray:
    x0, y0, x1, y1 = det.box
    u, v = uv[candidates, 0], uv[candidates, 1]
    keep = (u >= x0) & (u <= x1) & (v >= y0) & (v <= y1)
    if det.mask is not None:
        h, w = det.mask.shape
        keep &= det.mask[np.clip(v.astype(int), 0, h - 1), np.clip(u.astype(int), 0, w - 1)]
    return candidates[keep]


def _voxel_components(points: np.ndarray, voxel: float) -> List[np.ndarray]:
    """Connected components of occupied voxels (26-neighbourhood); returns point-index arrays."""
    keys = np.floor(points / voxel).astype(np.int64)
    uniq, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = inverse.reshape(-1)
    lookup = {tuple(k): i for i, k in enumerate(uniq.tolist())}
    parent = list(range(len(uniq)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    offsets = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) > (0, 0, 0)]
    for i, (x, y, z) in enumerate(uniq.tolist()):
        for dx, dy, dz in offsets:
            j = lookup.get((x + dx, y + dy, z + dz))
            if j is not None:
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[ri] = rj
    roots = np.array([find(i) for i in range(len(uniq))])[inverse]
    return [np.nonzero(roots == r)[0] for r in np.unique(roots)]


def lift_detections(
    points: np.ndarray,
    frames: Sequence[Keyframe],
    detections: Sequence[Sequence[Detection2D]],
    cfg: Optional[LiftConfig] = None,
) -> List[Lifted3D]:
    cfg = cfg or LiftConfig()
    points = np.asarray(points, float)
    labels = sorted({d.label for dets in detections for d in dets})
    votes_for = {label: np.zeros(len(points), np.int32) for label in labels}
    votes_against = {label: np.zeros(len(points), np.int32) for label in labels}
    votes_seen = {label: np.zeros(len(points), np.int32) for label in labels}

    views: List[_ViewData] = []
    for frame, dets in zip(frames, detections):
        inside, visible, uv, depth, surface = render_depth(frame.camera, points, cfg)
        candidates = np.nonzero(inside & (depth <= surface + cfg.max_behind))[0]
        view = _ViewData(inside, visible, [])
        hit = {label: np.zeros(len(points), bool) for label in labels}
        for det in dets:
            idx = _region_indices(det, uv, candidates)
            view.dets.append((det, idx))
            hit[det.label][idx] = True
        for label in labels:
            votes_for[label] += hit[label]
            votes_against[label] += visible & ~hit[label]
            votes_seen[label] += visible & hit[label]
        views.append(view)

    above_floor = points[:, 1] >= cfg.floor_eps
    claim = {}
    for label in labels:
        pos, neg = votes_for[label], votes_against[label]
        ok = above_floor & (pos >= cfg.min_votes) & (votes_seen[label] >= cfg.min_visible_votes)
        claim[label] = np.where(ok & (pos >= cfg.vote_ratio * (pos + neg)), pos, 0)
    if not labels:
        return []
    stacked = np.stack([claim[label] for label in labels])
    owner = np.where(stacked.max(axis=0) > 0, stacked.argmax(axis=0), -1)

    results: List[Lifted3D] = []
    for li, label in enumerate(labels):
        kept = np.nonzero(owner == li)[0]
        if len(kept) < cfg.min_points:
            continue
        comps = _voxel_components(points[kept], cfg.voxel)
        largest = max(len(c) for c in comps)
        for comp in comps:
            if len(comp) < max(cfg.min_points, cfg.min_relative_size * largest):
                continue
            members = kept[comp]
            lifted = _describe_instance(label, members, points, views, cfg)
            if lifted is not None:
                results.append(lifted)
    results.sort(key=lambda r: -r.confidence)
    return results


def _describe_instance(label, members, points, views, cfg) -> Optional[Lifted3D]:
    scores, observing = [], 0
    for view in views:
        in_img = view.in_image[members]
        if in_img.mean() < cfg.observe_fraction:
            continue
        n_in = int(in_img.sum())
        best = None
        for det, idx in view.dets:
            if det.label != label:
                continue
            cover = np.isin(members, idx).sum() / n_in
            if cover >= cfg.support_fraction and (best is None or det.score > best):
                best = det.score
        if best is not None:
            scores.append(best)
            observing += 1
        elif view.visible[members].mean() >= cfg.observe_fraction * 0.5:
            observing += 1  # instance is plainly in view yet no detection supports it
    if len(scores) < 2:
        return None
    agreement = len(scores) / observing
    score = float(np.mean(scores))
    return Lifted3D(
        label=label,
        obb=fit_obb(points[members]),
        confidence=float(np.clip(agreement * score, 0.0, 1.0)),
        view_agreement=float(agreement),
        score=score,
        n_views=len(scores),
        n_points=int(len(members)),
    )


def run_detection(
    detector: Detector2D,
    frames: Sequence[Keyframe],
    labels: Sequence[str],
    points: np.ndarray,
    cfg: Optional[LiftConfig] = None,
    progress: Optional[Callable[[int, int], None]] = None,
) -> List[Lifted3D]:
    detections: List[List[Detection2D]] = []
    for i, frame in enumerate(frames):
        detections.append(detector.detect(frame, labels))
        if progress:
            progress(i + 1, len(frames))
    return lift_detections(points, frames, detections, cfg)


def to_contracts(results: Sequence[Lifted3D], feather: float = 0.05, id_prefix: str = "det") -> Dict[str, list]:
    """Map lifted boxes to DetectionInterpretation + MaskRegion models (shared contracts)."""
    from models.contracts import DetectionInterpretation, MaskRegion, OrientedBoundingBox

    detections, masks = [], []
    for i, r in enumerate(results):
        det_id = f"{id_prefix}_{i:03d}"
        mask_id = f"mask_{det_id}"
        obb = OrientedBoundingBox(**r.obb)
        detections.append(
            DetectionInterpretation(
                id=det_id,
                category=r.label.strip().lower().replace(" ", "_"),
                label=r.label,
                obb=obb,
                confidence=round(r.confidence, 4),
                maskRegionId=mask_id,
                status="auto",
                provenance="auto",
            )
        )
        # Disabled until the user accepts the detection: AI output never edits the scene directly.
        masks.append(MaskRegion(id=mask_id, obb=obb, feather=feather, enabled=False, detectionId=det_id))
    return {"detections": detections, "maskRegions": masks}
