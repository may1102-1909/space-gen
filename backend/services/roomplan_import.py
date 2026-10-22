"""Importer stub: Apple RoomPlan CapturedRoom JSON -> ReferenceRoom.

Reads the JSON that `JSONEncoder().encode(capturedRoom)` produces (iOS 16/17): `walls`, `doors`,
`windows`, `openings` surfaces with `identifier`, `dimensions` [width, height, depth], a 4x4
`transform` (column-major, flat 16 or 4 columns) and, for iOS 17+, `parentIdentifier` linking an
opening to its wall. Not validated against a real export yet. USDZ import is a TODO (docs/accuracy.md).

RoomPlan is itself a LiDAR estimate (a few cm), so the result is tagged groundTruthSource="roomplan".
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Sequence

from models.reference_room import ReferenceOpening, ReferenceRoom, ReferenceScan, ReferenceWall

_KINDS = {"doors": "door", "windows": "window", "openings": "opening"}


def _translation(transform: Sequence[Any]) -> List[float]:
    flat = [float(v) for col in transform for v in col] if isinstance(transform[0], (list, tuple)) else transform
    if len(flat) != 16:
        raise ValueError("RoomPlan transform must have 16 values")
    return [float(flat[12]), float(flat[13]), float(flat[14])]


def from_captured_room(data: Dict[str, Any], room_id: str, scan: ReferenceScan) -> ReferenceRoom:
    walls = data.get("walls") or []
    if len(walls) < 3:
        raise ValueError("CapturedRoom JSON has fewer than 3 walls")
    centres = {w["identifier"]: _translation(w["transform"]) for w in walls}
    cx = sum(c[0] for c in centres.values()) / len(centres)
    cz = sum(c[2] for c in centres.values()) / len(centres)
    # RoomPlan walls are unordered; sort around the room centre to get a loop.
    ordered = sorted(
        walls, key=lambda w: math.atan2(centres[w["identifier"]][2] - cz, centres[w["identifier"]][0] - cx)
    )
    floor_y = min(centres[w["identifier"]][1] - float(w["dimensions"][1]) / 2 for w in walls)
    ref_walls = [
        ReferenceWall(id=w["identifier"], length=float(w["dimensions"][0]), label=f"roomplan wall {i}")
        for i, w in enumerate(ordered)
    ]
    openings = []
    for key, kind in _KINDS.items():
        for o in data.get(key) or []:
            parent = o.get("parentIdentifier")
            if parent not in centres:
                continue  # pre-iOS 17 exports do not link openings to walls
            width, height = float(o["dimensions"][0]), float(o["dimensions"][1])
            sill = max(0.0, _translation(o["transform"])[1] - height / 2 - floor_y)
            openings.append(
                ReferenceOpening(id=o["identifier"], wall=parent, kind=kind, width=width, height=height, sill=sill)
            )
    return ReferenceRoom(
        id=room_id,
        name=room_id,
        groundTruthSource="roomplan",
        instrument="Apple RoomPlan",
        scan=scan,
        ceilingHeight=max(float(w["dimensions"][1]) for w in walls),
        walls=ref_walls,
        openings=openings,
    )
