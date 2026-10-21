"""COLMAP sparse-model readers (text and binary) for camera intrinsics and poses."""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# model name -> (number of params, True when the model has one shared focal length)
_MODELS: dict[str, tuple[int, bool]] = {
    "SIMPLE_PINHOLE": (3, True),
    "PINHOLE": (4, False),
    "SIMPLE_RADIAL": (4, True),
    "RADIAL": (5, True),
    "OPENCV": (8, False),
    "OPENCV_FISHEYE": (8, False),
    "FULL_OPENCV": (12, False),
    "FOV": (5, False),
    "SIMPLE_RADIAL_FISHEYE": (4, True),
    "RADIAL_FISHEYE": (5, True),
    "THIN_PRISM_FISHEYE": (12, False),
}
_BINARY_MODEL_IDS = {
    0: "SIMPLE_PINHOLE",
    1: "PINHOLE",
    2: "SIMPLE_RADIAL",
    3: "RADIAL",
    4: "OPENCV",
    5: "OPENCV_FISHEYE",
    6: "FULL_OPENCV",
    7: "FOV",
    8: "SIMPLE_RADIAL_FISHEYE",
    9: "RADIAL_FISHEYE",
    10: "THIN_PRISM_FISHEYE",
}


@dataclass(frozen=True)
class Camera:
    camera_id: int
    model: str
    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float


@dataclass(frozen=True)
class ColmapImage:
    """World-to-camera pose (COLMAP convention: x right, y down, z forward)."""

    image_id: int
    camera_id: int
    name: str
    R_cw: np.ndarray  # (3, 3)
    t_cw: np.ndarray  # (3,)

    @property
    def center(self) -> np.ndarray:
        return -self.R_cw.T @ self.t_cw


@dataclass(frozen=True)
class ColmapModel:
    cameras: dict[int, Camera]
    images: list[ColmapImage]


def quat_to_rotation(qw: float, qx: float, qy: float, qz: float) -> np.ndarray:
    q = np.array([qw, qx, qy, qz], dtype=np.float64)
    n = np.linalg.norm(q)
    if n == 0:
        raise ValueError("Zero-length quaternion in COLMAP image pose")
    w, x, y, z = q / n
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
        ]
    )


def _camera(camera_id: int, model: str, width: int, height: int, params: list[float]) -> Camera:
    if model not in _MODELS:
        raise ValueError(f"Unsupported COLMAP camera model: {model}")
    _, single_focal = _MODELS[model]
    if single_focal:
        fx = fy = params[0]
        cx, cy = params[1], params[2]
    else:
        fx, fy, cx, cy = params[0], params[1], params[2], params[3]
    return Camera(camera_id, model, int(width), int(height), float(fx), float(fy), float(cx), float(cy))


def read_text_model(model_dir: Path) -> ColmapModel:
    cameras: dict[int, Camera] = {}
    for line in (model_dir / "cameras.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        f = line.split()
        cid = int(f[0])
        cameras[cid] = _camera(cid, f[1], int(f[2]), int(f[3]), [float(v) for v in f[4:]])

    # images.txt alternates a pose line and a (possibly empty) 2D-points line.
    lines = [ln for ln in (model_dir / "images.txt").read_text(encoding="utf-8").splitlines() if not ln.startswith("#")]
    images: list[ColmapImage] = []
    for i in range(0, len(lines), 2):
        f = lines[i].split()
        if len(f) < 10:
            continue
        qw, qx, qy, qz, tx, ty, tz = (float(v) for v in f[1:8])
        images.append(ColmapImage(int(f[0]), int(f[8]), f[9], quat_to_rotation(qw, qx, qy, qz), np.array([tx, ty, tz])))
    return ColmapModel(cameras, images)


def read_binary_model(model_dir: Path) -> ColmapModel:
    cameras: dict[int, Camera] = {}
    with (model_dir / "cameras.bin").open("rb") as fh:
        (count,) = struct.unpack("<Q", fh.read(8))
        for _ in range(count):
            cid, model_id, width, height = struct.unpack("<iiQQ", fh.read(24))
            model = _BINARY_MODEL_IDS[model_id]
            n_params = _MODELS[model][0]
            params = list(struct.unpack(f"<{n_params}d", fh.read(8 * n_params)))
            cameras[cid] = _camera(cid, model, width, height, params)

    images: list[ColmapImage] = []
    with (model_dir / "images.bin").open("rb") as fh:
        (count,) = struct.unpack("<Q", fh.read(8))
        for _ in range(count):
            image_id, qw, qx, qy, qz, tx, ty, tz, camera_id = struct.unpack("<i7di", fh.read(64))
            name_bytes = bytearray()
            while (ch := fh.read(1)) not in (b"\x00", b""):
                name_bytes += ch
            (n_points,) = struct.unpack("<Q", fh.read(8))
            fh.seek(24 * n_points, 1)
            images.append(
                ColmapImage(
                    image_id,
                    camera_id,
                    name_bytes.decode("utf-8"),
                    quat_to_rotation(qw, qx, qy, qz),
                    np.array([tx, ty, tz]),
                )
            )
    return ColmapModel(cameras, images)


def read_model(model_dir: Path) -> ColmapModel:
    if (model_dir / "cameras.txt").exists() and (model_dir / "images.txt").exists():
        return read_text_model(model_dir)
    if (model_dir / "cameras.bin").exists() and (model_dir / "images.bin").exists():
        return read_binary_model(model_dir)
    raise FileNotFoundError(f"No COLMAP cameras/images (.txt or .bin) found in {model_dir}")
