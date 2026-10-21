"""Geometry helpers: scene transforms, point projection/visibility, OBB fitting and IoU."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .colmap import Camera, ColmapImage


@dataclass(frozen=True)
class View:
    """A camera in the scene frame (Y-up, meters)."""

    name: str
    camera: Camera
    R: np.ndarray  # rows are camera axes in scene coordinates (scene -> camera)
    center: np.ndarray  # camera position in scene coordinates


def split_similarity(matrix: list[float] | np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Split a row-major 4x4 scanToScene into (A, rotation Q, translation b); A = s*Q."""
    m = np.asarray(matrix, dtype=np.float64).reshape(4, 4)
    a = m[:3, :3]
    det = np.linalg.det(a)
    if abs(det) < 1e-12:
        raise ValueError("scanToScene is singular")
    q = a / np.cbrt(abs(det))
    return a, q, m[:3, 3]


def make_view(image: ColmapImage, camera: Camera, scan_to_scene: list[float] | np.ndarray) -> View:
    a, q, b = split_similarity(scan_to_scene)
    return View(image.name, camera, image.R_cw @ q.T, a @ image.center + b)


def transform_points(points: np.ndarray, scan_to_scene: list[float] | np.ndarray) -> np.ndarray:
    a, _, b = split_similarity(scan_to_scene)
    return points @ a.T + b


def project(view: View, points: np.ndarray, near: float = 0.05) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (u, v, z) in full-resolution pixels; z <= near entries are NaN."""
    cam = (points - view.center) @ view.R.T
    z = cam[:, 2]
    ok = z > near
    safe = np.where(ok, z, 1.0)
    u = view.camera.fx * cam[:, 0] / safe + view.camera.cx
    v = view.camera.fy * cam[:, 1] / safe + view.camera.cy
    u[~ok] = np.nan
    v[~ok] = np.nan
    z = np.where(ok, z, np.nan)
    return u, v, z


def visible_in_view(
    view: View,
    points: np.ndarray,
    grid_max: int = 320,
    dilate: int = 1,
    rel_tol: float = 0.02,
    abs_tol: float = 0.04,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Per-point visibility from a point z-buffer.

    Returns (u, v, z, visible) with u/v in full-resolution pixels. A point is visible when it is
    within the image and not behind the nearest point (3x3-dilated) of its z-buffer cell.
    """
    cam = view.camera
    u, v, z = project(view, points)
    g = min(1.0, grid_max / max(cam.width, cam.height))
    gw, gh = max(1, int(math.ceil(cam.width * g))), max(1, int(math.ceil(cam.height * g)))
    inside = np.isfinite(z) & (u >= 0) & (u < cam.width) & (v >= 0) & (v < cam.height)
    idx = np.nonzero(inside)[0]
    visible = np.zeros(len(points), dtype=bool)
    if idx.size == 0:
        return u, v, z, visible
    ix = np.minimum((u[idx] * g).astype(np.int64), gw - 1)
    iy = np.minimum((v[idx] * g).astype(np.int64), gh - 1)
    zi = z[idx]
    zbuf = np.full((gh, gw), np.inf)
    order = np.argsort(-zi)  # far to near: the last write per cell is the nearest
    zbuf[iy[order], ix[order]] = zi[order]
    if dilate > 0:
        padded = np.pad(zbuf, dilate, constant_values=np.inf)
        out = np.full_like(zbuf, np.inf)
        for dy in range(2 * dilate + 1):
            for dx in range(2 * dilate + 1):
                out = np.minimum(out, padded[dy : dy + gh, dx : dx + gw])
        zbuf = out
    visible[idx] = zi <= zbuf[iy, ix] * (1.0 + rel_tol) + abs_tol
    return u, v, z, visible


def front_depth_group(depths: np.ndarray, gap: float = 0.15, min_points: int = 25) -> np.ndarray:
    """Boolean mask selecting the nearest depth-contiguous group with at least min_points."""
    if depths.size == 0:
        return np.zeros(0, dtype=bool)
    order = np.argsort(depths)
    sorted_d = depths[order]
    breaks = np.nonzero(np.diff(sorted_d) > gap)[0] + 1
    for lo, hi in zip(np.concatenate(([0], breaks)), np.concatenate((breaks, [len(sorted_d)])), strict=True):
        if hi - lo >= min_points:
            mask = np.zeros(depths.size, dtype=bool)
            mask[order[lo:hi]] = True
            return mask
    return np.zeros(depths.size, dtype=bool)


# ---------------------------------------------------------------------------
# OBB (center, size, yaw) with yaw about +Y: local x = (cos yaw, 0, -sin yaw)
# ---------------------------------------------------------------------------


def yaw_axes(yaw: float) -> tuple[np.ndarray, np.ndarray]:
    return np.array([math.cos(yaw), -math.sin(yaw)]), np.array([math.sin(yaw), math.cos(yaw)])


