"""Load splat positions and opacity from scan files.

Supported: 3DGS `.ply` (opacity stored as a logit, or already in [0, 1]) and the
antimatter15 `.splat` format. `.sog` / `.spz` are compressed containers and are not
decoded here; callers must supply a `.ply` or `.splat` (or a COLMAP point cloud).
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np


class UnsupportedScanFormatError(ValueError):
    pass


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30.0, 30.0)))


def load_ply_points(path: Path) -> tuple[np.ndarray, np.ndarray]:
    from plyfile import PlyData

    ply = PlyData.read(str(path))
    if "vertex" not in [e.name for e in ply.elements]:
        raise UnsupportedScanFormatError("PLY has no vertex element (compressed splat PLY is not supported).")
    vertex = ply["vertex"].data
    names = vertex.dtype.names or ()
    if not {"x", "y", "z"} <= set(names):
        raise UnsupportedScanFormatError("PLY vertex element has no x/y/z properties.")
    positions = np.stack([vertex["x"], vertex["y"], vertex["z"]], axis=1).astype(np.float64)
    if "opacity" in names:
        raw = np.asarray(vertex["opacity"], dtype=np.float64)
        opacity = raw if raw.size and raw.min() >= 0.0 and raw.max() <= 1.0 else _sigmoid(raw)
    else:
        opacity = np.ones(len(positions))
    return positions, opacity


def load_splat_points(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """antimatter15 .splat: 32 bytes per splat (pos f32x3, scale f32x3, rgba u8x4, rot u8x4)."""
    raw = np.fromfile(path, dtype=np.uint8)
    if raw.size % 32:
        raise UnsupportedScanFormatError("Malformed .splat file (size is not a multiple of 32 bytes).")
    records = raw.reshape(-1, 32)
    positions = records[:, :12].copy().view("<f4").reshape(-1, 3).astype(np.float64)
    opacity = records[:, 27].astype(np.float64) / 255.0
    return positions, opacity


def load_scan_points(path: Path) -> tuple[np.ndarray, np.ndarray]:
    suffix = path.suffix.lower()
    if suffix == ".ply":
        return load_ply_points(path)
    if suffix == ".splat":
        return load_splat_points(path)
    raise UnsupportedScanFormatError(
        f"Room structure analysis needs a .ply or .splat scan; '{suffix or 'unknown'}' is not supported."
    )


def load_colmap_points(path: Path) -> np.ndarray:
    """COLMAP sparse points as a PLY, `points3D.txt` or `points3D.bin` export; positions only."""
    if path.suffix.lower() == ".ply":
        return load_ply_points(path)[0]
    if path.suffix.lower() == ".txt":
        rows = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line and not line.startswith("#"):
                parts = line.split()
                rows.append([float(parts[1]), float(parts[2]), float(parts[3])])
        return np.asarray(rows, dtype=np.float64).reshape(-1, 3)
    if path.suffix.lower() == ".bin":
        data = path.read_bytes()
        (count,) = struct.unpack_from("<Q", data, 0)
        offset, points = 8, []
        for _ in range(count):
            x, y, z = struct.unpack_from("<ddd", data, offset + 8)
            offset += 8 + 24 + 3 + 8  # point id, xyz, rgb, reprojection error
            (track_len,) = struct.unpack_from("<Q", data, offset)
            offset += 8 + track_len * 8
            points.append((x, y, z))
        return np.asarray(points, dtype=np.float64).reshape(-1, 3)
    raise UnsupportedScanFormatError("COLMAP points must be a .ply, points3D.txt or points3D.bin file.")
