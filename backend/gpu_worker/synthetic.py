"""Synthetic room splat (shell + box objects) and a fake mask detector, for CPU tests and GPU smoke runs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence

import numpy as np

from gpu_worker.render import Renderer
from gpu_worker.splat import Splat
from services.object_detection.detectors import Detection2D, Keyframe
from services.object_detection.geometry import CameraView, yaw_axes

ROOM_W, ROOM_D, CEILING = 6.0, 5.0, 2.6  # x in [0, W], z in [0, D]
OUTLINE = [(0.0, 0.0), (ROOM_W, 0.0), (ROOM_W, ROOM_D), (0.0, ROOM_D)]
FLOOR_RGB = np.array([0.62, 0.55, 0.45])
WALL_RGB = np.array([0.85, 0.84, 0.80])
# The subset of a T10 RoomInterpretation the worker reads.
INTERPRETATION = {
    "outline": OUTLINE,
    "ceilingHeight": CEILING,
    "walls": [
        {"id": f"w{i}", "start": (a[0], 0.0, a[1]), "end": (b[0], 0.0, b[1]), "height": CEILING}
        for i, (a, b) in enumerate(zip(OUTLINE, OUTLINE[1:] + OUTLINE[:1]))
    ],
}


@dataclass
class Box:
    label: str
    center: tuple  # bottom at y = 0
    size: tuple
    yaw: float
    rgb: tuple


OBJECTS = [
    Box("sofa", (1.6, 0.45, 3.6), (2.0, 0.9, 0.85), 0.0, (0.15, 0.25, 0.6)),
    Box("table", (3.6, 0.375, 2.2), (1.2, 0.75, 0.8), np.deg2rad(20), (0.45, 0.28, 0.12)),
    Box("lamp", (5.0, 0.8, 4.2), (0.35, 1.6, 0.35), 0.0, (0.9, 0.8, 0.2)),
]


def _grid(a: float, b: float, step: float) -> np.ndarray:
    n = max(int(round((b - a) / step)), 1)
    return a + (np.arange(n) + 0.5) * (b - a) / n


def _box_surface(box: Box, step: float) -> np.ndarray:
    hx, hy, hz = np.asarray(box.size) / 2
    faces = []
    xs, ys, zs = _grid(-hx, hx, step), _grid(-hy, hy, step), _grid(-hz, hz, step)
    for sx in (-hx, hx):
        y, z = np.meshgrid(ys, zs)
        faces.append(np.stack([np.full(y.size, sx), y.ravel(), z.ravel()], 1))
    for sz in (-hz, hz):
        x, y = np.meshgrid(xs, ys)
        faces.append(np.stack([x.ravel(), y.ravel(), np.full(x.size, sz)], 1))
    x, z = np.meshgrid(xs, zs)
    faces.append(np.stack([x.ravel(), np.full(x.size, hy), z.ravel()], 1))  # top only: boxes rest on the floor
    local = np.vstack(faces)
    ax, az = yaw_axes(box.yaw)
    return np.asarray(box.center) + local[:, :1] * ax + local[:, 1:2] * np.array([0, 1.0, 0]) + local[:, 2:] * az


def build_scene(step: float = 0.04, shell_step: float = 0.07, seed: int = 0):
    """Return (splat, gt_labels) with gt 0 = shell, k = OBJECTS[k - 1]."""
    rng = np.random.default_rng(seed)
    parts, labels, colors = [], [], []
    x, z = np.meshgrid(_grid(0, ROOM_W, shell_step), _grid(0, ROOM_D, shell_step))
    floor = np.stack([x.ravel(), np.zeros(x.size), z.ravel()], 1)
    ceil = floor + [0, CEILING, 0]
    walls = []
    for x0, z0, x1, z1 in [
        (0, 0, ROOM_W, 0),
        (ROOM_W, 0, ROOM_W, ROOM_D),
        (ROOM_W, ROOM_D, 0, ROOM_D),
        (0, ROOM_D, 0, 0),
    ]:
        length = np.hypot(x1 - x0, z1 - z0)
        s, y = np.meshgrid(_grid(0, length, shell_step), _grid(0, CEILING, shell_step))
        t = s.ravel() / length
        walls.append(np.stack([x0 + (x1 - x0) * t, y.ravel(), z0 + (z1 - z0) * t], 1))
    walls = np.vstack(walls)
    floor_rgb = FLOOR_RGB + 0.08 * np.sin(floor[:, [0]] * 3.0)  # gentle pattern so baking is checkable
    for pts, rgb in [(floor, floor_rgb), (walls, WALL_RGB), (ceil, WALL_RGB)]:
        parts.append(pts)
        labels.append(np.zeros(len(pts), int))
        colors.append(np.broadcast_to(rgb, pts.shape))
    for k, box in enumerate(OBJECTS, start=1):
        pts = _box_surface(box, step)
        parts.append(pts)
        labels.append(np.full(len(pts), k))
        colors.append(np.broadcast_to(box.rgb, pts.shape))
    means = np.vstack(parts) + rng.normal(0, 0.003, (sum(map(len, parts)), 3))
    gt = np.concatenate(labels)
    scale = np.where(gt == 0, shell_step, step) * 0.6
    splat = Splat(
        means,
        np.repeat(scale[:, None], 3, axis=1),
        np.tile([1.0, 0, 0, 0], (len(means), 1)),
        np.full(len(means), 0.95),
        np.clip(np.vstack(colors) + rng.normal(0, 0.02, means.shape), 0, 1),
    )
    return splat, gt


class FakeMaskDetector:
    """Stands in for OWLv2/GroundingDINO + SAM 2: renders ground-truth instance masks with SAM-like defects.

    Masks are dilated by `dilate_px` (boundary bleed onto the background), dropped with `miss_rate`, and
    with `false_positive_rate` a random rectangle labelled as a real class is added (view-inconsistent).
    """

    name = "fake_masks"

    def __init__(
        self,
        splat: Splat,
        gt: np.ndarray,
        renderer: Renderer,
        names: Sequence[str] = tuple(b.label for b in OBJECTS),
        dilate_px: int = 1,
        miss_rate: float = 0.1,
        false_positive_rate: float = 0.2,
        min_pixels: int = 40,
        seed: int = 0,
    ):
        self.splat, self.gt, self.renderer, self.names = splat, gt, renderer, list(names)
        self.dilate_px, self.miss_rate, self.fp_rate, self.min_pixels = (
            dilate_px,
            miss_rate,
            false_positive_rate,
            min_pixels,
        )
        self.rng = np.random.default_rng(seed)

    def detect_view(self, cam: CameraView) -> List[Detection2D]:
        import cv2

        onehot = np.eye(len(self.names) + 1)[self.gt]
        out = self.renderer.render(self.splat, cam, onehot)
        ids = np.argmax(out.features, axis=2)
        ids[out.alpha < 0.5] = 0
        dets = []
        for k, name in enumerate(self.names, start=1):
            mask = ids == k
            if mask.sum() < self.min_pixels or self.rng.random() < self.miss_rate:
                continue
            if self.dilate_px:
                mask = cv2.dilate(mask.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=self.dilate_px) > 0
            ys, xs = np.nonzero(mask)
            dets.append(
                Detection2D(name, 0.8 + 0.2 * self.rng.random(), (xs.min(), ys.min(), xs.max(), ys.max()), mask)
            )
        if self.rng.random() < self.fp_rate:
            w, h = cam.width, cam.height
            x0, y0 = int(self.rng.integers(0, w // 2)), int(self.rng.integers(0, h // 2))
            mask = np.zeros((h, w), bool)
            mask[y0 : y0 + h // 4, x0 : x0 + w // 4] = True
            dets.append(
                Detection2D(
                    self.names[int(self.rng.integers(len(self.names)))], 0.4, (x0, y0, x0 + w // 4, y0 + h // 4), mask
                )
            )
        return dets

    def detect(self, frame: Keyframe, labels: Sequence[str]) -> List[Detection2D]:
        return self.detect_view(frame.camera)


def precision_recall(pred_idx: np.ndarray, gt: np.ndarray, k: int) -> tuple:
    hit = int((gt[pred_idx] == k).sum())
    return hit / max(len(pred_idx), 1), hit / max(int((gt == k).sum()), 1)


def geometric_instances(splat: Splat, band: float = 0.06, cell: float = 0.1, min_gaussians: int = 150):
    """Pseudo ground truth for a scene-frame splat without a detector: (labels, names).

    Shell = floor/ceiling bands plus XZ cells whose Gaussians span most of the room height (walls);
    the rest is clustered with DBSCAN and each cluster gets a label guessed from its size.
    shortcut: only for GPU_WORKER_MODE=fake on synthetic/small scans; real runs use OWLv2/GDINO + SAM 2.
    """
    import open3d as o3d

    m = splat.means
    ceiling = float(np.percentile(m[:, 1], 99.5))
    labels = np.zeros(len(m), int)
    idx = np.nonzero((m[:, 1] > band) & (m[:, 1] < ceiling - band))[0]
    _, inv = np.unique(np.floor(m[idx][:, [0, 2]] / cell).astype(np.int64), axis=0, return_inverse=True)
    inv = inv.ravel()
    lo = np.full(inv.max() + 1 if len(idx) else 0, np.inf)
    hi = np.full(len(lo), -np.inf)
    np.minimum.at(lo, inv, m[idx, 1])
    np.maximum.at(hi, inv, m[idx, 1])
    idx = idx[(hi - lo)[inv] < 0.7 * ceiling]  # columns spanning the room height are walls
    names: List[str] = []
    if not len(idx):
        return labels, names
    cloud = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(m[idx]))
    clusters = np.asarray(cloud.cluster_dbscan(eps=cell, min_points=8))
    for c in range(int(clusters.max()) + 1 if len(clusters) else 0):
        members = idx[clusters == c]
        if len(members) < min_gaussians:
            continue
        size = m[members].max(axis=0) - m[members].min(axis=0)
        footprint = max(size[0], size[2])
        names.append("lamp" if size[1] > 1.2 and footprint < 0.6 else "sofa" if footprint > 1.6 else "table")
        labels[members] = len(names)
    return labels, names


class GeometricMaskDetector(FakeMaskDetector):
    """FakeMaskDetector over `geometric_instances`: clean masks, no misses or false positives."""

    name = "geometric_masks"

    def __init__(self, splat: Splat, renderer: Renderer):
        gt, names = geometric_instances(splat)
        super().__init__(splat, gt, renderer, names=names, dilate_px=0, miss_rate=0.0, false_positive_rate=0.0)
