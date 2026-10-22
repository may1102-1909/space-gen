"""Virtual cameras inside the room (from the T10 outline + ceiling) and around one object."""

from __future__ import annotations

from typing import List, Sequence

import numpy as np

from services.object_detection.geometry import CameraView, look_at_view


def intrinsics(width: int, height: int, hfov_deg: float) -> np.ndarray:
    f = (width / 2) / np.tan(np.deg2rad(hfov_deg) / 2)
    return np.array([[f, 0, width / 2], [0, f, height / 2], [0, 0, 1.0]])


def point_in_polygon(p, poly: np.ndarray) -> bool:
    x, z = p
    inside = False
    for (x0, z0), (x1, z1) in zip(poly, np.roll(poly, -1, axis=0)):
        if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0):
            inside = not inside
    return inside


def room_cameras(
    outline: Sequence[Sequence[float]],
    ceiling_height: float,
    width: int = 320,
    height: int = 240,
    hfov_deg: float = 90.0,
    margin: float = 0.5,
    eye_heights: Sequence[float] = (1.5,),
    target_height: float = 0.7,
    max_views: int = 48,
) -> List[CameraView]:
    """Cameras at inset outline corners, edge midpoints and the centroid, all looking across the room.

    Corner/edge cameras look at the centroid and +-35 deg around it; the centroid camera looks 8 ways.
    Positions outside a concave outline are dropped; detailed outlines are thinned to `max_views` evenly.
    """
    poly = np.asarray(outline, float)
    c = poly.mean(axis=0)
    mids = (poly + np.roll(poly, -1, axis=0)) / 2
    K = intrinsics(width, height, hfov_deg)
    cams = []
    for i, p in enumerate(np.vstack([poly, mids])):
        d = c - p
        inset = margin * (1.4 if i < len(poly) else 1.0)  # corners: step in along the diagonal
        q = p + d * min(1.0, inset / max(float(np.linalg.norm(d)), 1e-9))
        if not point_in_polygon(q, poly):
            continue
        base = np.arctan2(*(c - q)[::-1])
        for y in eye_heights:
            for off in np.deg2rad([-35.0, 0.0, 35.0]):
                a = base + off
                eye = (q[0], min(y, ceiling_height - 0.2), q[1])
                tgt = (q[0] + np.cos(a), target_height, q[1] + np.sin(a))
                cams.append(look_at_view(eye, tgt, K, width, height))
    for a in np.deg2rad(np.arange(0, 360, 45)) if point_in_polygon(c, poly) else []:
        eye = (c[0], min(eye_heights[0], ceiling_height - 0.2), c[1])
        cams.append(look_at_view(eye, (c[0] + np.cos(a), target_height, c[1] + np.sin(a)), K, width, height))
    if len(cams) > max_views:
        cams = [cams[i] for i in np.linspace(0, len(cams) - 1, max_views).round().astype(int)]
    return cams


def orbit_cameras(
    center, size, n: int = 12, elevations_deg: Sequence[float] = (15.0, 45.0), width: int = 256, height: int = 256
) -> List[CameraView]:
    """Ring cameras around an object OBB plus one near-top view, framing the whole box."""
    center, size = np.asarray(center, float), np.asarray(size, float)
    radius = float(np.linalg.norm(size)) * 1.2 + 0.3
    hfov = np.rad2deg(2 * np.arctan(np.linalg.norm(size) * 0.6 / (radius - np.linalg.norm(size) / 2)))
    K = intrinsics(width, height, min(hfov, 100.0))
    cams = []
    for el in np.deg2rad(elevations_deg):
        for a in np.linspace(0, 2 * np.pi, n, endpoint=False):
            eye = center + radius * np.array([np.cos(el) * np.cos(a), np.sin(el), np.cos(el) * np.sin(a)])
            cams.append(look_at_view(eye, center, K, width, height))
    cams.append(look_at_view(center + np.array([0.01, radius, 0.0]), center, K, width, height))
    return cams
