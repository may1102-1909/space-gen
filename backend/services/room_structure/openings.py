"""Openings (doors, windows, gaps) from low density in a wall's plane.

Each wall is rasterised in (along-wall, height) at 5 cm. Rectangular empty regions bounded by
wall surface are openings; a wall that is empty over most of its area is treated as unobserved,
not as an opening. Gaps with dense points just in front of them are probably occlusion by
furniture and get a lower confidence.

`OpeningDetector` is the hook for image-based door/window detection: a callable that receives
the interpretation and returns extra `OpeningInterpretation`s, merged into the geometric result.
"""

from __future__ import annotations

from typing import Callable, Sequence

import cv2
import numpy as np

from models.contracts import OpeningInterpretation, RoomInterpretation, WallInterpretation

OpeningDetector = Callable[[RoomInterpretation], Sequence[OpeningInterpretation]]

CELL = 0.05
MIN_OPENING = 0.4


def _classify(sill: float, height: float, width: float, wall_height: float) -> str:
    if sill < 0.15:
        if 1.5 <= height <= 2.6 and width <= 1.3 and height < wall_height - 0.1:
            return "door"
        return "opening"
    if sill >= 0.3 and sill + height <= wall_height - 0.1 and width <= 3.5:
        return "window"
    return "opening"


def _refine_edge(values: np.ndarray, edge: float, solid_below: bool) -> float:
    """Sub-cell edge from the extreme solid-side points next to a cell-quantised edge."""
    near = values[np.abs(values - edge) < 3 * CELL]
    if len(near) < 5:
        return edge
    return float(np.percentile(near, 95 if solid_below else 5))


def detect_openings(
    points: np.ndarray, wall: WallInterpretation, wall_index: int, room_centre_xz: np.ndarray
) -> list[OpeningInterpretation]:
    a = np.array([wall.start[0], wall.start[2]])
    b = np.array([wall.end[0], wall.end[2]])
    length = float(np.linalg.norm(b - a))
    height = wall.height
    if length < 0.8:
        return []
    d = (b - a) / length
    n = np.array([-d[1], d[0]])
    if (room_centre_xz - a) @ n < 0:
        n = -n

    rel = points[:, [0, 2]] - a
    along, perp, y = rel @ d, rel @ n, points[:, 1]
    in_wall = (along > 0) & (along < length) & (y > 0) & (y < height)
    on_plane = in_wall & (np.abs(perp) < 0.06)
    if on_plane.sum() < 200:
        return []

    ns, ny = int(np.ceil(length / CELL)), int(np.ceil(height / CELL))
    grid = np.zeros((ny, ns), dtype=np.int32)
    np.add.at(
        grid,
        (
            np.minimum((y[on_plane] / CELL).astype(int), ny - 1),
            np.minimum((along[on_plane] / CELL).astype(int), ns - 1),
        ),
        1,
    )
    median = float(np.median(grid[grid > 0]))
    filled = (grid >= max(1.0, 0.2 * median)).astype(np.uint8)
    filled = cv2.morphologyEx(filled, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    empty = (1 - filled).astype(np.uint8)
    empty[:, :2] = 0  # corners and floor/ceiling seams are not openings
    empty[:, -2:] = 0
    empty[:1, :] = 0
    k = int(MIN_OPENING / CELL) - 1
    empty = cv2.morphologyEx(empty, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(empty, connectivity=4)

    front = in_wall & (perp > 0.1) & (perp < 0.9)
    wall_density = max(median, 1.0) / (CELL * CELL)
    found: list[OpeningInterpretation] = []
    for label in range(1, count):
        x, row, w, h, area = (int(v) for v in stats[label])
        width_m, height_m = w * CELL, h * CELL
        if width_m < MIN_OPENING or height_m < MIN_OPENING or area / (w * h) < 0.7:
            continue
        if width_m > 0.9 * length and height_m > 0.9 * height:
            continue  # whole wall missing: unobserved, not an opening
        s0, sill = x * CELL, row * CELL
        # Refine the 5 cm cell edges from the wall points bordering the gap (rows/columns inside it).
        plane_s, plane_y = along[on_plane], y[on_plane]
        rows = (plane_y > sill + CELL) & (plane_y < sill + height_m - CELL)
        cols = (plane_s > s0 + CELL) & (plane_s < s0 + width_m - CELL)
        left = _refine_edge(plane_s[rows], s0, solid_below=True)
        right = _refine_edge(plane_s[rows], s0 + width_m, solid_below=False)
        bottom = _refine_edge(plane_y[cols], sill, solid_below=True) if sill >= 0.1 else 0.0
        top = _refine_edge(plane_y[cols], sill + height_m, solid_below=False)
        if right - left >= MIN_OPENING and top - bottom >= MIN_OPENING:
            s0, sill, width_m, height_m = left, bottom, right - left, top - bottom

        ring = filled[max(row - 1, 0) : row + h + 1, max(x - 1, 0) : x + w + 1].astype(float)
        inner = filled[row : row + h, x : x + w].astype(float)
        border_support = float((ring.sum() - inner.sum()) / max(ring.size - inner.size, 1))
        rectangularity = float(area / (w * h))
        in_front = front & (along > s0) & (along < s0 + width_m) & (y > sill) & (y < sill + height_m)
        occluded = in_front.sum() / (width_m * height_m) > 0.5 * wall_density
        confidence = 0.5 * rectangularity + 0.4 * border_support + 0.1
        if occluded:
            confidence *= 0.5
        if confidence < 0.25:
            continue
        found.append(
            OpeningInterpretation(
                id=f"opening_{wall_index}_{len(found)}",
                wallId=wall.id,
                kind=_classify(sill, height_m, width_m, height),
                offset=float(s0 + width_m / 2),  # contract: wall.start -> opening centre
                width=float(width_m),
                height=float(height_m),
                sill=float(sill),
                confidence=float(np.clip(confidence, 0.0, 1.0)),
                provenance="auto",
            )
        )
    return sorted(found, key=lambda o: o.offset)


def merge_external_openings(
    interpretation: RoomInterpretation, external: Sequence[OpeningInterpretation]
) -> RoomInterpretation:
    """Merge image-based openings: overlapping ones boost and re-label the geometric opening."""
    merged = list(interpretation.openings)
    for ext in external:
        match = next(
            (
                i
                for i, o in enumerate(merged)
                if o.wallId == ext.wallId
                and (o.width + ext.width) / 2 - abs(o.offset - ext.offset) > 0.3 * min(o.width, ext.width)
            ),
            None,
        )
        if match is None:
            merged.append(ext)
        else:
            base = merged[match]
            merged[match] = base.model_copy(
                update={"kind": ext.kind, "confidence": min(1.0, max(base.confidence, ext.confidence) + 0.1)}
            )
    return interpretation.model_copy(update={"openings": merged})
