"""Deterministic synthetic scan for tests and ``scripts/eval_detection.py --synthetic``.

Scene (Y-up, meters, floor at y=0): sofa, table and chair boxes plus a thin lamp, a back wall,
eight cameras on a ring, and low-opacity floaters. The scan frame is rotated, scaled and offset
relative to the scene, so ``scanToScene`` is exercised. Stub detector boxes come from projecting the
true boxes; the lamp is only "detected" in one view, so it is a false positive clustering must reject.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .colmap import Camera, ColmapImage, ColmapModel
from .detectors import FixtureDetector, Frame
from .geometry import View, project, visible_in_view
from .splat_io import write_splat_ply

IMAGE_W, IMAGE_H, FOCAL = 640, 480, 500.0
SCAN_SCALE = 1.8
GroundTruthBox = dict  # {"label": str, "center": [3], "size": [3], "yaw": float}

TRUE_BOXES: list[GroundTruthBox] = [
    {"label": "sofa", "center": [0.0, 0.4, -1.0], "size": [2.0, 0.8, 0.9], "yaw": 0.0},
    {"label": "table", "center": [1.3, 0.225, 0.7], "size": [1.1, 0.45, 0.6], "yaw": 0.5},
    {"label": "chair", "center": [-1.4, 0.45, 0.6], "size": [0.55, 0.9, 0.5], "yaw": -0.4},
]
LAMP_BOX: GroundTruthBox = {"label": "lamp", "center": [2.2, 0.7, -2.2], "size": [0.3, 1.4, 0.3], "yaw": 0.0}


def _rot_x(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def _rot_y(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def scan_to_scene_matrix() -> np.ndarray:
    """Similarity (scale 1.8, rotation, translation) mapping scan coordinates to the scene frame."""
    m = np.eye(4)
    m[:3, :3] = SCAN_SCALE * (_rot_y(math.radians(28)) @ _rot_x(math.radians(90)))
    m[:3, 3] = [0.35, 0.0, -0.2]
    return m


def _rotation_to_quat(r: np.ndarray) -> tuple[float, float, float, float]:
    t = np.trace(r)
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = ((r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s)
        return 0.25 * s, *q
    i = int(np.argmax(np.diag(r)))
    j, k = (i + 1) % 3, (i + 2) % 3
    s = math.sqrt(1.0 + r[i, i] - r[j, j] - r[k, k]) * 2
    q = [0.0, 0.0, 0.0]
    q[i] = 0.25 * s
    q[j] = (r[j, i] + r[i, j]) / s
    q[k] = (r[k, i] + r[i, k]) / s
    return (r[k, j] - r[j, k]) / s, q[0], q[1], q[2]


def _box_points(box: GroundTruthBox, step: float, rng: np.random.Generator) -> np.ndarray:
    """Surface samples of a yaw-rotated box (sides and top; the bottom rests on the floor)."""
    sx, sy, sz = box["size"]
    gx, gy, gz = (np.arange(step / 2, s, step) - s / 2 for s in (sx, sy, sz))
    faces = []
    for sign in (-1, 1):
        faces.append(np.stack(np.meshgrid([sign * sx / 2], gy, gz, indexing="ij"), -1).reshape(-1, 3))
        faces.append(np.stack(np.meshgrid(gx, gy, [sign * sz / 2], indexing="ij"), -1).reshape(-1, 3))
    faces.append(np.stack(np.meshgrid(gx, [sy / 2], gz, indexing="ij"), -1).reshape(-1, 3))
    local = np.concatenate(faces)
    local[:, 1] += 0.0
    yaw = box["yaw"]
    ax = np.array([math.cos(yaw), 0.0, -math.sin(yaw)])
    az = np.array([math.sin(yaw), 0.0, math.cos(yaw)])
    world = np.asarray(box["center"]) + local[:, :1] * ax + local[:, 2:] * az + local[:, 1:2] * np.array([0, 1, 0])
    return world + rng.normal(0, 0.002, world.shape)


def _look_at(eye: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Rows are camera axes (x right, y down, z forward) in scene coordinates."""
    forward = target - eye
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, [0.0, 1.0, 0.0])
    right /= np.linalg.norm(right)
    down = np.cross(forward, right)
    return np.stack([right, down, forward])


@dataclass
class SyntheticScan:
    points_scan: np.ndarray
    opacity_logit: np.ndarray
    scan_to_scene: list[float]
    model: ColmapModel
    frames: dict[str, Frame]
    detector: FixtureDetector
    detections_json: dict
    ground_truth: list[GroundTruthBox]
    false_positive_labels: tuple[str, ...] = ("lamp",)


