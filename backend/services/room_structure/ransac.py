"""Seeded, vectorised RANSAC primitives for planes (3D) and lines (2D)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class PlaneFit:
    normal: np.ndarray  # unit (3,)
    d: float  # plane: normal . p + d = 0
    inliers: np.ndarray  # bool mask over the input points

    @property
    def count(self) -> int:
        return int(self.inliers.sum())


def fit_plane_svd(points: np.ndarray) -> tuple[np.ndarray, float]:
    centroid = points.mean(axis=0)
    _, _, vt = np.linalg.svd(points - centroid, full_matrices=False)
    normal = vt[-1]
    return normal, float(-normal @ centroid)


def ransac_plane(
    points: np.ndarray,
    rng: np.random.Generator,
    threshold: float,
    iterations: int = 300,
    normal_hint: np.ndarray | None = None,
    max_angle_deg: float = 10.0,
    batch: int = 64,
) -> PlaneFit | None:
    """Best plane by inlier count; optionally restricted to normals near `normal_hint`."""
    n_pts = len(points)
    if n_pts < 3:
        return None
    cos_limit = np.cos(np.radians(max_angle_deg))
    best_count, best = 0, None
    for _ in range(0, iterations, batch):
        idx = rng.integers(0, n_pts, size=(batch, 3))
        a, b, c = points[idx[:, 0]], points[idx[:, 1]], points[idx[:, 2]]
        normals = np.cross(b - a, c - a)
        norms = np.linalg.norm(normals, axis=1)
        valid = norms > 1e-9
        normals[valid] /= norms[valid, None]
        if normal_hint is not None:
            valid &= np.abs(normals @ normal_hint) > cos_limit
        if not valid.any():
            continue
        normals, a = normals[valid], a[valid]
        d = -np.einsum("ij,ij->i", normals, a)
        counts = (np.abs(normals @ points.T + d[:, None]) < threshold).sum(axis=1)
        k = int(counts.argmax())
        if counts[k] > best_count:
            best_count, best = int(counts[k]), (normals[k], float(d[k]))
    if best is None or best_count < 3:
        return None
    normal, d = best
    inliers = np.abs(points @ normal + d) < threshold
    for _ in range(3):  # least-squares refinement on the consensus set
        if inliers.sum() < 3:
            break
        normal, d = fit_plane_svd(points[inliers])
        inliers = np.abs(points @ normal + d) < threshold
    return PlaneFit(normal, d, inliers)


def extract_planes(
    points: np.ndarray,
    rng: np.random.Generator,
    threshold: float,
    max_planes: int = 8,
    min_inlier_fraction: float = 0.03,
    iterations: int = 300,
) -> list[PlaneFit]:
    """Sequential RANSAC: peel off the dominant plane, repeat on the remainder."""
    remaining = np.arange(len(points))
    min_count = max(30, int(min_inlier_fraction * len(points)))
    planes: list[PlaneFit] = []
    for _ in range(max_planes):
        if len(remaining) < min_count:
            break
        fit = ransac_plane(points[remaining], rng, threshold, iterations)
        if fit is None or fit.count < min_count:
            break
        full = np.zeros(len(points), dtype=bool)
        full[remaining[fit.inliers]] = True
        planes.append(PlaneFit(fit.normal, fit.d, full))
        remaining = remaining[~fit.inliers]
    return planes


def ransac_line_2d(
    points: np.ndarray,
    rng: np.random.Generator,
    threshold: float,
    direction_hint: np.ndarray | None = None,
    max_angle_deg: float = 12.0,
    iterations: int = 200,
) -> tuple[np.ndarray, float, np.ndarray] | None:
    """Line `n . p = c` with the most inliers; returns (n, c, inlier_mask)."""
    n_pts = len(points)
    if n_pts < 2:
        return None
    idx = rng.integers(0, n_pts, size=(iterations, 2))
    a, b = points[idx[:, 0]], points[idx[:, 1]]
    d = b - a
    length = np.linalg.norm(d, axis=1)
    valid = length > 0.05
    if direction_hint is not None:
        valid &= np.abs(d @ direction_hint) > np.cos(np.radians(max_angle_deg)) * length
    if not valid.any():
        return None
    d, a, length = d[valid], a[valid], length[valid]
    normals = np.stack([-d[:, 1], d[:, 0]], axis=1) / length[:, None]
    offsets = np.einsum("ij,ij->i", normals, a)
    counts = (np.abs(normals @ points.T - offsets[:, None]) < threshold).sum(axis=1)
    k = int(counts.argmax())
    normal, offset = normals[k], float(offsets[k])
    inliers = np.abs(points @ normal - offset) < threshold
    for _ in range(3):
        if inliers.sum() < 2:
            break
        pts = points[inliers]
        centroid = pts.mean(axis=0)
        _, _, vt = np.linalg.svd(pts - centroid, full_matrices=False)
        normal = vt[-1]
        offset = float(normal @ centroid)
        inliers = np.abs(points @ normal - offset) < threshold
    return normal, offset, inliers
