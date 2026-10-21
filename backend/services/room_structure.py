"""Room structure extraction from Gaussian-splat positions (numpy only).

Pipeline (all steps run on the splat means; the splat itself is never modified):

1. Preprocess: opacity filter (logit opacities are passed through a sigmoid), voxel
   downsampling to equalise density, floater removal by voxel-neighbourhood support.
2. Gravity + floor: RANSAC for near-horizontal planes around ``up_hint``; the lowest
   well-supported one is the floor. Its normal is the gravity direction.
3. Ceiling: highest strong peak of the height histogram in the gravity-aligned frame.
4. Yaw: Manhattan alignment by maximising the sharpness of the wall-band histograms.
5. Outline: floor/ceiling footprint -> boundary polygon -> Douglas-Peucker -> every edge is
   re-fitted against wall-band points (snapped to the Manhattan axes when within
   ``manhattan_snap_deg``, free total-least-squares direction otherwise).
6. Openings: per wall, empty rectangles in the (along-wall, height) density grid; an
   optional :class:`ImageOpeningDetector` can contribute image-based detections.

Output is a :class:`RoomStructureResult` holding a contract ``RoomInterpretation`` in the
scene frame (Y-up, metres, floor at y=0) and the suggested row-major ``scanToScene``
matrix mapping scan coordinates into that frame.

Wall convention (matches fixtures/realistic_room.json): wall ``start``/``end`` are the
outline vertices, i.e. the scanned interior face. Opening ``offset`` is the distance along
the wall from ``start`` to the opening's near edge.
"""

from __future__ import annotations

import struct
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol, Sequence, Tuple

import numpy as np

from models.contracts import (
    FloorPlane,
    OpeningInterpretation,
    RoomInterpretation,
    RoomStructureResult,
    WallInterpretation,
)


@dataclass(frozen=True)
class RoomStructureParams:
    up_hint: Tuple[float, float, float] = (0.0, 1.0, 0.0)
    opacity_threshold: float = 0.2
    voxel_size: float = 0.02
    floater_voxel: float = 0.15
    max_points: int = 150_000
    ransac_iterations: int = 1500
    ransac_sample: int = 10_000
    plane_tolerance: float = 0.03
    horizontal_max_deg: float = 35.0
    min_ceiling_height: float = 1.8
    grid: float = 0.05
    manhattan_snap_deg: float = 15.0
    wall_thickness: float = 0.15
    min_wall: float = 0.3
    min_opening: float = 0.4
    seed: int = 0


class ImageOpeningDetector(Protocol):
    """Optional image-based door/window detector (e.g. a 2D detector lifted onto walls)."""

    def detect(self, walls: Sequence[WallInterpretation], ceiling_height: float) -> List[OpeningInterpretation]: ...


class RoomStructureError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load_splat_ply(path: Path) -> Tuple[np.ndarray, Optional[np.ndarray]]:
    """Return (positions Nx3, raw opacity N or None) from a 3DGS / point-cloud PLY."""
    from plyfile import PlyData

    vertex = PlyData.read(str(path))["vertex"]
    names = vertex.data.dtype.names or ()
    positions = np.stack([vertex["x"], vertex["y"], vertex["z"]], axis=-1).astype(np.float64)
    opacity = np.asarray(vertex["opacity"], dtype=np.float64) if "opacity" in names else None
    return positions, opacity


def load_colmap_points(path: Path) -> np.ndarray:
    """Read COLMAP ``points3D.txt`` or ``points3D.bin`` XYZ coordinates."""
    if path.suffix == ".txt":
        rows = [
            line.split()[1:4]
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        ]
        return np.asarray(rows, dtype=np.float64).reshape(-1, 3)
    data = path.read_bytes()
    (count,) = struct.unpack_from("<Q", data, 0)
    offset, points = 8, []
    for _ in range(count):
        _pid, x, y, z = struct.unpack_from("<Qddd", data, offset)
        offset += 8 + 24 + 3 + 8  # id, xyz, rgb, error
        (track_len,) = struct.unpack_from("<Q", data, offset)
        offset += 8 + track_len * 8
        points.append((x, y, z))
    return np.asarray(points, dtype=np.float64).reshape(-1, 3)


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def _normalize(v: np.ndarray) -> np.ndarray:
    return v / max(float(np.linalg.norm(v)), 1e-12)