def build_synthetic_scan(seed: int = 7, n_views: int = 8, spacing: float = 0.04) -> SyntheticScan:
    rng = np.random.default_rng(seed)
    gx = np.arange(-3.0, 3.0 + 1e-9, spacing)
    floor = np.stack(np.meshgrid(gx, [0.0], gx, indexing="ij"), -1).reshape(-1, 3)
    wall = np.stack(
        np.meshgrid(gx, np.arange(0.0, 2.5, spacing), [-3.0], indexing="ij"),
        -1,
    ).reshape(-1, 3)
    object_points = {b["label"]: _box_points(b, 0.03, rng) for b in [*TRUE_BOXES, LAMP_BOX]}
    floaters = rng.uniform([-3, 0.1, -3], [3, 2.2, 3], (400, 3))
    scene_pts = np.concatenate([floor, wall, *object_points.values(), floaters])
    opacity = np.concatenate([np.full(len(scene_pts) - len(floaters), 4.0), np.full(len(floaters), -4.0)])

    m = scan_to_scene_matrix()
    a, b = m[:3, :3], m[:3, 3]
    q = a / SCAN_SCALE
    points_scan = (scene_pts - b) @ np.linalg.inv(a).T

    camera = Camera(1, "PINHOLE", IMAGE_W, IMAGE_H, FOCAL, FOCAL, IMAGE_W / 2, IMAGE_H / 2)
    images: list[ColmapImage] = []
    views: list[View] = []
    for i in range(n_views):
        ang = 2 * math.pi * i / n_views + 0.3
        eye = np.array([2.6 * math.cos(ang), 1.5, 2.6 * math.sin(ang)])
        r_scene = _look_at(eye, np.array([0.0, 0.5, -0.2]))
        c_scan = np.linalg.inv(a) @ (eye - b)
        r_cw = r_scene @ q
        name = f"frame_{i:03d}.jpg"
        images.append(ColmapImage(i + 1, 1, name, r_cw, -r_cw @ c_scan))
        views.append(View(name, camera, r_scene, eye))
    model = ColmapModel({1: camera}, images)
    frames = {img.name: Frame(img.name, None, IMAGE_W, IMAGE_H) for img in images}

    n_floor_wall = len(floor) + len(wall)
    owner: dict[str, slice] = {}
    start = n_floor_wall
    for label, pts in object_points.items():
        owner[label] = slice(start, start + len(pts))
        start += len(pts)

    detections: dict[str, list[dict]] = {}
    score_rng = np.random.default_rng(seed + 1)
    for view in views:
        _, _, _, visible = visible_in_view(
            view, scene_pts[: n_floor_wall + sum(len(p) for p in object_points.values())]
        )
        for box in [*TRUE_BOXES, LAMP_BOX]:
            if box["label"] == "lamp" and view.name != views[2].name:
                continue  # lamp is a single-view false positive
            frac = visible[owner[box["label"]]].mean()
            xyxy = _project_box(view, box)
            if xyxy is None or frac < 0.3:
                continue
            score = 0.7 if box["label"] == "lamp" else float(score_rng.uniform(0.82, 0.95))
            detections.setdefault(view.name, []).append({"label": box["label"], "score": score, "box": xyxy})

    return SyntheticScan(
        points_scan=points_scan,
        opacity_logit=opacity,
        scan_to_scene=[float(v) for v in m.ravel()],
        model=model,
        frames=frames,
        detector=FixtureDetector.from_json(detections),
        detections_json=detections,
        ground_truth=[dict(box) for box in TRUE_BOXES],
    )


def _project_box(view: View, box: GroundTruthBox) -> list[float] | None:
    """Normalized 2D rectangle of the projected box; None when clipped by more than 30% or behind the camera."""
    sx, sy, sz = box["size"]
    yaw = box["yaw"]
    ax = np.array([math.cos(yaw), 0.0, -math.sin(yaw)])
    az = np.array([math.sin(yaw), 0.0, math.cos(yaw)])
    corners = np.array(
        [
            np.asarray(box["center"]) + i * sx / 2 * ax + j * sy / 2 * np.array([0, 1, 0]) + k * sz / 2 * az
            for i in (-1, 1)
            for j in (-1, 1)
            for k in (-1, 1)
        ]
    )
    u, v, z = project(view, corners)
    if not np.isfinite(z).all():
        return None
    w, h = view.camera.width, view.camera.height
    x0, x1, y0, y1 = u.min(), u.max(), v.min(), v.max()
    full = (x1 - x0) * (y1 - y0)
    cx0, cx1, cy0, cy1 = max(x0, 0), min(x1, w), max(y0, 0), min(y1, h)
    if cx1 <= cx0 or cy1 <= cy0 or (cx1 - cx0) * (cy1 - cy0) < 0.7 * full:
        return None
    return [cx0 / w, cy0 / h, cx1 / w, cy1 / h]


def write_scan_folder(directory: Path, scan: SyntheticScan | None = None) -> Path:
    """Write the layout read by ``scan_folder.load_scan_folder``; returns the folder."""
    from PIL import Image

    scan = scan or build_synthetic_scan()
    directory.mkdir(parents=True, exist_ok=True)
    sparse = directory / "sparse" / "0"
    images_dir = directory / "images"
    sparse.mkdir(parents=True, exist_ok=True)
    images_dir.mkdir(exist_ok=True)

    write_splat_ply(directory / "splat.ply", scan.points_scan, scan.opacity_logit)
    cam = scan.model.cameras[1]
    (sparse / "cameras.txt").write_text(
        f"# Camera list\n1 PINHOLE {cam.width} {cam.height} {cam.fx} {cam.fy} {cam.cx} {cam.cy}\n", encoding="utf-8"
    )
    lines = ["# Image list"]
    for img in scan.model.images:
        qw, qx, qy, qz = (float(v) for v in _rotation_to_quat(img.R_cw))
        t = [float(v) for v in img.t_cw]
        lines += [
            f"{img.image_id} {qw!r} {qx!r} {qy!r} {qz!r} {t[0]!r} {t[1]!r} {t[2]!r} {img.camera_id} {img.name}",
            "",
        ]
        Image.new("RGB", (160, 120), (128, 128, 128)).save(images_dir / img.name, quality=60)
    (sparse / "images.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (directory / "scan.json").write_text(json.dumps({"scanToScene": scan.scan_to_scene}), encoding="utf-8")
    (directory / "detections.json").write_text(json.dumps(scan.detections_json), encoding="utf-8")
    (directory / "labels.json").write_text(json.dumps({"objects": scan.ground_truth}), encoding="utf-8")
    return directory
