"""Room structure from splat positions: gravity, floor, ceiling, walls, outline, openings.

Pipeline (deterministic for a given seed):
1. Filter by opacity and density; optional COLMAP points are merged in.
2. Gravity: sequential plane RANSAC, vote for the axis that explains the planes
   (floor/ceiling parallel, walls perpendicular). Floor/ceiling heights from a height
   histogram, floor normal refined by a normal-constrained RANSAC.
3. Dominant wall direction by projection sharpness (Manhattan prior). The scene frame is yawed so
   walls run along X/Z and centred at the origin; this becomes the suggested scanToScene.
4. Outline: floor-level occupancy raster -> contour polygon. Each polygon edge is snapped to a
   fitted wall line (axis-locked when the room is Manhattan, free-direction RANSAC otherwise).
5. Openings per wall from gaps in the wall-plane density (see openings.py).

All output is in the scene frame produced by `scan_to_scene` (Y-up, metres, floor at y=0).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import cv2
import numpy as np

from models.contracts import (
    FloorPlane,
    OpeningInterpretation,
    RoomInterpretation,
    WallInterpretation,
)

from .openings import OpeningDetector, detect_openings, merge_external_openings
from .ransac import extract_planes, ransac_line_2d, ransac_plane

ProgressFn = Callable[[str, float], None]


class RoomStructureError(RuntimeError):
    """Input is unusable (too few points, no floor, degenerate footprint)."""


@dataclass(frozen=True)
class RoomStructureOptions:
    min_opacity: float = 0.35
    scale: float = 1.0  # multiplies scan units into metres before analysis
    up_hint: tuple[float, float, float] | None = None  # scan-frame up vector, overrides voting
    seed: int = 7
    max_points: int = 300_000
    plane_threshold: float = 0.03
    grid_res: float = 0.04
    wall_thickness: float = 0.1
    manhattan_tolerance_deg: float = 7.0
    manhattan_min_fraction: float = 0.85
    detect_openings: bool = True


@dataclass
class RoomStructureResult:
    interpretation: RoomInterpretation
    scan_to_scene: tuple[float, ...]  # row-major 4x4, matches frontend Matrix4
    diagnostics: dict[str, Any] = field(default_factory=dict)


# --------------------------------------------------------------------------- preprocessing


def prepare_points(
    positions: np.ndarray,
    opacity: np.ndarray | None,
    colmap_points: np.ndarray | None,
    opts: RoomStructureOptions,
    rng: np.random.Generator,
) -> np.ndarray:
    pts = np.asarray(positions, dtype=np.float64).reshape(-1, 3)
    keep = np.isfinite(pts).all(axis=1)
    if opacity is not None:
        keep &= np.asarray(opacity, dtype=np.float64) >= opts.min_opacity
    pts = pts[keep]
    if colmap_points is not None and len(colmap_points):
        extra = np.asarray(colmap_points, dtype=np.float64).reshape(-1, 3)
        pts = np.concatenate([pts, extra[np.isfinite(extra).all(axis=1)]])
    pts = pts * opts.scale
    if len(pts) < 500:
        raise RoomStructureError(f"Too few usable splats ({len(pts)}) after opacity filtering.")

    lo, hi = np.percentile(pts, 0.5, axis=0), np.percentile(pts, 99.5, axis=0)
    span = np.maximum(hi - lo, 1e-6)
    pts = pts[((pts > lo - span) & (pts < hi + span)).all(axis=1)]

    # Drop sparse voxels (floaters): keep voxels with a fraction of the typical surface density.
    cells = np.floor((pts - pts.min(axis=0)) / 0.1).astype(np.int64)
    if cells.max() > 2_000_000:
        raise RoomStructureError("Scan extent is implausible for metres; pass a scale factor.")
    dims = cells.max(axis=0) + 1
    keys = (cells[:, 0] * dims[1] + cells[:, 1]) * dims[2] + cells[:, 2]
    _, inverse, counts = np.unique(keys, return_inverse=True, return_counts=True)
    threshold = max(2.0, 0.05 * float(np.median(counts)))
    pts = pts[counts[inverse] >= threshold]
    if len(pts) < 500:
        raise RoomStructureError("Too few points remain after density filtering.")
    if len(pts) > opts.max_points:
        pts = pts[rng.choice(len(pts), opts.max_points, replace=False)]
    return pts


# --------------------------------------------------------------------------- gravity / floor


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def estimate_up(pts: np.ndarray, rng: np.random.Generator, opts: RoomStructureOptions) -> tuple[np.ndarray, float]:
    """Vote for the axis best explained by the dominant planes. Returns (up axis, confidence)."""
    sub = pts[rng.choice(len(pts), min(len(pts), 30_000), replace=False)]
    planes = extract_planes(sub, rng, opts.plane_threshold)
    if not planes:
        raise RoomStructureError("No dominant planes found; scan does not look like an interior.")
    normals = np.array([p.normal for p in planes])
    counts = np.array([p.count for p in planes], dtype=float)

    candidates = [n for n in normals]
    for i in range(len(normals)):
        for j in range(i + 1, len(normals)):
            if abs(normals[i] @ normals[j]) < 0.15:
                candidates.append(_unit(np.cross(normals[i], normals[j])))
    unique: list[np.ndarray] = []
    for c in candidates:
        if not any(abs(c @ u) > 0.995 for u in unique):
            unique.append(c)

    extents = np.array([np.subtract(*np.percentile(sub @ u, [98, 2])) for u in unique])
    cos_par, sin_perp = np.cos(np.radians(6.0)), np.sin(np.radians(6.0))
    scores = []
    for u, extent in zip(unique, extents):
        dots = np.abs(normals @ u)
        vote = np.where(dots > cos_par, 1.0, np.where(dots < sin_perp, 0.6, 0.0))
        scores.append(float((counts * vote).sum()) * (1.0 + 0.5 * (1.0 - extent / extents.max())))
    order = np.argsort(scores)[::-1]
    best = unique[order[0]]
    rivals = [scores[k] for k in order[1:] if abs(unique[k] @ best) < 0.9]
    margin = (scores[order[0]] - rivals[0]) / scores[order[0]] if rivals else 1.0
    return best, float(np.clip(0.3 + 2.0 * margin, 0.3, 1.0))


def _height_peaks(h: np.ndarray, bin_size: float = 0.02) -> tuple[np.ndarray, np.ndarray, float]:
    lo, hi = np.percentile(h, [0.5, 99.5])
    edges = np.arange(lo - bin_size, hi + 2 * bin_size, bin_size)
    hist, _ = np.histogram(h, bins=edges)
    smooth = np.convolve(hist, np.ones(3) / 3.0, mode="same")
    centers = (edges[:-1] + edges[1:]) / 2.0
    peak = (smooth >= np.roll(smooth, 1)) & (smooth > np.roll(smooth, -1)) & (smooth >= 0.15 * smooth.max())
    return centers[peak], smooth[peak], float(smooth.max())


def fit_floor_ceiling(
    pts: np.ndarray, up: np.ndarray, rng: np.random.Generator, opts: RoomStructureOptions, sign_fixed: bool
) -> tuple[np.ndarray, float, float, dict[str, float]]:
    """Return (up, floor height along up, ceiling height along up, confidences)."""
    h = pts @ up
    peaks, _, _ = _height_peaks(h)
    lo_peak, hi_peak = (float(peaks.min()), float(peaks.max())) if len(peaks) else (float(np.percentile(h, 1)), None)

    if not sign_fixed and hi_peak is not None and hi_peak - lo_peak > 1.0:
        n_lo = np.count_nonzero((h > lo_peak + 0.15) & (h < lo_peak + 1.2))
        n_hi = np.count_nonzero((h < hi_peak - 0.15) & (h > hi_peak - 1.2))
        if n_hi > n_lo:  # furniture clutter stacks above the floor, not below the ceiling
            up, h = -up, -h
            lo_peak, hi_peak = -hi_peak, -lo_peak
    elif not sign_fixed and hi_peak is None and lo_peak > float(np.median(h)):
        up, h = -up, -h
        lo_peak = float(np.percentile(h, 1))

    # Refine gravity with a tilt-constrained plane fit on the floor slab.
    floor_conf = 0.3
    slab = pts[np.abs(h - lo_peak) < 0.15]
    if len(slab) >= 200:
        fit = ransac_plane(
            slab, rng, 0.015, iterations=256, normal_hint=up, max_angle_deg=15.0 if opts.up_hint else 10.0
        )
        if fit is not None and fit.count >= 0.3 * len(slab):
            normal, d = fit.normal, fit.d
            if normal @ up < 0:
                normal, d = -normal, -d
            up = normal
            h = pts @ up
            lo_peak = float(np.median(h[np.abs(h - (-d)) < 0.03])) if np.any(np.abs(h + d) < 0.03) else -d
            floor_conf = float(np.clip(fit.count / len(slab), 0.3, 1.0))
    floor_h = lo_peak

    peaks, _, _ = _height_peaks(h)
    ceil_candidates = peaks[peaks > floor_h + 1.8]
    if len(ceil_candidates):
        peak_c = float(ceil_candidates.max())
        sel = np.abs(h - peak_c) < 0.03
        ceil_h = float(np.median(h[sel])) if sel.any() else peak_c
        ceil_conf = 0.8
    else:
        ceil_h = float(np.percentile(h[h > floor_h + 0.5], 99)) if np.any(h > floor_h + 0.5) else floor_h + 2.5
        ceil_conf = 0.25  # ceiling not observed; height taken from the top of the walls
    return up, floor_h, ceil_h, {"floor": floor_conf, "ceiling": ceil_conf}


def basis_from_up(up: np.ndarray) -> np.ndarray:
    """Rotation whose rows are (X, up, Z), right-handed: maps scan vectors into Y-up frame."""
    helper = np.array([1.0, 0.0, 0.0]) if abs(up[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
    x = _unit(helper - up * (helper @ up))
    return np.stack([x, up, np.cross(x, up)])


# --------------------------------------------------------------------------- walls / outline


def dominant_angle_deg(xz: np.ndarray, bin_size: float = 0.03) -> float:
    """Yaw (deg, in [-45, 45)) that makes walls axis-aligned, by histogram sharpness."""
    pts = xz if len(xz) <= 60_000 else xz[:: len(xz) // 60_000 + 1]

    def score(theta: float) -> float:
        c, s = np.cos(theta), np.sin(theta)
        total = 0.0
        for coord in (pts[:, 0] * c + pts[:, 1] * s, -pts[:, 0] * s + pts[:, 1] * c):
            idx = np.floor((coord - coord.min()) / bin_size).astype(np.int64)
            total += float((np.bincount(idx).astype(np.float64) ** 2).sum())
        return total

    coarse = np.radians(np.arange(0.0, 90.0, 0.5))
    best = coarse[int(np.argmax([score(t) for t in coarse]))]
    fine = best + np.radians(np.arange(-0.6, 0.61, 0.1))
    best = fine[int(np.argmax([score(t) for t in fine]))]
    deg = float(np.degrees(best))
    return deg - 90.0 if deg >= 45.0 else deg


def _yaw_matrix(theta_rad: float) -> np.ndarray:
    c, s = np.cos(theta_rad), np.sin(theta_rad)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


def _floor_mask(floor_xz: np.ndarray, res: float, opts: RoomStructureOptions):
    lo = floor_xz.min(axis=0) - 0.5
    hi = floor_xz.max(axis=0) + 0.5
    shape = np.ceil((hi - lo) / res).astype(int)
    if shape.max() > 4000:
        raise RoomStructureError("Footprint is implausibly large for metres; pass a scale factor.")
    ij = np.floor((floor_xz - lo) / res).astype(int)
    grid = np.zeros((shape[1], shape[0]), dtype=np.int32)  # rows = z, cols = x
    np.add.at(grid, (ij[:, 1], ij[:, 0]), 1)
    nonzero = grid[grid > 0]
    thr = max(2.0, 0.1 * float(np.median(nonzero)))
    raw = (grid >= thr).astype(np.uint8)

    def kernel(metres: float) -> np.ndarray:
        k = max(3, int(round(metres / res)) | 1)
        return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))

    mask = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, kernel(0.4))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel(0.25))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=4)
    if n < 2:
        raise RoomStructureError("No floor footprint found.")
    mask = (labels == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    flood = mask.copy()
    padded = cv2.copyMakeBorder(flood, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    ff = np.zeros((padded.shape[0] + 2, padded.shape[1] + 2), np.uint8)
    cv2.floodFill(padded, ff, (0, 0), 2)
    mask = (padded[1:-1, 1:-1] != 2).astype(np.uint8)  # holes become part of the room
    return mask, raw, lo


def _contour_polygon(mask: np.ndarray, lo: np.ndarray, res: float) -> np.ndarray:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea)
    approx = cv2.approxPolyDP(contour, 0.1 / res, True).reshape(-1, 2).astype(np.float64)
    poly = lo + (approx + 0.5) * res  # (x, z) metres
    return _simplify_polygon(poly)


def _signed_area(poly: np.ndarray) -> float:
    x, z = poly[:, 0], poly[:, 1]
    return 0.5 * float(np.sum(x * np.roll(z, -1) - np.roll(x, -1) * z))


def _simplify_polygon(poly: np.ndarray, min_edge: float = 0.3, collinear_deg: float = 8.0) -> np.ndarray:
    poly = poly.copy()
    changed = True
    while changed and len(poly) > 3:
        changed = False
        edges = np.roll(poly, -1, axis=0) - poly
        lengths = np.linalg.norm(edges, axis=1)
        i = int(np.argmin(lengths))
        if lengths[i] < min_edge:
            j = (i + 1) % len(poly)
            mid = (poly[i] + poly[j]) / 2.0
            poly[i] = mid
            poly = np.delete(poly, j, axis=0)
            changed = True
            continue
        for k in range(len(poly)):
            a, b, c = poly[k - 1], poly[k], poly[(k + 1) % len(poly)]
            u, v = b - a, c - b
            cosang = (u @ v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-12)
            if cosang > np.cos(np.radians(collinear_deg)):
                poly = np.delete(poly, k, axis=0)
                changed = True
                break
    if _signed_area(poly) < 0:
        poly = poly[::-1].copy()
    return poly


@dataclass
class _WallFit:
    normal: np.ndarray  # 2D unit, n . p = c
    c: float
    confidence: float
    observed: bool


def _fit_wall_line(
    wall_xz: np.ndarray,
    wall_y: np.ndarray,
    v0: np.ndarray,
    v1: np.ndarray,
    manhattan_edge: bool,
    height: float,
    rng: np.random.Generator,
) -> _WallFit:
    edge = v1 - v0
    length = float(np.linalg.norm(edge))
    d = edge / length
    if manhattan_edge:
        d = np.array([np.sign(d[0]), 0.0]) if abs(d[0]) > abs(d[1]) else np.array([0.0, np.sign(d[1])])
    n = np.array([-d[1], d[0]])
    rel = wall_xz - v0
    along, perp = rel @ d, rel @ n
    margin = min(0.3, 0.2 * length)
    win = (along > margin) & (along < length - margin) & (np.abs(perp) < 0.3)
    c0 = float(n @ v0)
    if win.sum() < 30:
        return _WallFit(n, c0, 0.1, False)

    w_perp = perp[win]
    if manhattan_edge:
        hist, edges = np.histogram(w_perp, bins=np.arange(-0.3, 0.3005, 0.01))
        centre = (edges[:-1] + edges[1:])[int(np.argmax(np.convolve(hist, np.ones(3), mode="same")))] / 2.0
        near = np.abs(w_perp - centre) < 0.03
        c = c0 + float(np.median(w_perp[near]))
    else:
        found = ransac_line_2d(wall_xz[win], rng, 0.02, direction_hint=d)
        if found is None:
            return _WallFit(n, c0, 0.1, False)
        n_fit, c_fit, _ = found
        n, c = (n_fit, c_fit) if n_fit @ n > 0 else (-n_fit, -c_fit)
        d = np.array([n[1], -n[0]])
    # Coverage of the fitted plane along the wall and over its height.
    plane = np.abs(wall_xz @ n - c) < 0.04
    s = (wall_xz[plane] - v0) @ d
    yy = wall_y[plane]
    in_span = (s > 0) & (s < length)
    if in_span.sum() < 20:
        return _WallFit(n, c, 0.1, False)
    along_bins = np.unique(np.floor(s[in_span] / 0.1).astype(int))
    vert_bins = np.unique(np.floor(yy[in_span] / 0.1).astype(int))
    cov_along = min(1.0, len(along_bins) / max(1.0, length / 0.1) / 0.8)
    cov_vert = min(1.0, len(vert_bins) / max(1.0, height / 0.1) / 0.8)
    return _WallFit(n, c, float(np.clip(0.6 * cov_along + 0.4 * cov_vert, 0.05, 1.0)), True)


def _merge_collinear(poly: np.ndarray, fits: list[_WallFit]) -> tuple[np.ndarray, list[_WallFit]]:
    """Drop polygon vertices between two walls that fitted to the same line (contour notches)."""
    poly, fits = poly.copy(), list(fits)
    i = 0
    while i < len(poly) and len(poly) > 3:
        prev, cur = fits[i - 1], fits[i]
        parallel = abs(prev.normal @ cur.normal) > np.cos(np.radians(3.0))
        same_line = abs(prev.c - cur.c * np.sign(prev.normal @ cur.normal)) < 0.06
        if parallel and same_line:
            keep = prev if prev.confidence >= cur.confidence else cur
            merged = _WallFit(keep.normal, keep.c, max(prev.confidence, cur.confidence), prev.observed or cur.observed)
            fits[i - 1] = merged
            poly = np.delete(poly, i, axis=0)
            del fits[i]
            continue
        i += 1
    return poly, fits


def _intersect(n1: np.ndarray, c1: float, n2: np.ndarray, c2: float) -> np.ndarray | None:
    det = n1[0] * n2[1] - n1[1] * n2[0]
    if abs(det) < np.sin(np.radians(10.0)):
        return None
    return np.array([(c1 * n2[1] - c2 * n1[1]) / det, (n1[0] * c2 - n2[0] * c1) / det])


# --------------------------------------------------------------------------- orchestration


def analyze_room(
    positions: np.ndarray,
    opacity: np.ndarray | None = None,
    colmap_points: np.ndarray | None = None,
    options: RoomStructureOptions | None = None,
    opening_detector: OpeningDetector | None = None,
    progress: ProgressFn | None = None,
) -> RoomStructureResult:
    opts = options or RoomStructureOptions()
    rng = np.random.default_rng(opts.seed)
    report = progress or (lambda stage, fraction: None)

    report("filtering", 0.05)
    n_input = len(positions) + (0 if colmap_points is None else len(colmap_points))
    pts = prepare_points(positions, opacity, colmap_points, opts, rng)

    report("gravity", 0.2)
    if opts.up_hint is not None:
        up0, gravity_conf = _unit(np.asarray(opts.up_hint, dtype=np.float64)), 1.0
    else:
        up0, gravity_conf = estimate_up(pts, rng, opts)
    up, floor_h, ceil_h, confs = fit_floor_ceiling(pts, up0, rng, opts, sign_fixed=opts.up_hint is not None)
    height = ceil_h - floor_h
    if height < 1.0:
        raise RoomStructureError(f"Implausible ceiling height {height:.2f} m; check scale and orientation.")

    R_up = basis_from_up(up)
    q = pts @ R_up.T
    q[:, 1] -= floor_h

    report("orientation", 0.4)
    band = (q[:, 1] > 0.3) & (q[:, 1] < height - 0.25)
    if band.sum() < 500:
        raise RoomStructureError("Too few wall-height points to find walls.")
    theta_deg = dominant_angle_deg(q[band][:, [0, 2]])
    R_yaw = _yaw_matrix(np.radians(theta_deg))
    q = q @ R_yaw.T
    xz_all = q[:, [0, 2]]

    report("outline", 0.55)
    floor_sel = (q[:, 1] > -0.05) & (q[:, 1] < 0.12)
    if floor_sel.sum() < 200:
        raise RoomStructureError("No floor points found.")
    res = opts.grid_res
    mask, raw_mask, origin = _floor_mask(xz_all[floor_sel], res, opts)
    poly = _contour_polygon(mask, origin, res)
    if len(poly) < 3:
        raise RoomStructureError("Could not extract a room outline.")

    edges = np.roll(poly, -1, axis=0) - poly
    lengths = np.linalg.norm(edges, axis=1)
    ang = np.degrees(np.arctan2(edges[:, 1], edges[:, 0]))
    off_axis = np.abs(((ang + 45.0) % 90.0) - 45.0)
    aligned = off_axis < opts.manhattan_tolerance_deg
    manhattan_fraction = float(lengths[aligned].sum() / lengths.sum())
    manhattan = manhattan_fraction >= opts.manhattan_min_fraction

    report("walls", 0.7)
    wall_xz, wall_y = xz_all[band], q[band, 1]
    fits = []
    for i in range(len(poly)):
        fits.append(
            _fit_wall_line(wall_xz, wall_y, poly[i], poly[(i + 1) % len(poly)], manhattan and aligned[i], height, rng)
        )

    poly, fits = _merge_collinear(poly, fits)
    vertices = []
    for i in range(len(poly)):
        prev, cur = fits[i - 1], fits[i]
        point = _intersect(prev.normal, prev.c, cur.normal, cur.c)
        if point is None or np.linalg.norm(point - poly[i]) > 0.75:
            point = poly[i] + cur.normal * (cur.c - cur.normal @ poly[i])  # project onto the wall line
        vertices.append(point)
    verts = np.array(vertices)
    centre = (verts.min(axis=0) + verts.max(axis=0)) / 2.0
    verts_c = verts - centre

    walls: list[WallInterpretation] = []
    for i in range(len(verts_c)):
        a, b = verts_c[i], verts_c[(i + 1) % len(verts_c)]
        walls.append(
            WallInterpretation(
                id=f"wall_{i}",
                start=(float(a[0]), 0.0, float(a[1])),
                end=(float(b[0]), 0.0, float(b[1])),
                height=float(height),
                thickness=opts.wall_thickness,
                confidence=float(fits[i].confidence),
                provenance="auto",
            )
        )

    openings: list[OpeningInterpretation] = []
    if opts.detect_openings:
        report("openings", 0.85)
        q_c = q.copy()
        q_c[:, 0] -= centre[0]
        q_c[:, 2] -= centre[1]
        for i, wall in enumerate(walls):
            if fits[i].observed:
                openings.extend(detect_openings(q_c, wall, i, verts_c.mean(axis=0)))

    interpretation = RoomInterpretation(
        provenance="auto",
        floor=FloorPlane(normal=(0.0, 1.0, 0.0), constant=0.0, provenance="auto"),
        ceilingHeight=float(height),
        outline=[(float(p[0]), float(p[1])) for p in verts_c],
        walls=walls,
        openings=openings,
        detections=[],
    )
    if opening_detector is not None:
        interpretation = merge_external_openings(interpretation, opening_detector(interpretation))

    A = R_yaw @ R_up * opts.scale
    t = np.array([-centre[0], -floor_h, -centre[1]])
    matrix = np.vstack([np.hstack([A, t[:, None]]), [0.0, 0.0, 0.0, 1.0]])
    scan_to_scene = tuple(float(v) for v in matrix.ravel())
    total_len = sum(np.linalg.norm(np.subtract(w.end, w.start)) for w in walls)
    outline_conf = float(sum(w.confidence * np.linalg.norm(np.subtract(w.end, w.start)) for w in walls) / total_len)

    floor_cov = float(raw_mask[mask > 0].mean()) if mask.any() else 0.0
    diagnostics: dict[str, Any] = {
        "pointsInput": int(n_input),
        "pointsUsed": int(len(pts)),
        "gravity": {"upScan": [float(v) for v in up], "confidence": float(gravity_conf)},
        "floor": {"confidence": float(confs["floor"] * min(1.0, 0.5 + floor_cov))},
        "ceiling": {"height": float(height), "confidence": float(confs["ceiling"])},
        "orientation": {"yawDegrees": theta_deg, "manhattan": bool(manhattan), "manhattanFraction": manhattan_fraction},
        "outline": {"confidence": outline_conf, "vertices": len(verts_c)},
        "wallsObserved": int(sum(f.observed for f in fits)),
        "scale": opts.scale,
        "notes": [],
    }
    if not 1.8 <= height <= 4.5:
        diagnostics["scaleWarning"] = "ceiling height is implausible for metres"
        diagnostics["suggestedScale"] = float(opts.scale * 2.5 / height)
    report("done", 1.0)
    return RoomStructureResult(interpretation, scan_to_scene, diagnostics)