def _rotation_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Rotation matrix taking unit vector a onto unit vector b (Rodrigues)."""
    a, b = _normalize(a), _normalize(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -1 + 1e-9:  # opposite: rotate pi about any axis orthogonal to a
        axis = _normalize(np.cross(a, [1.0, 0.0, 0.0] if abs(a[0]) < 0.9 else [0.0, 0.0, 1.0]))
        return 2.0 * np.outer(axis, axis) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1.0 + c)


def _rot_y(theta: float) -> np.ndarray:
    """Rotation about +Y mapping (x, z) -> (x cos + z sin, -x sin + z cos)."""
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


def _homogeneous(rot: np.ndarray, trans: Sequence[float]) -> np.ndarray:
    m = np.eye(4)
    m[:3, :3] = rot
    m[:3, 3] = trans
    return m


def _sigmoid_if_logit(opacity: np.ndarray) -> np.ndarray:
    # 3DGS PLYs store opacity as a logit; already-activated values lie in [0, 1].
    if opacity.size and (opacity.min() < 0.0 or opacity.max() > 1.0):
        return 1.0 / (1.0 + np.exp(-np.clip(opacity, -30, 30)))
    return opacity


def _voxel_keys(points: np.ndarray, size: float) -> np.ndarray:
    idx = np.floor(points / size).astype(np.int64)
    idx -= idx.min(axis=0)
    dims = idx.max(axis=0) + 3
    return (idx[:, 0] + 1) + dims[0] * ((idx[:, 1] + 1) + dims[1] * (idx[:, 2] + 1)), dims


def _voxel_downsample(points: np.ndarray, size: float) -> Tuple[np.ndarray, np.ndarray]:
    keys, _ = _voxel_keys(points, size)
    _, inverse, counts = np.unique(keys, return_inverse=True, return_counts=True)
    centroids = np.stack([np.bincount(inverse, weights=points[:, k]) for k in range(3)], axis=-1)
    return centroids / counts[:, None], counts


def _remove_floaters(points: np.ndarray, weights: np.ndarray, size: float) -> np.ndarray:
    """Keep points whose 3x3x3 coarse-voxel neighbourhood has enough support."""
    keys, dims = _voxel_keys(points, size)
    uniq, inverse = np.unique(keys, return_inverse=True)
    voxel_weight = np.bincount(inverse, weights=weights)
    support = np.zeros_like(voxel_weight)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                neighbour = uniq + dx + dims[0] * (dy + dims[1] * dz)
                pos = np.clip(np.searchsorted(uniq, neighbour), 0, len(uniq) - 1)
                support += np.where(uniq[pos] == neighbour, voxel_weight[pos], 0.0)
    threshold = max(5.0, 0.15 * float(np.median(support)))
    return support[inverse] >= threshold


def _fit_plane_lsq(points: np.ndarray) -> Tuple[np.ndarray, float]:
    centroid = points.mean(axis=0)
    _, _, vt = np.linalg.svd(points - centroid, full_matrices=False)
    normal = vt[-1]
    return normal, -float(normal @ centroid)


def _ransac_plane(
    points: np.ndarray,
    rng: np.random.Generator,
    params: RoomStructureParams,
    axis: Optional[np.ndarray] = None,
) -> Optional[Tuple[np.ndarray, float, np.ndarray]]:
    """Return (normal, d, inlier mask) with n.p + d = 0, optionally constrained near ``axis``."""
    n = len(points)
    if n < 3:
        return None
    sample = points[rng.choice(n, min(n, params.ransac_sample), replace=False)]
    tri = points[rng.integers(0, n, size=(params.ransac_iterations, 3))]
    normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    lengths = np.linalg.norm(normals, axis=1)
    ok = lengths > 1e-9
    normals, tri = normals[ok] / lengths[ok, None], tri[ok]
    if axis is not None:
        keep = np.abs(normals @ axis) >= np.cos(np.radians(params.horizontal_max_deg))
        normals, tri = normals[keep], tri[keep]
    if len(normals) == 0:
        return None
    ds = -np.einsum("ij,ij->i", normals, tri[:, 0])
    best_score, best = -1, 0
    for start in range(0, len(normals), 256):
        dist = np.abs(sample @ normals[start : start + 256].T + ds[start : start + 256])
        scores = (dist < params.plane_tolerance).sum(axis=0)
        j = int(scores.argmax())
        if scores[j] > best_score:
            best_score, best = int(scores[j]), start + j
    normal, d = normals[best], ds[best]
    for _ in range(3):  # least-squares refinement on the full set
        inliers = np.abs(points @ normal + d) < params.plane_tolerance
        if inliers.sum() < 3:
            return None
        new_normal, d = _fit_plane_lsq(points[inliers])
        if new_normal @ normal < 0:
            new_normal, d = -new_normal, -d
        normal = new_normal
    return normal, d, np.abs(points @ normal + d) < params.plane_tolerance


# ---------------------------------------------------------------------------
# 2D grid helpers (footprint, wall faces)
# ---------------------------------------------------------------------------


def _components(mask: np.ndarray) -> Tuple[np.ndarray, int]:
    """4-connected component labels (0 = background)."""
    labels = np.zeros(mask.shape, dtype=np.int32)
    count = 0
    for start in zip(*np.nonzero(mask)):
        if labels[start]:
            continue
        count += 1
        labels[start] = count
        queue = deque([start])
        while queue:
            i, j = queue.popleft()
            for ni, nj in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if 0 <= ni < mask.shape[0] and 0 <= nj < mask.shape[1] and mask[ni, nj] and not labels[ni, nj]:
                    labels[ni, nj] = count
                    queue.append((ni, nj))
    return labels, count


def _morph(mask: np.ndarray, radius: int, dilate: bool) -> np.ndarray:
    padded = np.pad(mask, radius, constant_values=not dilate)
    out = np.zeros_like(mask) if dilate else np.ones_like(mask)
    h, w = mask.shape
    for di in range(2 * radius + 1):
        for dj in range(2 * radius + 1):
            window = padded[di : di + h, dj : dj + w]
            out = (out | window) if dilate else (out & window)
    return out


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    padded = np.pad(~mask, 1, constant_values=True)
    labels, _ = _components(padded)
    exterior = labels == labels[0, 0]
    return ~exterior[1:-1, 1:-1]


def _boundary_loop(mask: np.ndarray) -> np.ndarray:
    """Outer boundary of a hole-free mask as a CCW loop of integer grid vertices (i, j)."""
    edges: Dict[Tuple[int, int], List[Tuple[int, int]]] = {}
    padded = np.pad(mask, 1)
    inside = padded[1:-1, 1:-1]
    sides = (
        (padded[1:-1, :-2], ((0, 0), (1, 0))),  # j-1 outside -> bottom edge
        (padded[2:, 1:-1], ((1, 0), (1, 1))),  # i+1 outside -> right edge
        (padded[1:-1, 2:], ((1, 1), (0, 1))),  # j+1 outside -> top edge
        (padded[:-2, 1:-1], ((0, 1), (0, 0))),  # i-1 outside -> left edge
    )
    for neighbour, ((ai, aj), (bi, bj)) in sides:
        for i, j in zip(*np.nonzero(inside & ~neighbour)):
            edges.setdefault((i + ai, j + aj), []).append((i + bi, j + bj))
    best: List[Tuple[int, int]] = []
    while edges:
        start = next(iter(edges))
        loop, current = [start], start
        while True:
            nxt = edges[current].pop()
            if not edges[current]:
                del edges[current]
            if nxt == start:
                break
            loop.append(nxt)
            current = nxt
            if current not in edges:
                break
        if len(loop) > len(best):
            best = loop
    return np.asarray(best, dtype=np.float64)


def _signed_area(poly: np.ndarray) -> float:
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def _douglas_peucker(points: np.ndarray, eps: float) -> np.ndarray:
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    ab = b - a
    norm = np.linalg.norm(ab)
    rel = points - a
    dist = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / norm if norm > 1e-12 else np.linalg.norm(rel, axis=1)
    k = int(dist.argmax())
    if dist[k] <= eps:
        return np.stack([a, b])
    return np.vstack([_douglas_peucker(points[: k + 1], eps)[:-1], _douglas_peucker(points[k:], eps)])


def _simplify_closed(loop: np.ndarray, eps: float) -> np.ndarray:
    # Start at the vertex farthest from the centroid: always a true (convex) corner.
    loop = np.roll(loop, -int(np.linalg.norm(loop - loop.mean(axis=0), axis=1).argmax()), axis=0)
    far = int(np.linalg.norm(loop - loop[0], axis=1).argmax())
    first = _douglas_peucker(loop[: far + 1], eps)
    second = _douglas_peucker(np.vstack([loop[far:], loop[:1]]), eps)
    return np.vstack([first[:-1], second[:-1]])


def _clean_polygon(poly: np.ndarray, min_edge: float, min_turn_deg: float) -> np.ndarray:
    """Drop vertices on nearly straight runs and collapse edges shorter than ``min_edge``."""
    poly = poly.copy()
    changed = True
    while changed and len(poly) > 3:
        changed = False
        for i in range(len(poly)):
            prev, cur, nxt = poly[i - 1], poly[i], poly[(i + 1) % len(poly)]
            e1, e2 = cur - prev, nxt - cur
            n1, n2 = np.linalg.norm(e1), np.linalg.norm(e2)
            turn = np.degrees(np.arccos(np.clip(e1 @ e2 / max(n1 * n2, 1e-12), -1.0, 1.0)))
            if turn < min_turn_deg or min(n1, n2) < 1e-9:
                poly = np.delete(poly, i, axis=0)
                changed = True
                break
            if n2 < min_edge:  # short edge cur->nxt: replace both ends by their midpoint
                poly[i] = (cur + nxt) / 2.0
                poly = np.delete(poly, (i + 1) % len(poly), axis=0)
                changed = True
                break
    return poly


def _intersect(c1: np.ndarray, u1: np.ndarray, c2: np.ndarray, u2: np.ndarray) -> Optional[np.ndarray]:
    denom = u1[0] * u2[1] - u1[1] * u2[0]
    if abs(denom) < np.sin(np.radians(10)):
        return None
    diff = c2 - c1
    t = (diff[0] * u2[1] - diff[1] * u2[0]) / denom
    return c1 + t * u1


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def extract_room_structure(
    positions: np.ndarray,
    opacity: Optional[np.ndarray] = None,
    colmap_points: Optional[np.ndarray] = None,
    params: RoomStructureParams = RoomStructureParams(),
    image_detector: Optional[ImageOpeningDetector] = None,
) -> RoomStructureResult:
    rng = np.random.default_rng(params.seed)
    positions = np.asarray(positions, dtype=np.float64).reshape(-1, 3)
    finite = np.isfinite(positions).all(axis=1)
    if opacity is not None:
        opacity = _sigmoid_if_logit(np.asarray(opacity, dtype=np.float64).reshape(-1))
        finite &= opacity >= params.opacity_threshold
    points = positions[finite]
    if colmap_points is not None and len(colmap_points):
        points = np.vstack([points, np.asarray(colmap_points, dtype=np.float64).reshape(-1, 3)])
    input_count = len(points)
    if input_count < 500:
        raise RoomStructureError(f"Too few usable points ({input_count}) to interpret a room.")

    # 1. Density equalisation + floater removal.
    points, weights = _voxel_downsample(points, params.voxel_size)
    keep = _remove_floaters(points, weights.astype(np.float64), params.floater_voxel)
    points = points[keep]
    if len(points) > params.max_points:
        points = points[rng.choice(len(points), params.max_points, replace=False)]

    # 2. Floor plane + gravity.
    hint = _normalize(np.asarray(params.up_hint, dtype=np.float64))
    candidates = []
    remaining = np.ones(len(points), dtype=bool)
    for _ in range(4):
        found = _ransac_plane(points[remaining], rng, params, axis=hint)
        if found is None:
            break
        normal, d, inliers = found
        if normal @ hint < 0:
            normal, d = -normal, -d
        idx = np.nonzero(remaining)[0][inliers]
        if len(idx) < 0.02 * len(points):
            break
        candidates.append((float(points[idx].mean(axis=0) @ hint), len(idx), normal, d, idx))
        remaining[idx] = False
    if not candidates:
        raise RoomStructureError("No floor plane found near the up hint.")
    max_support = max(c[1] for c in candidates)
    _, floor_support, up, floor_d, floor_idx = min(
        (c for c in candidates if c[1] >= 0.2 * max_support), key=lambda c: c[0]
    )

    rot_up = _rotation_between(up, np.array([0.0, 1.0, 0.0]))
    to_floor = _homogeneous(rot_up, (0.0, float(floor_d), 0.0))  # n.p = -d  ->  y = n.p + d
    aligned = points @ rot_up.T + np.array([0.0, floor_d, 0.0])
    tol = params.plane_tolerance
    floor_rmse = float(np.sqrt(np.mean(aligned[floor_idx, 1] ** 2)))

    # 3. Ceiling from the height histogram.
    y = aligned[:, 1]
    bins = np.arange(params.min_ceiling_height, max(float(y.max()), params.min_ceiling_height) + 0.04, 0.02)
    hist, _ = np.histogram(y, bins=bins) if len(bins) > 1 else (np.zeros(0), None)
    ceiling_conf_scale = 1.0
    if hist.size and hist.max() >= 3 * max(float(np.median(hist)), 1.0):
        peak = int(np.nonzero(hist >= 0.5 * hist.max())[0].max())
        center = bins[peak] + 0.01
        near = np.abs(y - center) < tol
        ceiling = float(np.median(y[near]))
    else:
        ceiling = float(np.percentile(y, 99.5))
        ceiling_conf_scale = 0.4
    if ceiling < params.min_ceiling_height:
        raise RoomStructureError(f"Ceiling estimate {ceiling:.2f} m is implausibly low.")
    ceiling_mask = np.abs(y - ceiling) < tol
    ceiling_tilt = 0.0
    if ceiling_mask.sum() > 50:
        c_normal, _ = _fit_plane_lsq(aligned[ceiling_mask])
        ceiling_tilt = float(np.degrees(np.arccos(min(1.0, abs(c_normal[1])))))

    # 4. Manhattan yaw from the wall band.
    band = (y > 0.2) & (y < ceiling - 0.2)
    xz = aligned[band][:, [0, 2]]
    if len(xz) > 30_000:
        xz = xz[rng.choice(len(xz), 30_000, replace=False)]

    def sharpness(theta: float) -> float:
        c, s = np.cos(theta), np.sin(theta)
        a, b = xz[:, 0] * c + xz[:, 1] * s, -xz[:, 0] * s + xz[:, 1] * c
        score = 0.0
        for coord in (a, b):
            counts = np.bincount(np.floor((coord - coord.min()) / 0.03).astype(np.int64))
            score += float(np.dot(counts, counts))
        return score

    coarse = np.radians(np.arange(0.0, 90.0, 1.0))
    theta = float(coarse[int(np.argmax([sharpness(t) for t in coarse]))])
    fine = theta + np.radians(np.arange(-1.0, 1.0001, 0.05))
    theta = float(fine[int(np.argmax([sharpness(t) for t in fine]))])
    rot_yaw = _rot_y(theta)
    aligned = aligned @ rot_yaw.T

    # 5. Footprint from floor + ceiling points.
    g = params.grid
    surface = np.zeros(len(points), dtype=bool)
    surface[floor_idx] = True
    surface |= ceiling_mask
    fxz = aligned[surface][:, [0, 2]]
    origin = fxz.min(axis=0) - 3 * g
    cells = np.floor((fxz - origin) / g).astype(np.int64)
    shape = tuple(cells.max(axis=0) + 4)
    occupancy = np.zeros(shape, dtype=bool)
    occupancy[cells[:, 0], cells[:, 1]] = True
    mask = _morph(_morph(occupancy, 2, True), 2, False)  # close sampling gaps
    mask = _morph(_morph(mask, 2, False), 2, True)  # open: drop thin floater/noise protrusions
    labels, count = _components(mask)
    if count == 0:
        raise RoomStructureError("Empty footprint.")
    sizes = np.bincount(labels.ravel())[1:]
    mask = _fill_holes(labels == (int(sizes.argmax()) + 1))
    floor_coverage = float(occupancy[mask].mean())
    ceiling_cells = np.zeros(shape, dtype=bool)
    cc = np.floor((aligned[ceiling_mask][:, [0, 2]] - origin) / g).astype(np.int64)
    cc = cc[(cc >= 0).all(axis=1) & (cc[:, 0] < shape[0]) & (cc[:, 1] < shape[1])]
    ceiling_cells[cc[:, 0], cc[:, 1]] = True
    ceiling_coverage = float(_morph(ceiling_cells, 1, True)[mask].mean())

    loop = _boundary_loop(mask) * g + origin
    if _signed_area(loop) < 0:
        loop = loop[::-1]
    poly = _clean_polygon(_simplify_closed(loop, 2.5 * g), min_edge=3 * g, min_turn_deg=12.0)

    # Centre the room on the origin in x/z.
    center = (poly.min(axis=0) + poly.max(axis=0)) / 2.0
    poly = poly - center
    aligned[:, 0] -= center[0]
    aligned[:, 2] -= center[1]
    scan_to_scene = _homogeneous(np.eye(3), (-center[0], 0.0, -center[1])) @ _homogeneous(rot_yaw, (0, 0, 0)) @ to_floor

    # 6. Refine each outline edge against wall-band points.
    wall_lo, wall_hi = min(1.0, 0.4 * ceiling), ceiling - 0.15
    wall_pts = aligned[(aligned[:, 1] > wall_lo) & (aligned[:, 1] < wall_hi)][:, [0, 2]]
    lines = []  # (anchor, direction, support, rmse, manhattan)
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        length = float(np.linalg.norm(b - a))
        u = (b - a) / max(length, 1e-9)
        snapped = False
        axis_angle = np.degrees(np.arctan2(u[1], u[0])) % 90.0
        if min(axis_angle, 90.0 - axis_angle) < params.manhattan_snap_deg:
            k = int(np.argmax(np.abs(u)))
            u = np.zeros(2)
            u[k] = np.sign((b - a)[k])
            snapped = True
        nrm = np.array([u[1], -u[0]])  # outward for a CCW polygon
        mid = (a + b) / 2.0
        rel = wall_pts - mid
        t = rel @ u
        d = rel @ nrm
        margin = min(0.15, 0.2 * length)
        sel = (np.abs(t) < length / 2.0 - margin) & (np.abs(d) < 0.25)
        anchor, direction, rmse = mid, u, 0.1
        if sel.sum() >= 20:
            offset = float(np.median(d[sel]))
            for _ in range(2):
                sel2 = sel & (np.abs(d - offset) < 0.08)
                if sel2.sum() < 20:
                    break
                offset = float(np.median(d[sel2]))
            sel = sel2 if sel2.sum() >= 20 else sel
            if snapped:
                anchor = mid + offset * nrm
                rmse = float(np.sqrt(np.mean((d[sel] - offset) ** 2)))
            else:
                pts = wall_pts[sel]
                centroid = pts.mean(axis=0)
                _, _, vt = np.linalg.svd(pts - centroid, full_matrices=False)
                direction = vt[0] if vt[0] @ u >= 0 else -vt[0]
                anchor = centroid
                rmse = float(np.sqrt(np.mean(((pts - centroid) @ np.array([direction[1], -direction[0]])) ** 2)))
        lines.append([anchor, direction, int(sel.sum()), rmse, snapped, length])

    # Prune left-over stair steps / bumps: drop walls shorter than min_wall, merge parallel neighbours.
    changed = True
    while changed and len(lines) > 3:
        changed = False
        shortest = min(range(len(lines)), key=lambda k: lines[k][5])
        if lines[shortest][5] < params.min_wall:
            del lines[shortest]
            changed = True
            continue
        for i in range(len(lines)):
            j = (i + 1) % len(lines)
            li, lj = lines[i], lines[j]
            parallel = abs(li[1][0] * lj[1][1] - li[1][1] * lj[1][0]) < np.sin(np.radians(10))
            offset = abs((lj[0] - li[0]) @ np.array([li[1][1], -li[1][0]]))
            if parallel and offset < 0.15:
                keep_line = li if li[2] >= lj[2] else lj
                lines[i] = [keep_line[0], keep_line[1], li[2] + lj[2], keep_line[3], keep_line[4], li[5] + lj[5]]
                del lines[j]
                changed = True
                break

    corners = []
    for i in range(len(lines)):
        prev, cur = lines[i - 1], lines[i]
        p = _intersect(prev[0], prev[1], cur[0], cur[1])
        corners.append(p if p is not None else (prev[0] + cur[0]) / 2.0)
    outline = np.asarray(corners)
    if len(outline) < 3 or _signed_area(outline) <= 0:
        raise RoomStructureError("Could not build a valid room outline.")

    # 7. Walls + openings.
    walls: List[WallInterpretation] = []
    openings: List[OpeningInterpretation] = []
    face_pts = aligned
    for i in range(len(outline)):
        a, b = outline[i], outline[(i + 1) % len(outline)]
        line = lines[i]
        length = float(np.linalg.norm(b - a))
        wall_id = f"wall_{i}"
        u = (b - a) / max(length, 1e-9)
        nrm = np.array([u[1], -u[0]])
        rel = face_pts[:, [0, 2]] - a
        t, d = rel @ u, rel @ nrm
        on_face = (np.abs(d) < 0.1) & (t >= 0) & (t <= length) & (face_pts[:, 1] >= 0) & (face_pts[:, 1] <= ceiling)
        ns, ny = max(1, int(np.ceil(length / g))), max(1, int(np.ceil(ceiling / g)))
        grid = np.zeros((ns, ny))
        si = np.clip((t[on_face] / g).astype(np.int64), 0, ns - 1)
        yi = np.clip((face_pts[on_face, 1] / g).astype(np.int64), 0, ny - 1)
        np.add.at(grid, (si, yi), 1.0)
        reference = float(np.median(grid[grid > 0])) if (grid > 0).any() else 0.0
        empty = grid < 0.2 * reference if reference > 0 else np.ones_like(grid, dtype=bool)
        wall_openings = _detect_openings(
            grid, empty, reference, t[on_face], face_pts[on_face, 1], g, ceiling, length, wall_id, params.min_opening
        )
        opening_cells = np.zeros_like(empty)
        for op in wall_openings:
            s0, s1 = int(op.offset / g), int((op.offset + op.width) / g)
            y0, y1 = int(op.sill / g), int((op.sill + op.height) / g)
            opening_cells[s0:s1, y0:y1] = True
        solid = ~opening_cells
        coverage = float((~empty)[solid].mean()) if solid.any() else 0.0
        fit_quality = float(np.exp(-line[3] / 0.03)) if line[2] >= 20 else 0.0
        confidence = float(np.clip(0.5 * coverage + 0.5 * fit_quality, 0.0, 1.0))
        walls.append(
            WallInterpretation(
                id=wall_id,
                start=(float(a[0]), 0.0, float(a[1])),
                end=(float(b[0]), 0.0, float(b[1])),
                height=ceiling,
                thickness=params.wall_thickness,
                confidence=round(confidence, 3),
                provenance="auto",
            )
        )
        openings.extend(wall_openings)

    if image_detector is not None:
        openings = merge_openings(openings, image_detector.detect(walls, ceiling))

    gravity_conf = float(np.exp(-ceiling_tilt / 3.0)) if ceiling_mask.sum() > 50 else 0.5
    floor_conf = float(np.clip(0.6 * floor_coverage + 0.4 * np.exp(-floor_rmse / 0.02), 0.0, 1.0))
    ceiling_conf = float(np.clip(ceiling_conf_scale * (0.6 * ceiling_coverage + 0.4 * gravity_conf), 0.0, 1.0))
    manhattan = all(line[4] for line in lines)

    interpretation = RoomInterpretation(
        provenance="auto",
        floor=FloorPlane(normal=(0.0, 1.0, 0.0), constant=0.0, provenance="auto", confidence=round(floor_conf, 3)),
        ceilingHeight=ceiling,
        ceilingConfidence=round(ceiling_conf, 3),
        outline=[(float(p[0]), float(p[1])) for p in outline],
        walls=walls,
        openings=openings,
        detections=[],
    )
    diagnostics: Dict[str, Any] = {
        "inputPoints": int(len(positions)),
        "usedPoints": int(len(points)),
        "floorInliers": int(floor_support),
        "floorRmse": floor_rmse,
        "ceilingTiltDeg": ceiling_tilt,
        "yawDeg": float(np.degrees(theta)),
        "manhattan": manhattan,
        "scanUp": [float(v) for v in up],
    }
    return RoomStructureResult(
        interpretation=interpretation,
        scanToScene=tuple(float(v) for v in scan_to_scene.ravel()),
        gravityConfidence=round(gravity_conf, 3),
        manhattan=manhattan,
        diagnostics=diagnostics,
    )


def _refine_edge(values: np.ndarray, edge: float, g: float, solid_below: bool) -> float:
    """Sub-cell edge from the extreme solid-side points next to a cell-quantised edge."""
    near = values[np.abs(values - edge) < 3 * g]
    if len(near) < 5:
        return edge
    return float(np.percentile(near, 95 if solid_below else 5))


def _detect_openings(
    grid: np.ndarray,
    empty: np.ndarray,
    reference: float,
    ts: np.ndarray,
    ys: np.ndarray,
    g: float,
    ceiling: float,
    length: float,
    wall_id: str,
    min_size: float,
) -> List[OpeningInterpretation]:
    labels, count = _components(empty)
    result: List[OpeningInterpretation] = []
    for label in range(1, count + 1):
        si, yi = np.nonzero(labels == label)
        s0, s1, y0, y1 = si.min(), si.max() + 1, yi.min(), yi.max() + 1
        fill = len(si) / float((s1 - s0) * (y1 - y0))
        if (s1 - s0) * g < min_size or (y1 - y0) * g < min_size or fill < 0.5 or y1 * g < 1.2:
            continue
        if (s1 - s0) * g > 0.9 * length and (y1 - y0) * g > 0.9 * ceiling:
            continue  # wall not observed at all, not an opening
        rows = (ys > (y0 + 1) * g) & (ys < (y1 - 1) * g)
        cols = (ts > (s0 + 1) * g) & (ts < (s1 - 1) * g)
        left = _refine_edge(ts[rows], s0 * g, g, True) if s0 > 0 else 0.0
        right = _refine_edge(ts[rows], s1 * g, g, False) if s1 * g < length else length
        sill = _refine_edge(ys[cols], y0 * g, g, True) if y0 * g >= 0.1 else 0.0
        top = _refine_edge(ys[cols], y1 * g, g, False) if y1 * g < ceiling else ceiling
        width, height = right - left, min(top, ceiling) - sill
        if width < min_size or height < min_size:
            continue
        if sill == 0.0 and height >= 1.7:
            kind = "door"
        elif sill >= 0.3 and top <= ceiling - 0.05:
            kind = "window"
        else:
            kind = "opening"
        box = grid[s0:s1, y0:y1]
        contrast = 1.0 - min(1.0, float(box.mean()) / reference) if reference > 0 else 0.5
        plausible = 0.9 if kind != "opening" else 0.6
        result.append(
            OpeningInterpretation(
                id=f"{kind}_{wall_id}_{len(result)}",
                wallId=wall_id,
                kind=kind,
                offset=float(max(left, 0.0)),
                width=float(width),
                height=float(height),
                sill=float(sill),
                confidence=round(float(np.clip(fill * contrast * plausible, 0.0, 1.0)), 3),
                provenance="auto",
            )
        )
    return result


def merge_openings(
    geometric: List[OpeningInterpretation], from_images: List[OpeningInterpretation]
) -> List[OpeningInterpretation]:
    """Fuse image detections into geometric ones: overlapping pairs take the image kind and
    the higher confidence; unmatched image detections are appended."""
    merged = list(geometric)
    for det in from_images:
        match = None
        for k, op in enumerate(merged):
            overlap = min(op.offset + op.width, det.offset + det.width) - max(op.offset, det.offset)
            if op.wallId == det.wallId and overlap > 0.5 * min(op.width, det.width):
                match = k
                break
        if match is None:
            merged.append(det)
        else:
            op = merged[match]
            merged[match] = op.model_copy(
                update={"kind": det.kind, "confidence": min(1.0, max(op.confidence, det.confidence) + 0.05)}
            )
    return merged
