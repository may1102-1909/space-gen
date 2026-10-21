"""Camera projection and oriented-box geometry in the scene frame (Y-up, meters, floor y=0).

Yaw follows three.js `rotation.y`: local +X maps to (cos yaw, 0, -sin yaw) and local +Z to (sin yaw, 0, cos yaw).
Matrix4 values are row-major (as passed to three.js `Matrix4.set`).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def matrix4(values) -> np.ndarray:
    m = np.asarray(values, dtype=float)
    return m.reshape(4, 4)


def apply_matrix(m: np.ndarray, points: np.ndarray) -> np.ndarray:
    return points @ m[:3, :3].T + m[:3, 3]


@dataclass
class CameraView:
    """Pinhole camera that projects scene-frame points. R, t map scene -> camera (OpenCV axes)."""

    K: np.ndarray
    R: np.ndarray
    t: np.ndarray
    width: int
    height: int
    depth_scale: float = 1.0  # camera-z units per scene meter

    @classmethod
    def from_colmap(cls, K, R_wc, t_wc, width, height, scene_to_colmap: np.ndarray | None = None) -> "CameraView":
        if scene_to_colmap is None:
            scene_to_colmap = np.eye(4)
        A, b = scene_to_colmap[:3, :3], scene_to_colmap[:3, 3]
        scale = float(np.cbrt(abs(np.linalg.det(A))))
        return cls(np.asarray(K, float), R_wc @ A, R_wc @ b + t_wc, int(width), int(height), scale)

    @property
    def center(self) -> np.ndarray:
        return -np.linalg.solve(self.R, self.t)

    def project(self, points: np.ndarray):
        """Return (uv pixels (N,2), depth in scene meters (N,))."""
        cam = points @ self.R.T + self.t
        z = cam[:, 2]
        safe = np.where(np.abs(z) < 1e-9, 1e-9, z)
        uv = (cam[:, :2] / safe[:, None]) * np.array([self.K[0, 0], self.K[1, 1]]) + np.array(
            [self.K[0, 2], self.K[1, 2]]
        )
        return uv, z / self.depth_scale

    def in_image(self, uv: np.ndarray, depth: np.ndarray, near: float = 0.05) -> np.ndarray:
        return (depth > near) & (uv[:, 0] >= 0) & (uv[:, 0] < self.width) & (uv[:, 1] >= 0) & (uv[:, 1] < self.height)


def look_at_view(eye, target, K, width, height) -> CameraView:
    """OpenCV-convention camera at `eye` looking at `target` with scene +Y up."""
    eye, target = np.asarray(eye, float), np.asarray(target, float)
    z = target - eye
    z /= np.linalg.norm(z)
    x = np.cross(z, [0.0, 1.0, 0.0])  # image right
    x /= np.linalg.norm(x)
    y = np.cross(z, x)  # image down
    R = np.stack([x, y, z])
    return CameraView(np.asarray(K, float), R, -R @ eye, width, height)


def yaw_axes(yaw: float):
    c, s = np.cos(yaw), np.sin(yaw)
    return np.array([c, 0.0, -s]), np.array([s, 0.0, c])


def obb_corners(center, size, yaw) -> np.ndarray:
    ax, az = yaw_axes(yaw)
    half = np.asarray(size, float) / 2
    signs = np.array([[sx, sy, sz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)], float)
    return (
        np.asarray(center, float)
        + (signs[:, :1] * half[0]) * ax
        + (signs[:, 1:2] * half[1]) * np.array([0, 1.0, 0])
        + (signs[:, 2:] * half[2]) * az
    )


def points_in_obb(points: np.ndarray, center, size, yaw) -> np.ndarray:
    ax, az = yaw_axes(yaw)
    d = points - np.asarray(center, float)
    half = np.asarray(size, float) / 2
    return (np.abs(d @ ax) <= half[0]) & (np.abs(d[:, 1]) <= half[1]) & (np.abs(d @ az) <= half[2])


def _footprint(center, size, yaw) -> np.ndarray:
    ax, az = yaw_axes(yaw)
    c = np.array([center[0], center[2]])
    ex, ez = ax[[0, 2]] * size[0] / 2, az[[0, 2]] * size[2] / 2
    return np.array([c - ex - ez, c + ex - ez, c + ex + ez, c - ex + ez])


def _polygon_area(poly: np.ndarray) -> float:
    if len(poly) < 3:
        return 0.0
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def _clip_convex(subject: np.ndarray, clip: np.ndarray) -> np.ndarray:
    """Sutherland-Hodgman clip of a convex polygon against another (both CCW or both CW)."""
    sign = 1.0 if _signed_area(clip) > 0 else -1.0
    output = list(subject)
    for i in range(len(clip)):
        a, b = clip[i], clip[(i + 1) % len(clip)]
        inp, output = output, []
        if not inp:
            break

        def side(p):
            return sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))

        for j in range(len(inp)):
            cur, prev = inp[j], inp[j - 1]
            sc, sp = side(cur), side(prev)
            if sc >= 0:
                if sp < 0:
                    output.append(prev + (cur - prev) * (sp / (sp - sc)))
                output.append(cur)
            elif sp >= 0:
                output.append(prev + (cur - prev) * (sp / (sp - sc)))
    return np.array(output) if output else np.zeros((0, 2))


def _signed_area(poly: np.ndarray) -> float:
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def obb_iou(a: dict, b: dict) -> float:
    """3D IoU of two yaw-only OBBs given as dicts with center/size/yaw."""
    pa, pb = _footprint(a["center"], a["size"], a["yaw"]), _footprint(b["center"], b["size"], b["yaw"])
    inter_area = _polygon_area(_clip_convex(pa, pb))
    ya = (a["center"][1] - a["size"][1] / 2, a["center"][1] + a["size"][1] / 2)
    yb = (b["center"][1] - b["size"][1] / 2, b["center"][1] + b["size"][1] / 2)
    inter = inter_area * max(0.0, min(ya[1], yb[1]) - max(ya[0], yb[0]))
    vol_a = float(np.prod(a["size"]))
    vol_b = float(np.prod(b["size"]))
    union = vol_a + vol_b - inter
    return inter / union if union > 0 else 0.0


def fit_obb(points: np.ndarray, floor_snap: float = 0.1, lo: float = 2.0, hi: float = 98.0) -> dict:
    """Robust yaw-only OBB: minimum-area footprint over yaw in [0, 90deg), percentile extents."""
    xz = points[:, [0, 2]]
    best = None
    for yaw in np.deg2rad(np.arange(0.0, 90.0, 1.0)):
        c, s = np.cos(yaw), np.sin(yaw)
        lx = xz[:, 0] * c - xz[:, 1] * s
        lz = xz[:, 0] * s + xz[:, 1] * c
        bx, bz = np.percentile(lx, [lo, hi]), np.percentile(lz, [lo, hi])
        area = (bx[1] - bx[0]) * (bz[1] - bz[0])
        if best is None or area < best[0]:
            best = (area, yaw, bx, bz)
    _, yaw, bx, bz = best
    y0, y1 = np.percentile(points[:, 1], [lo, hi])
    if y0 < floor_snap:
        y0 = 0.0
    ax, az = yaw_axes(yaw)
    mx, mz = (bx[0] + bx[1]) / 2, (bz[0] + bz[1]) / 2
    center_xz = mx * ax + mz * az
    return {
        "center": (float(center_xz[0]), float((y0 + y1) / 2), float(center_xz[2])),
        "size": (float(bx[1] - bx[0]), float(y1 - y0), float(bz[1] - bz[0])),
        "yaw": float(yaw),
    }
