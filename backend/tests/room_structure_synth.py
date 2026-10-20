"""Synthetic scans with known ground truth for room-structure tests.

Rooms are extruded polygons in a Y-up frame (floor at y=0). Surfaces are sampled uniformly with
Gaussian noise; openings are cut out of walls; boxes act as furniture; floaters are random points.
The scan is then rotated by an arbitrary rotation, as COLMAP-style scans have an arbitrary up axis.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

RECTANGLE = [(-2.5, -2.0), (2.5, -2.0), (2.5, 2.0), (-2.5, 2.0)]  # 5 x 4 m
L_SHAPE = [(-3.0, -2.0), (3.0, -2.0), (3.0, 0.5), (0.5, 0.5), (0.5, 2.5), (-3.0, 2.5)]
SLANTED = [(-2.5, -2.0), (2.5, -2.0), (3.5, 0.5), (0.0, 2.5), (-2.5, 1.5)]  # non-Manhattan walls


@dataclass
class Opening:
    wall: int
    offset: float
    width: float
    sill: float
    height: float


@dataclass
class Scene:
    positions: np.ndarray
    opacity: np.ndarray
    polygon: list[tuple[float, float]]
    openings: list[Opening]
    ceiling: float
    rotation: np.ndarray = field(default_factory=lambda: np.eye(3))
    translation: np.ndarray = field(default_factory=lambda: np.zeros(3))


def random_rotation(rng: np.random.Generator, max_tilt_deg: float | None = None) -> np.ndarray:
    """Uniform random rotation, or a random yaw plus a bounded tilt of the up axis."""
    if max_tilt_deg is not None:
        yaw = _axis_angle(np.array([0.0, 1.0, 0.0]), rng.uniform(0, 2 * np.pi))
        heading = rng.uniform(0, 2 * np.pi)
        tilt_axis = np.array([np.cos(heading), 0.0, np.sin(heading)])
        return yaw @ _axis_angle(tilt_axis, np.radians(rng.uniform(0, max_tilt_deg)))
    q = rng.normal(size=4)
    q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def _axis_angle(axis: np.ndarray, angle: float) -> np.ndarray:
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(angle) * k + (1 - np.cos(angle)) * (k @ k)


def _polygon_samples(poly: np.ndarray, n: int, rng: np.random.Generator, y: float) -> np.ndarray:
    lo, hi = poly.min(axis=0), poly.max(axis=0)
    pts = rng.uniform(lo, hi, size=(max(n * 3, 500), 2))
    inside = np.zeros(len(pts), dtype=bool)
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        crosses = (a[1] > pts[:, 1]) != (b[1] > pts[:, 1])
        x_at = a[0] + (pts[:, 1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1] + 1e-12)
        inside ^= crosses & (pts[:, 0] < x_at)
    pts = pts[inside][:n]
    return np.column_stack([pts[:, 0], np.full(len(pts), y), pts[:, 1]])


def make_room(
    polygon: list[tuple[float, float]] = RECTANGLE,
    openings: list[Opening] | None = None,
    ceiling: float = 2.6,
    seed: int = 0,
    density: float = 1800.0,
    noise: float = 0.01,
    furniture: int = 0,
    floaters: int = 0,
    low_opacity_floaters: int = 0,
    rotate: bool = True,
    max_tilt_deg: float | None = None,
    wall_density_scale: float = 1.0,
) -> Scene:
    rng = np.random.default_rng(seed)
    poly = np.asarray(polygon, dtype=float)
    openings = openings or []
    chunks = []
    area = abs(0.5 * np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1]))
    chunks.append(_polygon_samples(poly, int(area * density), rng, 0.0))
    chunks.append(_polygon_samples(poly, int(area * density * 0.7), rng, ceiling))

    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        length = float(np.linalg.norm(b - a))
        n = int(length * ceiling * density * wall_density_scale)
        s, y = rng.uniform(0, length, n), rng.uniform(0, ceiling, n)
        keep = np.ones(n, dtype=bool)
        for op in openings:
            if op.wall == i:
                keep &= ~((s > op.offset) & (s < op.offset + op.width) & (y > op.sill) & (y < op.sill + op.height))
        s, y = s[keep], y[keep]
        xz = a + np.outer(s / length, b - a)
        chunks.append(np.column_stack([xz[:, 0], y, xz[:, 1]]))

    for _ in range(furniture):  # boxes of surface points near the walls and in the room
        centre = _polygon_samples(poly, 1, rng, 0.0)[0, [0, 2]]
        centre = 0.9 * centre + 0.1 * poly.mean(axis=0)  # nudge inwards so the box stays inside the walls
        size = rng.uniform([0.4, 0.4, 0.4], [1.2, 1.0, 1.0])
        pts = rng.uniform(-0.5, 0.5, size=(1500, 3)) * size
        face = rng.integers(0, 3, size=1500)
        pts[np.arange(1500), face] = np.sign(pts[np.arange(1500), face]) * size[face] / 2
        chunks.append(np.column_stack([pts[:, 0] + centre[0], pts[:, 1] + size[1] / 2, pts[:, 2] + centre[1]]))

    positions = np.concatenate(chunks)
    positions += rng.normal(scale=noise, size=positions.shape)
    opacity = rng.uniform(0.6, 1.0, len(positions))

    lo, hi = positions.min(axis=0) - [1, 0.5, 1], positions.max(axis=0) + [1, 0.5, 1]
    if floaters:
        positions = np.concatenate([positions, rng.uniform(lo, hi, size=(floaters, 3))])
        opacity = np.concatenate([opacity, rng.uniform(0.5, 1.0, floaters)])
    if low_opacity_floaters:
        positions = np.concatenate([positions, rng.uniform(lo, hi, size=(low_opacity_floaters, 3))])
        opacity = np.concatenate([opacity, rng.uniform(0.0, 0.2, low_opacity_floaters)])

    rotation = random_rotation(rng, max_tilt_deg) if rotate else np.eye(3)
    translation = rng.normal(size=3)
    positions = positions @ rotation.T + translation
    return Scene(positions, opacity, list(polygon), openings, ceiling, rotation, translation)
