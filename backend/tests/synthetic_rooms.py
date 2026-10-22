"""Synthetic splat-like point clouds of rooms with known structure, plus recovery metrics."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Sequence, Tuple

import numpy as np

from models.reference_room import ReferenceOpening, ReferenceRoom, ReferenceScan, ReferenceWall
from services.room_structure import RoomStructureResult


@dataclass
class Opening:
    wall: int
    offset: float  # along the wall from its start to the opening centre (contract convention)
    width: float
    sill: float
    height: float
    kind: str


@dataclass
class SyntheticRoom:
    name: str
    outline: List[Tuple[float, float]]  # CCW (x, z), metres
    height: float
    openings: List[Opening] = field(default_factory=list)
    furniture: List[Tuple[Tuple[float, float, float], Tuple[float, float, float]]] = field(default_factory=list)
    noise: float = 0.008
    floaters: int = 0
    density: float = 1500.0  # points per m^2
    tilt_deg: float = 0.0
    yaw_deg: float = 0.0
    translation: Tuple[float, float, float] = (0.0, 0.0, 0.0)


def _inside(points: np.ndarray, poly: np.ndarray) -> np.ndarray:
    x, z = points[:, 0], points[:, 1]
    inside = np.zeros(len(points), dtype=bool)
    for i in range(len(poly)):
        (x1, z1), (x2, z2) = poly[i], poly[(i + 1) % len(poly)]
        crosses = (z1 > z) != (z2 > z)
        xi = x1 + (z - z1) * (x2 - x1) / np.where(z2 == z1, 1e-12, z2 - z1)
        inside ^= crosses & (x < xi)
    return inside


def scan_transform(room: SyntheticRoom) -> np.ndarray:
    """Room frame -> scan frame (tilted, yawed, shifted)."""
    t, y = np.radians(room.tilt_deg), np.radians(room.yaw_deg)
    rx = np.array([[1, 0, 0], [0, np.cos(t), -np.sin(t)], [0, np.sin(t), np.cos(t)]])
    rz = np.array([[np.cos(t / 2), -np.sin(t / 2), 0], [np.sin(t / 2), np.cos(t / 2), 0], [0, 0, 1]])
    ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    m = np.eye(4)
    m[:3, :3] = rz @ rx @ ry
    m[:3, 3] = room.translation
    return m


def generate(room: SyntheticRoom, seed: int = 0) -> Tuple[np.ndarray, np.ndarray]:
    """Return (positions in scan frame, logit opacities)."""
    rng = np.random.default_rng(seed)
    poly = np.asarray(room.outline, dtype=np.float64)
    lo, hi = poly.min(axis=0), poly.max(axis=0)
    area_box = float(np.prod(hi - lo))
    chunks = []
    for level in (0.0, room.height):
        xz = rng.uniform(lo, hi, size=(int(room.density * area_box), 2))
        xz = xz[_inside(xz, poly)]
        chunks.append(np.column_stack([xz[:, 0], np.full(len(xz), level), xz[:, 1]]))
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        length = float(np.linalg.norm(b - a))
        n = int(room.density * length * room.height)
        t, y = rng.uniform(0, length, n), rng.uniform(0, room.height, n)
        keep = np.ones(n, dtype=bool)
        for op in room.openings:
            if op.wall == i:
                t_lo, t_hi = op.offset - op.width / 2, op.offset + op.width / 2
                keep &= ~((t > t_lo) & (t < t_hi) & (y > op.sill) & (y < op.sill + op.height))
                if op.kind == "window":  # sparse view-through points well outside the room
                    m = 200
                    u = (b - a) / length
                    out = np.array([u[1], -u[0]])
                    tt = rng.uniform(t_lo, t_hi, m)
                    depth = rng.uniform(0.8, 3.0, m)
                    xz = a + tt[:, None] * u + depth[:, None] * out
                    chunks.append(np.column_stack([xz[:, 0], rng.uniform(0, room.height, m), xz[:, 1]]))
        u = (b - a) / length
        xz = a + t[keep, None] * u
        chunks.append(np.column_stack([xz[:, 0], y[keep], xz[:, 1]]))
    for center, size in room.furniture:
        c, s = np.asarray(center), np.asarray(size)
        n = int(room.density * 2 * (s[0] * s[1] + s[1] * s[2] + s[0] * s[2]))
        pts = rng.uniform(-0.5, 0.5, size=(n, 3))
        face = rng.integers(0, 3, n)
        pts[np.arange(n), face] = np.where(rng.random(n) < 0.5, -0.5, 0.5)
        pts = c + pts * s
        chunks.append(pts[pts[:, 1] > 0.0])
    points = np.vstack(chunks)
    points += rng.normal(0.0, room.noise, size=points.shape)
    opacity = rng.normal(3.0, 0.5, len(points))
    if room.floaters:
        fl = rng.uniform([lo[0] - 1, -0.5, lo[1] - 1], [hi[0] + 1, room.height + 1, hi[1] + 1], size=(room.floaters, 3))
        points = np.vstack([points, fl])
        opacity = np.concatenate([opacity, np.where(rng.random(room.floaters) < 0.5, -3.0, 2.0)])
    m = scan_transform(room)
    return points @ m[:3, :3].T + m[:3, 3], opacity


def _line_dist(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    u = (b - a) / np.linalg.norm(b - a)
    r = p - a
    return float(abs(u[0] * r[1] - u[1] * r[0]))


def recovery_errors(room: SyntheticRoom, result: RoomStructureResult) -> Dict[str, float]:
    """Map recovered geometry back into the room frame and compare with ground truth."""
    to_room = np.linalg.inv(np.asarray(result.scan_to_scene).reshape(4, 4) @ scan_transform(room))

    def back(p: Sequence[float]) -> np.ndarray:
        q = to_room[:3, :3] @ np.asarray(p, dtype=np.float64) + to_room[:3, 3]
        return q[[0, 2]]

    interp = result.interpretation
    walls = [(back(w.start), back(w.end)) for w in interp.walls]
    gt = np.asarray(room.outline, dtype=np.float64)
    offset_err, angle_err, corner_err = 0.0, 0.0, 0.0
    gt_to_rec: Dict[int, int] = {}
    for i in range(len(gt)):
        a, b = gt[i], gt[(i + 1) % len(gt)]
        u = (b - a) / np.linalg.norm(b - a)
        mid = (a + b) / 2
        best = None
        for k, (ra, rb) in enumerate(walls):
            ru = (rb - ra) / np.linalg.norm(rb - ra)
            ang = float(np.degrees(np.arccos(np.clip(u @ ru, -1, 1))))
            off = _line_dist(mid, ra, rb)
            if ang < 30 and (best is None or off < best[0]):
                best = (off, ang, k)
        if best is None:
            return {"walls_matched": 0.0}
        offset_err, angle_err = max(offset_err, best[0]), max(angle_err, best[1])
        gt_to_rec[i] = best[2]
    corners = np.asarray([back((x, 0.0, z)) for x, z in interp.outline])
    for c in gt:
        corner_err = max(corner_err, float(np.min(np.linalg.norm(corners - c, axis=1))))
    floor_normal = to_room[:3, :3] @ np.array([0.0, 1.0, 0.0])
    opening_err, matched = 0.0, 0
    for op in room.openings:
        k = gt_to_rec.get(op.wall)
        a, b = gt[op.wall], gt[(op.wall + 1) % len(gt)]
        u = (b - a) / np.linalg.norm(b - a)
        gt_center = a + op.offset * u
        candidates = []
        for rec in interp.openings:
            if rec.wallId != f"wall_{k}" or rec.kind != op.kind:
                continue
            w = interp.walls[k]
            ws, we = back(w.start), back(w.end)
            ru = (we - ws) / np.linalg.norm(we - ws)
            center = ws + rec.offset * ru
            err = max(
                float(np.linalg.norm(center - gt_center)),
                abs(rec.width - op.width),
                abs(rec.sill - op.sill),
                abs(rec.height - op.height),
            )
            candidates.append(err)
        if candidates:
            matched += 1
            opening_err = max(opening_err, min(candidates))
    return {
        "walls_expected": float(len(gt)),
        "walls_found": float(len(walls)),
        "wall_offset_m": offset_err,
        "wall_angle_deg": angle_err,
        "corner_m": corner_err,
        "ceiling_m": abs(interp.ceilingHeight - room.height),
        "floor_normal_deg": float(np.degrees(np.arccos(np.clip(floor_normal[1], -1, 1)))),
        "openings_expected": float(len(room.openings)),
        "openings_matched": float(matched),
        "opening_m": opening_err,
        "extra_openings": float(len(interp.openings) - matched),
    }


ROOMS = [
    SyntheticRoom(
        name="rectangle",
        outline=[(0, 0), (5, 0), (5, 4), (0, 4)],
        height=2.6,
        openings=[Opening(0, 1.45, 0.9, 0.0, 2.1, "door"), Opening(2, 2.1, 1.2, 0.9, 1.1, "window")],
        tilt_deg=8.0,
        yaw_deg=27.0,
        translation=(1.5, -0.7, 3.0),
    ),
    SyntheticRoom(
        name="l_shape",
        outline=[(0, 0), (6, 0), (6, 2.5), (3, 2.5), (3, 5), (0, 5)],
        height=2.7,
        openings=[Opening(1, 1.1, 1.0, 0.0, 2.1, "door"), Opening(5, 2.25, 1.5, 1.0, 1.0, "window")],
        tilt_deg=12.0,
        yaw_deg=-40.0,
        translation=(-2.0, 1.2, 0.5),
    ),
    SyntheticRoom(
        name="noisy_floaters",
        outline=[(0, 0), (4.5, 0), (4.5, 3.5), (0, 3.5)],
        height=2.5,
        openings=[Opening(1, 1.45, 0.9, 0.0, 2.05, "door")],
        furniture=[((1.5, 0.4, 1.0), (2.0, 0.8, 0.9)), ((3.6, 0.375, 2.6), (0.8, 0.75, 0.8))],
        noise=0.02,
        floaters=8000,
        tilt_deg=5.0,
        yaw_deg=63.0,
        translation=(0.3, 0.9, -1.1),
    ),
    SyntheticRoom(
        name="non_manhattan",
        outline=[(0, 0), (5, 0), (5, 2.5), (2.5, 4.5), (0, 4.5)],
        height=2.6,
        tilt_deg=6.0,
        yaw_deg=15.0,
    ),
]


# Simulated residual scale error per scaleSource (assumptions, not measurements): no metric anchor
# leaves ~10% error, a single user tape/laser calibration ~1%, a depth sensor ~0.5%.
SCALE_FACTORS = {
    "none": (1.12, 0.89, 1.08, 0.93),
    "user_measurement": (1.012, 0.988, 1.006, 0.994),
    "sensor": (1.004, 0.997, 1.002, 0.996),
}


def to_reference(room: SyntheticRoom, scale_source: str) -> ReferenceRoom:
    """Ground truth of a synthetic room in the reference-room format."""
    poly = np.asarray(room.outline, dtype=np.float64)
    walls = [
        ReferenceWall(id=f"w{i}", length=float(np.linalg.norm(poly[(i + 1) % len(poly)] - poly[i])))
        for i in range(len(poly))
    ]
    openings = [
        ReferenceOpening(
            id=f"o{j}",
            wall=f"w{op.wall}",
            kind=op.kind,
            width=op.width,
            height=op.height,
            sill=op.sill,
            offset=op.offset,
        )
        for j, op in enumerate(room.openings)
    ]
    return ReferenceRoom(
        id=f"synthetic_{room.name}_{scale_source}",
        name=room.name,
        groundTruthSource="synthetic",
        scan=ReferenceScan(path=f"synthetic://{room.name}", scaleSource=scale_source),
        ceilingHeight=room.height,
        walls=walls,
        openings=openings,
    )


def synthetic_references(seed: int = 0) -> List[Tuple[ReferenceRoom, np.ndarray, np.ndarray]]:
    """Every synthetic room under every scaleSource, its scan scaled by that source's simulated error."""
    out = []
    for source, factors in SCALE_FACTORS.items():
        for room, factor in zip(ROOMS, factors):
            positions, opacity = generate(room, seed=seed)
            out.append((to_reference(room, source), positions * factor, opacity))
    return out