def fit_obb(
    points: np.ndarray,
    trim: float = 1.0,
    floor_snap: float = 0.15,
    yaw_step_deg: float = 1.0,
    max_points: int = 20000,
) -> tuple[tuple[float, float, float], tuple[float, float, float], float]:
    """Fit a yaw-only OBB (Y up). Yaw is the min-area bounding rectangle on XZ, found by a brute-force
    angle sweep (PCA is not used: it is unstable for near-square footprints). The long side becomes local x.

    Returns (center, size, yaw) with size_x >= size_z and yaw in (-pi/2, pi/2].
    """
    if len(points) > max_points:
        points = points[np.linspace(0, len(points) - 1, max_points).astype(np.int64)]
    xz = points[:, [0, 2]]
    med = np.median(xz, axis=0)
    centered = xz - med
    lo_q, hi_q = trim, 100.0 - trim

    def extents(yaw: float) -> tuple[float, float, float, float]:
        ax, az = yaw_axes(yaw)
        a, b = centered @ ax, centered @ az
        a0, a1 = np.percentile(a, [lo_q, hi_q])
        b0, b1 = np.percentile(b, [lo_q, hi_q])
        return a0, a1, b0, b1

    best_yaw, best_area = 0.0, math.inf
    for deg in np.arange(0.0, 90.0, yaw_step_deg):
        yaw = math.radians(deg)
        a0, a1, b0, b1 = extents(yaw)
        area = (a1 - a0) * (b1 - b0)
        if area < best_area - 1e-9:
            best_area, best_yaw = area, yaw
    yaw = best_yaw
    a0, a1, b0, b1 = extents(yaw)
    if (b1 - b0) > (a1 - a0):  # make local x the long side
        yaw += math.pi / 2
    yaw = (yaw + math.pi / 2) % math.pi - math.pi / 2
    if yaw <= -math.pi / 2 + 1e-9:
        yaw = math.pi / 2
    a0, a1, b0, b1 = extents(yaw)
    size_x, size_z = a1 - a0, b1 - b0
    ax, az = yaw_axes(yaw)
    cxz = med + (a0 + a1) / 2 * ax + (b0 + b1) / 2 * az

    y_lo, y_hi = np.percentile(points[:, 1], [trim, 100.0 - trim])
    if y_lo < floor_snap:
        y_lo = 0.0
    size_y = max(float(y_hi - y_lo), 1e-3)
    return (float(cxz[0]), float((y_lo + y_hi) / 2), float(cxz[1])), (float(size_x), size_y, float(size_z)), float(yaw)


def obb_corners_xz(center: tuple[float, float, float], size: tuple[float, float, float], yaw: float) -> np.ndarray:
    ax, az = yaw_axes(yaw)
    c = np.array([center[0], center[2]])
    hx, hz = size[0] / 2, size[2] / 2
    return np.array([c + sx * hx * ax + sz * hz * az for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])


def _clip_polygon(subject: list[np.ndarray], clip: np.ndarray) -> list[np.ndarray]:
    """Sutherland-Hodgman clip of a polygon by a convex CCW polygon."""
    out = subject
    for i in range(len(clip)):
        a, b = clip[i], clip[(i + 1) % len(clip)]
        edge = b - a
        inp, out = out, []
        if not inp:
            break

        def side(p: np.ndarray, a: np.ndarray = a, edge: np.ndarray = edge) -> float:
            return edge[0] * (p[1] - a[1]) - edge[1] * (p[0] - a[0])

        for j in range(len(inp)):
            cur, prev = inp[j], inp[j - 1]
            sc, sp = side(cur), side(prev)
            if sc >= 0:
                if sp < 0:
                    out.append(prev + (cur - prev) * (sp / (sp - sc)))
                out.append(cur)
            elif sp >= 0:
                out.append(prev + (cur - prev) * (sp / (sp - sc)))
    return out


def _polygon_area(poly: list[np.ndarray] | np.ndarray) -> float:
    if len(poly) < 3:
        return 0.0
    p = np.asarray(poly)
    x, y = p[:, 0], p[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2)


def obb_iou(
    a: tuple[tuple[float, float, float], tuple[float, float, float], float],
    b: tuple[tuple[float, float, float], tuple[float, float, float], float],
) -> float:
    """Exact 3D IoU of two yaw-only OBBs (XZ polygon intersection x Y overlap)."""

    def ccw(poly: np.ndarray) -> np.ndarray:
        return poly if _signed_area(poly) > 0 else poly[::-1]

    pa, pb = ccw(obb_corners_xz(*a)), ccw(obb_corners_xz(*b))
    inter_area = _polygon_area(_clip_polygon(list(pa), pb))
    ya0, ya1 = a[0][1] - a[1][1] / 2, a[0][1] + a[1][1] / 2
    yb0, yb1 = b[0][1] - b[1][1] / 2, b[0][1] + b[1][1] / 2
    inter_h = max(0.0, min(ya1, yb1) - max(ya0, yb0))
    inter = inter_area * inter_h
    va = a[1][0] * a[1][1] * a[1][2]
    vb = b[1][0] * b[1][1] * b[1][2]
    union = va + vb - inter
    return float(inter / union) if union > 0 else 0.0


def _signed_area(poly: np.ndarray) -> float:
    x, y = poly[:, 0], poly[:, 1]
    return float((np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2)
