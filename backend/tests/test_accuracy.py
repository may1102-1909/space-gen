from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from plyfile import PlyData, PlyElement

from models.contracts import FloorPlane, OpeningInterpretation, RoomInterpretation, WallInterpretation
from models.reference_room import ReferenceRoom, ReferenceScan
from scripts.accuracy_report import main
from services.accuracy import build_report, error_table, evaluate, match_walls, summarise, to_markdown
from services.roomplan_import import from_captured_room
from tests.synthetic_rooms import ROOMS, generate, to_reference


def _write_splat(path: Path, positions: np.ndarray, opacity: np.ndarray) -> None:
    vertex = np.empty(len(positions), dtype=[("x", "f4"), ("y", "f4"), ("z", "f4"), ("opacity", "f4")])
    vertex["x"], vertex["y"], vertex["z"] = positions.T
    vertex["opacity"] = opacity
    path.parent.mkdir(parents=True, exist_ok=True)
    PlyData([PlyElement.describe(vertex, "vertex")]).write(str(path))


def _interp(outline, openings=(), ceiling=2.5):
    n = len(outline)
    walls = [
        WallInterpretation(
            id=f"wall_{i}",
            start=(outline[i][0], 0.0, outline[i][1]),
            end=(outline[(i + 1) % n][0], 0.0, outline[(i + 1) % n][1]),
            height=ceiling,
            thickness=0.15,
            confidence=1.0,
            provenance="auto",
        )
        for i in range(n)
    ]
    ops = [
        OpeningInterpretation(
            id=f"op_{j}", wallId=w, kind=k, offset=off, width=wd, height=h, sill=s, confidence=1.0, provenance="auto"
        )
        for j, (w, k, off, wd, h, s) in enumerate(openings)
    ]
    return RoomInterpretation(
        provenance="auto",
        floor=FloorPlane(normal=(0, 1, 0), constant=0, provenance="auto"),
        ceilingHeight=ceiling,
        outline=list(outline),
        walls=walls,
        openings=ops,
        detections=[],
    )


def _ref(lengths, openings=(), ceiling=2.5, source="sensor"):
    return ReferenceRoom.model_validate(
        {
            "id": "r",
            "scan": {"path": "scan.ply", "scaleSource": source},
            "ceilingHeight": ceiling,
            "walls": [{"id": f"w{i}", "length": v} for i, v in enumerate(lengths)],
            "openings": [dict(o) for o in openings],
        }
    )


def test_matching_finds_cyclic_shift_and_reversal():
    # Recovered walls, in loop order: 6, 3, sqrt(40), 5 (all distinct, so one alignment is right).
    interp = _interp([(0, 0), (6, 0), (6, 3), (0, 5)])
    diag = 40**0.5
    # Same direction, listed from wall_2.
    assert match_walls(_ref([diag, 5, 6, 3]), interp) == ({"w0": 2, "w1": 3, "w2": 0, "w3": 1}, False)
    # Opposite direction, listed from wall_1.
    assert match_walls(_ref([3, 6, 5, diag]), interp) == ({"w0": 1, "w1": 0, "w2": 3, "w3": 2}, True)


def test_matching_uses_openings_to_break_rectangle_symmetry():
    # 4/5/4/5 rectangle: shifts by two walls tie on length; the door decides.
    interp = _interp([(0, 0), (0, 4), (5, 4), (5, 0)], openings=[("wall_2", "door", 0.9, 0.9, 2.1, 0.0)])
    ref = _ref([4, 5, 4, 5], openings=[{"id": "d", "wall": "w2", "kind": "door", "width": 1.0, "height": 2.0}])
    mapping, _ = match_walls(ref, interp)
    assert mapping["w2"] == 2
    room = evaluate(ref, interp)
    assert room["openings_matched"] == 1
    widths = [s for s in room["samples"] if s["metric"] == "opening_width"]
    assert widths[0]["truth_m"] == 1.0 and widths[0]["measured_m"] == 0.9


def test_unequal_wall_counts_match_greedily_within_tolerance():
    interp = _interp([(0, 0), (5, 0), (5, 4), (0, 4)])
    ref = _ref([5, 4, 5, 4, 0.5])  # extra short wall the pipeline missed
    room = evaluate(ref, interp)
    assert room["walls_matched"] == 4
    assert all(s["truth_m"] == s["measured_m"] for s in room["samples"] if s["metric"] == "wall_length")


