"""3DGS splat container + PLY I/O (numpy only, memory-mapped so 700 MB files load on CPU).

Values are stored activated, as gsplat expects them: linear scales, opacity in [0, 1],
unit quaternions (w, x, y, z), RGB in [0, 1] from the SH DC term.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from services.object_detection.colmap import qvec_to_rotmat, rotmat_to_qvec

SH_C0 = 0.28209479177387814
_PLY_TYPES = {"float": "f4", "float32": "f4", "double": "f8", "uchar": "u1", "uint8": "u1", "int": "i4", "uint": "u4"}


@dataclass
class Splat:
    means: np.ndarray  # (N, 3)
    scales: np.ndarray  # (N, 3) linear
    quats: np.ndarray  # (N, 4) wxyz
    opacities: np.ndarray  # (N,)
    colors: np.ndarray  # (N, 3) RGB 0..1

    def __len__(self) -> int:
        return len(self.means)

    def subset(self, idx: np.ndarray) -> "Splat":
        return Splat(self.means[idx], self.scales[idx], self.quats[idx], self.opacities[idx], self.colors[idx])


def _read_header(path: Path):
    with open(path, "rb") as f:
        if f.readline().strip() != b"ply":
            raise ValueError(f"{path} is not a PLY file")
        fmt, count, props = None, 0, []
        in_vertex = False
        while True:
            line = f.readline()
            if not line:
                raise ValueError("PLY header has no end_header")
            parts = line.decode("ascii", "replace").split()
            if not parts:
                continue
            if parts[0] == "format":
                fmt = parts[1]
            elif parts[0] == "element":
                in_vertex = parts[1] == "vertex"
                if in_vertex:
                    count = int(parts[2])
            elif parts[0] == "property" and in_vertex:
                if parts[1] == "list":
                    raise ValueError("list properties in the vertex element are not supported")
                props.append((parts[2], _PLY_TYPES[parts[1]]))
            elif parts[0] == "end_header":
                return fmt, count, props, f.tell()


def read_ply_vertices(path: Path) -> np.memmap:
    fmt, count, props, offset = _read_header(Path(path))
    if fmt != "binary_little_endian":
        raise ValueError(f"Only binary_little_endian PLY is supported (got {fmt}); convert .sog/.spz first")
    return np.memmap(path, dtype=np.dtype([(n, "<" + t) for n, t in props]), mode="r", offset=offset, shape=(count,))


def load_ply(path: Path, max_points: Optional[int] = None, seed: int = 0) -> Splat:
    v = read_ply_vertices(path)
    idx = np.arange(len(v))
    if max_points is not None and len(v) > max_points:
        idx = np.sort(np.random.default_rng(seed).choice(len(v), max_points, replace=False))
    rows = v[idx]
    names = rows.dtype.names

    def cols(*keys):
        return np.stack([np.asarray(rows[k], dtype=np.float64) for k in keys], axis=-1)

    means = cols("x", "y", "z")
    n = len(means)
    scales = np.exp(cols("scale_0", "scale_1", "scale_2")) if "scale_0" in names else np.full((n, 3), 0.01)
    quats = cols("rot_0", "rot_1", "rot_2", "rot_3") if "rot_0" in names else np.tile([1.0, 0, 0, 0], (n, 1))
    quats /= np.linalg.norm(quats, axis=1, keepdims=True) + 1e-12
    opac = 1 / (1 + np.exp(-np.asarray(rows["opacity"], np.float64))) if "opacity" in names else np.ones(n)
    if "f_dc_0" in names:
        colors = np.clip(0.5 + SH_C0 * cols("f_dc_0", "f_dc_1", "f_dc_2"), 0, 1)
    elif "red" in names:
        colors = cols("red", "green", "blue") / 255.0
    else:
        colors = np.full((n, 3), 0.5)
    return Splat(means, scales, quats, opac, colors)


def save_ply(splat: Splat, path: Path) -> None:
    """Write the standard 3DGS PLY layout (SH degree 0)."""
    keys = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2"]
    keys += ["rot_0", "rot_1", "rot_2", "rot_3"]
    op = np.clip(splat.opacities, 1e-6, 1 - 1e-6)
    data = np.hstack(
        [
            splat.means,
            (splat.colors - 0.5) / SH_C0,
            np.log(op / (1 - op))[:, None],
            np.log(splat.scales),
            splat.quats,
        ]
    ).astype("<f4")
    header = f"ply\nformat binary_little_endian 1.0\nelement vertex {len(data)}\n"
    header += "".join(f"property float {k}\n" for k in keys) + "end_header\n"
    with open(path, "wb") as f:
        f.write(header.encode("ascii"))
        f.write(data.tobytes())


def inspect_ply(path: Path, sample: int = 200_000, seed: int = 0) -> dict:
    """Header facts + statistics from a random subsample (cheap on multi-GB files)."""
    fmt, count, props, _ = _read_header(Path(path))
    s = load_ply(path, max_points=sample, seed=seed)
    n_rest = sum(1 for n, _ in props if n.startswith("f_rest_"))
    return {
        "format": fmt,
        "count": count,
        "properties": len(props),
        "sh_degree": int(round(np.sqrt(n_rest / 3 + 1) - 1)) if n_rest else 0,
        "sampled": len(s),
        "bounds_min": s.means.min(axis=0).round(3).tolist(),
        "bounds_max": s.means.max(axis=0).round(3).tolist(),
        "p1_p99_min": np.percentile(s.means, 1, axis=0).round(3).tolist(),
        "p1_p99_max": np.percentile(s.means, 99, axis=0).round(3).tolist(),
        "median_scale": float(np.median(s.scales.max(axis=1))),
        "opacity_ge_0.5": float((s.opacities >= 0.5).mean()),
    }


def transform(splat: Splat, m: np.ndarray) -> Splat:
    """Apply a similarity transform (e.g. RoomStructureResult.scanToScene, row-major 4x4)."""
    a, b = m[:3, :3], m[:3, 3]
    s = float(np.cbrt(np.linalg.det(a)))
    r = a / s
    qr = rotmat_to_qvec(r)
    w1, x1, y1, z1 = qr
    w2, x2, y2, z2 = splat.quats.T
    quats = np.stack(
        [
            w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
            w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
            w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
            w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
        ],
        axis=-1,
    )
    if not np.allclose(qvec_to_rotmat(qr), r, atol=1e-6):
        raise ValueError("scanToScene must be a similarity transform")
    return Splat(splat.means @ a.T + b, splat.scales * s, quats, splat.opacities, splat.colors)
