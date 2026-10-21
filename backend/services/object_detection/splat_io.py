"""Load Gaussian-splat centers from a 3DGS-style PLY (positions filtered by opacity)."""

from __future__ import annotations

from pathlib import Path

import numpy as np


def load_splat_centers(path: Path, min_opacity: float = 0.2, max_points: int = 1_500_000, seed: int = 0) -> np.ndarray:
    """Return (N, 3) float64 centers in the splat/COLMAP frame.

    3DGS PLYs store opacity as a logit; plain point-cloud PLYs without an ``opacity`` property are kept whole.
    """
    if path.suffix.lower() != ".ply":
        raise ValueError(f"Only .ply splats can be used for object detection (got {path.suffix or 'no extension'})")
    from plyfile import PlyData

    vertex = PlyData.read(str(path))["vertex"]
    names = vertex.data.dtype.names or ()
    pts = np.stack([np.asarray(vertex[c], dtype=np.float64) for c in ("x", "y", "z")], axis=1)
    keep = np.isfinite(pts).all(axis=1)
    if "opacity" in names:
        opacity = 1.0 / (1.0 + np.exp(-np.asarray(vertex["opacity"], dtype=np.float64)))
        keep &= opacity >= min_opacity
    pts = pts[keep]
    if len(pts) > max_points:
        pts = pts[np.random.default_rng(seed).choice(len(pts), max_points, replace=False)]
    return pts


def write_splat_ply(path: Path, points: np.ndarray, opacity_logit: float = 4.0) -> None:
    """Write a minimal 3DGS-style PLY (x, y, z, opacity); used by tests and the synthetic scene."""
    from plyfile import PlyData, PlyElement

    data = np.zeros(len(points), dtype=[("x", "f4"), ("y", "f4"), ("z", "f4"), ("opacity", "f4")])
    data["x"], data["y"], data["z"] = points[:, 0], points[:, 1], points[:, 2]
    data["opacity"] = opacity_logit
    PlyData([PlyElement.describe(data, "vertex")]).write(str(path))
