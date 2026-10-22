"""COLMAP sparse-model camera parsing (cameras/images in .txt or .bin form).

COLMAP stores world-to-camera poses: X_cam = R(q) @ X_world + t, camera looks down +Z,
image x right, y down. Lens distortion parameters are kept but not applied: keyframes
from ns-process-data are undistorted, and box-level lifting tolerates small distortion.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List

import numpy as np

# model_id -> (name, number of params)
CAMERA_MODELS = {
    0: ("SIMPLE_PINHOLE", 3),
    1: ("PINHOLE", 4),
    2: ("SIMPLE_RADIAL", 4),
    3: ("RADIAL", 5),
    4: ("OPENCV", 8),
    5: ("OPENCV_FISHEYE", 8),
    6: ("FULL_OPENCV", 12),
    7: ("FOV", 5),
    8: ("SIMPLE_RADIAL_FISHEYE", 4),
    9: ("RADIAL_FISHEYE", 5),
    10: ("THIN_PRISM_FISHEYE", 12),
}
_SINGLE_FOCAL = {"SIMPLE_PINHOLE", "SIMPLE_RADIAL", "RADIAL", "FOV", "SIMPLE_RADIAL_FISHEYE", "RADIAL_FISHEYE"}


@dataclass
class ColmapCamera:
    camera_id: int
    model: str
    width: int
    height: int
    params: List[float]

    @property
    def K(self) -> np.ndarray:
        p = self.params
        if self.model in _SINGLE_FOCAL:
            fx = fy = p[0]
            cx, cy = p[1], p[2]
        else:
            fx, fy, cx, cy = p[0], p[1], p[2], p[3]
        return np.array([[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]])


@dataclass
class ColmapImage:
    image_id: int
    qvec: np.ndarray  # (w, x, y, z)
    tvec: np.ndarray
    camera_id: int
    name: str

    @property
    def R(self) -> np.ndarray:
        return qvec_to_rotmat(self.qvec)

    @property
    def center(self) -> np.ndarray:
        return -self.R.T @ self.tvec


@dataclass
class ColmapModel:
    cameras: Dict[int, ColmapCamera] = field(default_factory=dict)
    images: Dict[int, ColmapImage] = field(default_factory=dict)


def qvec_to_rotmat(q: np.ndarray) -> np.ndarray:
    w, x, y, z = np.asarray(q, dtype=float) / np.linalg.norm(q)
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
        ]
    )


def rotmat_to_qvec(R: np.ndarray) -> np.ndarray:
    """Inverse of qvec_to_rotmat (used to write synthetic COLMAP files)."""
    tr = np.trace(R)
    if tr > 0:
        s = 2.0 * np.sqrt(tr + 1.0)
        q = [0.25 * s, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s]
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = 2.0 * np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2])
        q = [(R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s]
    elif R[1, 1] > R[2, 2]:
        s = 2.0 * np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2])
        q = [(R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s]
    else:
        s = 2.0 * np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1])
        q = [(R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s]
    q = np.array(q)
    return q if q[0] >= 0 else -q


def _data_lines(path: Path) -> List[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if not line.startswith("#")]


def read_cameras_text(path: Path) -> Dict[int, ColmapCamera]:
    cameras: Dict[int, ColmapCamera] = {}
    for line in _data_lines(path):
        if not line:
            continue
        tok = line.split()
        cam = ColmapCamera(int(tok[0]), tok[1], int(tok[2]), int(tok[3]), [float(v) for v in tok[4:]])
        cameras[cam.camera_id] = cam
    return cameras


def read_images_text(path: Path) -> Dict[int, ColmapImage]:
    """Each image has a header line plus a POINTS2D line, which may be empty."""
    images: Dict[int, ColmapImage] = {}
    lines = _data_lines(path)
    i = 0
    while i < len(lines):
        tok = lines[i].split()
        if len(tok) < 10:
            i += 1
            continue
        img = ColmapImage(
            image_id=int(tok[0]),
            qvec=np.array([float(v) for v in tok[1:5]]),
            tvec=np.array([float(v) for v in tok[5:8]]),
            camera_id=int(tok[8]),
            name=" ".join(tok[9:]),
        )
        images[img.image_id] = img
        i += 2
    return images


def read_cameras_binary(path: Path) -> Dict[int, ColmapCamera]:
    cameras: Dict[int, ColmapCamera] = {}
    with open(path, "rb") as f:
        (count,) = struct.unpack("<Q", f.read(8))
        for _ in range(count):
            camera_id, model_id, width, height = struct.unpack("<iiQQ", f.read(24))
            name, n_params = CAMERA_MODELS[model_id]
            params = list(struct.unpack(f"<{n_params}d", f.read(8 * n_params)))
            cameras[camera_id] = ColmapCamera(camera_id, name, int(width), int(height), params)
    return cameras


def read_images_binary(path: Path) -> Dict[int, ColmapImage]:
    images: Dict[int, ColmapImage] = {}
    with open(path, "rb") as f:
        (count,) = struct.unpack("<Q", f.read(8))
        for _ in range(count):
            vals = struct.unpack("<i7di", f.read(64))
            name_bytes = bytearray()
            while (ch := f.read(1)) not in (b"\x00", b""):
                name_bytes += ch
            (n_points,) = struct.unpack("<Q", f.read(8))
            f.seek(24 * n_points, 1)
            images[vals[0]] = ColmapImage(
                image_id=vals[0],
                qvec=np.array(vals[1:5]),
                tvec=np.array(vals[5:8]),
                camera_id=vals[8],
                name=name_bytes.decode("utf-8"),
            )
    return images


def read_model(model_dir: Path) -> ColmapModel:
    """Read a COLMAP sparse model directory, preferring text files over binary ones."""
    model_dir = Path(model_dir)
    if (model_dir / "cameras.txt").exists() and (model_dir / "images.txt").exists():
        return ColmapModel(read_cameras_text(model_dir / "cameras.txt"), read_images_text(model_dir / "images.txt"))
    if (model_dir / "cameras.bin").exists() and (model_dir / "images.bin").exists():
        return ColmapModel(read_cameras_binary(model_dir / "cameras.bin"), read_images_binary(model_dir / "images.bin"))
    raise FileNotFoundError(f"No COLMAP cameras/images files in {model_dir}")


def find_model_dir(root: Path) -> Path | None:
    """Locate the first directory under root holding a COLMAP sparse model."""
    for pattern in ("cameras.txt", "cameras.bin"):
        for cam_file in sorted(Path(root).rglob(pattern)):
            if (cam_file.parent / cam_file.name.replace("cameras", "images")).exists():
                return cam_file.parent
    return None


def write_model_text(model: ColmapModel, model_dir: Path) -> None:
    model_dir = Path(model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    cam_lines = ["# Camera list with one line of data per camera:"]
    for c in model.cameras.values():
        cam_lines.append(" ".join([str(c.camera_id), c.model, str(c.width), str(c.height), *map(repr, c.params)]))
    img_lines = ["# Image list with two lines of data per image:"]
    for im in model.images.values():
        img_lines.append(
            " ".join(
                [
                    str(im.image_id),
                    *map(repr, im.qvec.tolist()),
                    *map(repr, im.tvec.tolist()),
                    str(im.camera_id),
                    im.name,
                ]
            )
        )
        img_lines.append("")
    (model_dir / "cameras.txt").write_text("\n".join(cam_lines) + "\n", encoding="utf-8")
    (model_dir / "images.txt").write_text("\n".join(img_lines) + "\n", encoding="utf-8")