def test_error_math():
    samples = [
        {"metric": "wall_length", "truth_m": 4.0, "measured_m": 4.04},
        {"metric": "wall_length", "truth_m": 2.0, "measured_m": 1.9},
    ]
    s = summarise(samples)
    assert s["n"] == 2
    assert s["mean_cm"] == pytest.approx(7.0)
    assert s["max_cm"] == pytest.approx(10.0)
    assert s["mean_pct"] == pytest.approx(3.0)
    assert s["max_pct"] == pytest.approx(5.0)
    assert summarise([]) == {"n": 0}

    report = build_report(
        [
            {
                "scaleSource": "none",
                "walls_matched": 2,
                "walls_expected": 2,
                "openings_matched": 0,
                "openings_expected": 0,
                "samples": samples,
            }
        ]
    )
    table = error_table(report, "synthetic")
    assert table["scaleSources"]["none"] == {"relativePct": 5.0, "samples": 2, "rooms": 1}
    assert "| none | wall_length | 2 | 7.0 | 10.0 | 3.0 | 5.0 |" in to_markdown(report, "synthetic")


def test_scale_error_shows_up_as_relative_error():
    room = ROOMS[0]
    positions, opacity = generate(room)
    from services.room_structure import analyze_room

    result = analyze_room(positions * 1.1, opacity)
    errors = evaluate(to_reference(room, "none"), result.interpretation)
    pct = [abs(s["measured_m"] / s["truth_m"] - 1) for s in errors["samples"] if s["metric"] == "wall_length"]
    assert errors["walls_matched"] == 4 and errors["openings_matched"] == 2
    assert all(0.09 < p < 0.11 for p in pct)


def test_harness_runs_on_a_real_room_directory(tmp_path):
    room = ROOMS[0]
    positions, opacity = generate(room)
    room_dir = tmp_path / "rooms" / "living"
    _write_splat(room_dir / "scan.ply", positions, opacity)
    ref = to_reference(room, "user_measurement").model_copy(
        update={
            "id": "living",
            "groundTruthSource": "laser",
            "scan": ReferenceScan(path="scan.ply", scaleSource="user_measurement"),
        }
    )
    (room_dir / "reference.json").write_text(ref.model_dump_json(), encoding="utf-8")
    out = tmp_path / "out"
    assert main(["--rooms-dir", str(tmp_path / "rooms"), "--out-dir", str(out)]) == 0
    report = json.loads((out / "accuracy_report.json").read_text(encoding="utf-8"))
    assert report["errorTable"]["basis"] == "real"
    assert report["byScaleSource"]["user_measurement"]["walls_matched"] == "4/4"
    assert (out / "accuracy_report.md").read_text(encoding="utf-8").startswith("# Room-structure accuracy (real)")


def test_reference_rejects_unknown_opening_wall():
    with pytest.raises(ValueError):
        _ref([4, 5, 4], openings=[{"id": "d", "wall": "nope", "kind": "door", "width": 1, "height": 2}])


def _surface(ident, dims, pos, parent=None):
    t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, pos[0], pos[1], pos[2], 1]
    s = {"identifier": ident, "dimensions": dims, "transform": t}
    if parent:
        s["parentIdentifier"] = parent
    return s


def test_roomplan_import():
    data = {
        "walls": [
            _surface("A", [5.0, 2.6, 0], [2.5, 1.3, 0]),
            _surface("B", [4.0, 2.6, 0], [5, 1.3, 2]),
            _surface("C", [5.0, 2.6, 0], [2.5, 1.3, 4]),
            _surface("D", [4.0, 2.6, 0], [0, 1.3, 2]),
        ],
        "doors": [_surface("door1", [0.9, 2.1, 0], [1.0, 1.05, 0], parent="A")],
        "windows": [_surface("win1", [1.2, 1.1, 0], [2.0, 1.45, 4], parent="C")],
    }
    ref = from_captured_room(data, "rp", ReferenceScan(path="scan.ply", scaleSource="sensor"))
    assert ref.groundTruthSource == "roomplan"
    assert ref.ceilingHeight == pytest.approx(2.6)
    assert sorted(w.length for w in ref.walls) == [4.0, 4.0, 5.0, 5.0]
    # Walls come back as a loop around the centre: alternating 5/4 lengths.
    lengths = [w.length for w in ref.walls]
    assert all(lengths[i] != lengths[(i + 1) % 4] for i in range(4))
    door, window = ref.openings
    assert (door.kind, door.wall, door.sill) == ("door", "A", pytest.approx(0.0))
    assert (window.kind, window.sill) == ("window", pytest.approx(0.9))
