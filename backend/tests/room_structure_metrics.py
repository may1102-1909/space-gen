"""Compare a recovered RoomInterpretation with the synthetic ground truth."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .room_structure_synth import Scene


@dataclass
class Accuracy:
    max_wall_offset_cm: float
    max_wall_angle_deg: float
    max_corner_error_cm: float
    ceiling_error_cm: float
    floor_tilt_deg: float
    walls_matched: int
    walls_expected: int
    walls_recovered: int
    openings_expected: int
    openings_matched: int
    openings_extra: int
    max_opening_error_cm: float

    def row(self, name: str) -> str:
        return (
            f"| {name} | {self.walls_matched}/{self.walls_expected} (+{self.walls_recovered - self.walls_matched}) "
            f"| {self.max_wall_offset_cm:.1f} | {self.max_wall_angle_deg:.2f} | {self.max_corner_error_cm:.1f} "
            f"| {self.ceiling_error_cm:.1f} | {self.openings_matched}/{self.openings_expected} (+{self.openings_extra}) "
            f"| {self.max_opening_error_cm:.1f} |"
        )


ROW_HEADER = (
    "| case | walls matched (+extra) | max wall offset cm | max wall angle ° | max corner err cm "
    "| ceiling err cm | openings matched (+extra) | max opening edge err cm |\n|---|---|---|---|---|---|---|---|"
)


def _to_scene(scene: Scene, matrix: tuple[float, ...], points_room: np.ndarray) -> np.ndarray:
    m = np.array(matrix).reshape(4, 4)
    scan = points_room @ scene.rotation.T + scene.translation
    return scan @ m[:3, :3].T + m[:3, 3]


def evaluate(scene: Scene, result) -> Accuracy:
    interp, matrix = result.interpretation, result.scan_to_scene
    gt3 = np.array([[x, 0.0, z] for x, z in scene.polygon])
    gt = _to_scene(scene, matrix, gt3)[:, [0, 2]]
    n_gt = len(gt)
    walls = interp.walls
    rec = [(np.array([w.start[0], w.start[2]]), np.array([w.end[0], w.end[2]])) for w in walls]

    def dist_to_line(p, a, b):
        d = (b - a) / np.linalg.norm(b - a)
        return abs((p - a) @ np.array([-d[1], d[0]]))

    offsets, angles, matched, assignment = [], [], 0, {}
    for i in range(n_gt):
        a, b = gt[i], gt[(i + 1) % n_gt]
        d = (b - a) / np.linalg.norm(b - a)
        best = None
        for j, (ra, rb) in enumerate(rec):
            rd = (rb - ra) / np.linalg.norm(rb - ra)
            ang = np.degrees(np.arccos(np.clip(abs(d @ rd), 0, 1)))
            off = max(dist_to_line((a + b) / 2, ra, rb), dist_to_line(a, ra, rb), dist_to_line(b, ra, rb))
            if ang < 15 and (best is None or off < best[0]):
                best = (off, ang, j)
        if best is not None and best[0] < 0.15:
            matched += 1
            offsets.append(best[0])
            angles.append(best[1])
            assignment[i] = best[2]
        else:
            offsets.append(np.inf)
            angles.append(np.inf)

    outline = np.array(interp.outline)
    corner = max(float(np.linalg.norm(outline - g, axis=1).min()) for g in gt)

    expected, found, errors, used = len(scene.openings), 0, [], set()
    for op in scene.openings:
        gi = op.wall
        if gi not in assignment:
            continue
        a, b = gt[gi], gt[(gi + 1) % n_gt]
        ra, rb = rec[assignment[gi]]
        wall = walls[assignment[gi]]
        length_gt = np.linalg.norm(b - a)
        # Project GT opening edges onto the recovered wall's along-axis.
        rd = (rb - ra) / np.linalg.norm(rb - ra)
        g0, g1 = (a + (b - a) / length_gt * s for s in (op.offset, op.offset + op.width))
        s0, s1 = sorted(((g0 - ra) @ rd, (g1 - ra) @ rd))
        for k, o in enumerate(interp.openings):
            if (
                o.wallId == wall.id
                and k not in used
                and min(o.offset + o.width, s1) - max(o.offset, s0) > 0.5 * op.width
            ):
                used.add(k)
                found += 1
                errors.append(max(abs(o.offset - s0), abs(o.offset + o.width - s1)))
                break

    return Accuracy(
        max_wall_offset_cm=100 * max(offsets),
        max_wall_angle_deg=max(angles),
        max_corner_error_cm=100 * corner,
        ceiling_error_cm=100 * abs(interp.ceilingHeight - scene.ceiling),
        floor_tilt_deg=0.0,
        walls_matched=matched,
        walls_expected=n_gt,
        walls_recovered=len(walls),
        openings_expected=expected,
        openings_matched=found,
        openings_extra=len(interp.openings) - found,
        max_opening_error_cm=100 * max(errors) if errors else 0.0,
    )
