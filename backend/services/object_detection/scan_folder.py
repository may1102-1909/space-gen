"""Load a scan folder: splat ``.ply``, COLMAP sparse model, keyframe images and optional ``scan.json``.

Layout (first match wins)::

    splat.ply | scene.ply | point_cloud.ply | export/*.ply | *.ply
    sparse/0 | sparse | colmap/sparse/0 | colmap | .      (cameras + images, .txt or .bin)
    images/ | keyframes/ | frames/                       (keyframe files named as in images.txt)
    scan.json   {"scanToScene": [16 floats, row-major], "labels": ["sofa", ...]}   (optional)
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .colmap import ColmapModel, read_model
from .detectors import Frame
from .pipeline import IDENTITY

SPLAT_NAMES = ("splat.ply", "scene.ply", "point_cloud.ply")
MODEL_DIRS = ("sparse/0", "sparse", "colmap/sparse/0", "colmap", ".")
IMAGE_DIRS = ("images", "keyframes", "frames", ".")


@dataclass
class ScanFolder:
    root: Path
    splat_path: Path
    model: ColmapModel
    frames: dict[str, Frame]
    scan_to_scene: list[float]
    labels: list[str] | None


def _find_splat(root: Path) -> Path:
    for name in SPLAT_NAMES:
        if (root / name).is_file():
            return root / name
    for pattern in ("export/*.ply", "*.ply"):
        found = sorted(root.glob(pattern))
        if found:
            return found[0]
    raise FileNotFoundError(f"No splat .ply found in {root}")


def _find_model(root: Path) -> ColmapModel:
    for rel in MODEL_DIRS:
        directory = root / rel
        if any((directory / f).exists() for f in ("images.txt", "images.bin")):
            return read_model(directory)
    raise FileNotFoundError(f"No COLMAP cameras/images found under {root}")


def load_scan_folder(root: Path) -> ScanFolder:
    root = root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Scan folder not found: {root}")
    model = _find_model(root)
    image_roots = [root / rel for rel in IMAGE_DIRS if (root / rel).is_dir()]
    frames: dict[str, Frame] = {}
    for image in model.images:
        camera = model.cameras[image.camera_id]
        path = next((d / image.name for d in image_roots if (d / image.name).is_file()), None)
        frames[image.name] = Frame(image.name, path, camera.width, camera.height)

    meta_path = root / "scan.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    matrix = [float(v) for v in meta.get("scanToScene", IDENTITY)]
    if len(matrix) != 16:
        raise ValueError("scan.json scanToScene must have 16 values")
    return ScanFolder(root, _find_splat(root), model, frames, matrix, meta.get("labels"))
