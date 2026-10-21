"""Run detection on a reconstruction job directory: COLMAP poses + keyframes + splat points."""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence

import numpy as np

from services.object_detection.colmap import find_model_dir, read_model
from services.object_detection.detectors import Detector2D, Keyframe
from services.object_detection.geometry import CameraView, apply_matrix, matrix4
from services.object_detection.lifting import LiftConfig, run_detection, to_contracts

IDENTITY = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def load_splat_points(path: Path, max_points: int = 400_000, min_opacity: float = 0.2) -> np.ndarray:
    """Splat centers from a 3DGS .ply (scan frame), dropping near-transparent Gaussians."""
    from plyfile import PlyData

    vertex = PlyData.read(str(path))["vertex"]
    pts = np.column_stack([np.asarray(vertex[a], dtype=np.float64) for a in ("x", "y", "z")])
    if "opacity" in vertex.data.dtype.names:
        opacity = 1.0 / (1.0 + np.exp(-np.asarray(vertex["opacity"], dtype=np.float64)))
        pts = pts[opacity >= min_opacity]
    pts = pts[np.isfinite(pts).all(axis=1)]
    if len(pts) > max_points:
        pts = pts[np.linspace(0, len(pts) - 1, max_points).astype(int)]
    return pts


def find_splat(job_dir: Path) -> Optional[Path]:
    preferred = job_dir / "export" / "splat.ply"
    if preferred.exists():
        return preferred
    return next(iter(sorted(job_dir.rglob("*.ply"))), None)


def load_keyframes(
    model_dir: Path, image_dirs: Sequence[Path], scene_to_colmap: np.ndarray, max_views: int = 24
) -> List[Keyframe]:
    model = read_model(model_dir)
    images = sorted(model.images.values(), key=lambda im: im.name)
    if len(images) > max_views:
        images = [images[i] for i in np.linspace(0, len(images) - 1, max_views).astype(int)]
    frames = []
    for im in images:
        cam = model.cameras[im.camera_id]
        image_path = next((d / im.name for d in image_dirs if (d / im.name).exists()), None)
        view = CameraView.from_colmap(cam.K, im.R, im.tvec, cam.width, cam.height, scene_to_colmap)
        frames.append(Keyframe(im.name, view, image_path))
    return frames


def run_scan_detection(
    job_dir: Path,
    labels: Sequence[str],
    detector: Detector2D,
    scan_to_scene: Sequence[float] = IDENTITY,
    colmap_to_scan: Sequence[float] = IDENTITY,
    max_views: int = 24,
    cfg: Optional[LiftConfig] = None,
    progress: Optional[Callable[[int, int], None]] = None,
    id_prefix: str = "det",
) -> Dict[str, list]:
    """Detect objects for one job. Splat points are in the scan frame; COLMAP poses map via colmap_to_scan."""
    job_dir = Path(job_dir)
    model_dir = find_model_dir(job_dir)
    if model_dir is None:
        raise FileNotFoundError("No COLMAP sparse model (cameras/images .txt or .bin) in the reconstruction job")
    splat = find_splat(job_dir)
    if splat is None:
        raise FileNotFoundError("No splat .ply in the reconstruction job")

    scan_m = matrix4(scan_to_scene)
    scene_to_colmap = np.linalg.inv(scan_m @ matrix4(colmap_to_scan))
    image_dirs = [
        model_dir.parent.parent.parent / "images",
        job_dir / "processed" / "images",
        job_dir / "frames",
        job_dir / "images",
    ]
    frames = load_keyframes(model_dir, image_dirs, scene_to_colmap, max_views)
    points = apply_matrix(scan_m, load_splat_points(splat))
    results = run_detection(detector, frames, labels, points, cfg, progress)
    return to_contracts(results, id_prefix=id_prefix)


def merge_into_interpretation(interpretation: dict, detections: Sequence) -> dict:
    """Replace untouched auto detections; keep anything the user verified, corrected or rejected."""
    kept = [
        d for d in interpretation.get("detections", []) if d.get("status") != "auto" or d.get("provenance") == "user"
    ]
    fresh = [d.model_dump() if hasattr(d, "model_dump") else d for d in detections]
    return {**interpretation, "detections": kept + fresh}
