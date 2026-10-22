"""Room structure accuracy against synthetic rooms with known ground truth."""

from __future__ import annotations

import struct
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from models.contracts import OpeningInterpretation, RoomInterpretation
from services.room_structure import (
    RoomStructureError,
    RoomStructureOptions,
    analyze_room,
    load_colmap_points,
)
from services.room_structure.openings import merge_external_openings

from .room_structure_metrics import ROW_HEADER, evaluate
from .room_structure_synth import L_SHAPE, RECTANGLE, SLANTED, Opening, make_room
from .synthetic_rooms import ROOMS, generate, recovery_errors

DOOR = Opening(wall=0, offset=1.65, width=0.9, sill=0.0, height=2.0)
WINDOW = Opening(wall=2, offset=2.2, width=1.4, sill=0.9, height=1.2)

CASES = {
    "rectangle": dict(polygon=RECTANGLE, openings=[DOOR, WINDOW], seed=1),
    "l_shape": dict(
        polygon=L_SHAPE,
        openings=[Opening(0, 2.45, 0.9, 0.0, 2.0), Opening(4, 1.1, 1.2, 0.9, 1.1)],
        seed=2,
    ),
    "noise_floaters": dict(
        polygon=RECTANGLE,
        openings=[DOOR, WINDOW],
        seed=3,
        noise=0.02,
        furniture=3,
        floaters=1500,
        low_opacity_floaters=3000,
    ),
    "slanted": dict(polygon=SLANTED, openings=[Opening(0, 1.95, 0.9, 0.0, 2.0)], seed=4),
    "tilted_scan": dict(polygon=RECTANGLE, openings=[Opening(1, 1.45, 0.9, 0.0, 2.0)], seed=5, max_tilt_deg=30.0),
}

_results: dict[str, tuple] = {}


def _run(name: str):
    if name not in _results:
        scene = make_room(**CASES[name])
        started = time.perf_counter()
        result = analyze_room(scene.positions, scene.opacity)
        _results[name] = (scene, result, time.perf_counter() - started)
    return _results[name]


@pytest.mark.parametrize("name", list(CASES))
def test_recovers_walls_ceiling_and_openings(name):
    scene, result, _ = _run(name)
    acc = evaluate(scene, result)
    assert acc.walls_matched == acc.walls_expected, acc
    assert acc.max_wall_offset_cm < 5.0
    assert acc.max_wall_angle_deg < 1.0
    assert acc.max_corner_error_cm < 10.0
    assert acc.ceiling_error_cm < 3.0
    assert acc.openings_matched == acc.openings_expected
    assert acc.max_opening_error_cm < 10.0


def test_manhattan_prior_and_non_manhattan_fallback():
    assert _run("rectangle")[1].diagnostics["orientation"]["manhattan"] is True
    assert _run("l_shape")[1].diagnostics["orientation"]["manhattan"] is True
    assert _run("slanted")[1].diagnostics["orientation"]["manhattan"] is False


def test_scan_to_scene_is_rigid_y_up_with_floor_at_zero():
    scene, result, _ = _run("tilted_scan")
    m = np.array(result.scan_to_scene).reshape(4, 4)
    assert np.allclose(m[3], [0, 0, 0, 1])
    assert np.allclose(m[:3, :3] @ m[:3, :3].T, np.eye(3), atol=1e-6)
    assert np.linalg.det(m[:3, :3]) > 0
    floor_scene = (scene.positions @ m[:3, :3].T + m[:3, 3])[:, 1]
    assert abs(np.median(floor_scene[floor_scene < 0.3])) < 0.03
    assert result.interpretation.floor.normal == (0.0, 1.0, 0.0)
    assert result.interpretation.floor.constant == 0.0


def test_every_element_has_confidence_and_outline_matches_walls():
    for name in CASES:
        interp = _run(name)[1].interpretation
        assert len(interp.outline) == len(interp.walls)
        assert all(0.0 <= w.confidence <= 1.0 for w in interp.walls)
        assert all(0.0 <= o.confidence <= 1.0 for o in interp.openings)
        assert interp.walls and all(w.height == pytest.approx(interp.ceilingHeight) for w in interp.walls)


def test_opening_kinds_and_confidences():
    interp = _run("rectangle")[1].interpretation
    by_kind = {o.kind: o for o in interp.openings}
    assert set(by_kind) == {"door", "window"}
    assert by_kind["door"].sill < 0.1 and by_kind["door"].height == pytest.approx(2.0, abs=0.12)
    assert by_kind["window"].sill == pytest.approx(0.9, abs=0.1)
    assert by_kind["window"].height == pytest.approx(1.2, abs=0.12)
    assert all(o.confidence > 0.5 for o in interp.openings)


@pytest.mark.parametrize("name", list(CASES))
def test_door_and_window_kinds_per_case(name):
    """Floor vs ceiling must not flip: doors reach the floor, windows float."""
    scene, result, _ = _run(name)
    openings = result.interpretation.openings
    expected = Counter("door" if o.sill == 0.0 else "window" for o in scene.openings)
    assert Counter(o.kind for o in openings) == expected
    for o in openings:
        if o.kind == "door":
            assert o.sill < 0.1 and o.height == pytest.approx(2.0, abs=0.15)
        else:
            assert o.sill > 0.5


def test_upside_down_scan_without_furniture_resolves_floor_from_ceiling():
    for seed in range(6, 10):
        scene = make_room(polygon=L_SHAPE, openings=[Opening(0, 2.45, 0.9, 0.0, 2.0)], seed=seed)
        result = analyze_room(scene.positions, scene.opacity)
        assert [o.kind for o in result.interpretation.openings] == ["door"], seed
        assert result.interpretation.openings[0].sill < 0.1


def test_deterministic_for_a_seed():
    scene, first, _ = _run("rectangle")
    again = analyze_room(scene.positions, scene.opacity)
    assert again.scan_to_scene == first.scan_to_scene
    assert again.interpretation == first.interpretation


def test_colmap_points_are_merged():
    scene = make_room(RECTANGLE, openings=[DOOR], seed=6)
    keep = np.random.default_rng(0).random(len(scene.positions)) < 0.2
    sparse, colmap = scene.positions[keep], scene.positions[~keep][:4000]
    result = analyze_room(sparse, scene.opacity[keep], colmap)
    assert result.diagnostics["pointsInput"] == len(sparse) + len(colmap)
    assert evaluate(scene, result).walls_matched == 4


def test_image_based_opening_detector_hook_is_merged():
    scene, _, _ = _run("rectangle")

    def detector(interp):
        wall = interp.walls[1]
        return [
            OpeningInterpretation(
                id="img_0",
                wallId=wall.id,
                kind="window",
                offset=0.5,
                width=0.8,
                height=1.0,
                sill=1.0,
                confidence=0.6,
                provenance="auto",
            )
        ]

    result = analyze_room(scene.positions, scene.opacity, opening_detector=detector)
    assert any(o.id == "img_0" for o in result.interpretation.openings)


def test_too_few_points_is_a_clear_error():
    with pytest.raises(RoomStructureError):
        analyze_room(np.random.default_rng(0).random((100, 3)))


def test_scale_option_and_warning_for_implausible_height():
    scene = make_room(RECTANGLE, seed=7, rotate=False)
    result = analyze_room(scene.positions * 0.4, scene.opacity)
    assert "scaleWarning" in result.diagnostics
    fixed = analyze_room(
        scene.positions * 0.4, scene.opacity, options=RoomStructureOptions(scale=result.diagnostics["suggestedScale"])
    )
    # the suggestion assumes a typical 2.5 m ceiling
    assert fixed.interpretation.ceilingHeight == pytest.approx(2.5, abs=0.1)


def test_report_accuracy_table(capsys):
    rows = [evaluate(_run(n)[0], _run(n)[1]).row(f"{n} ({_run(n)[2]:.1f}s)") for n in CASES]
    with capsys.disabled():
        print("\n" + ROW_HEADER + "\n" + "\n".join(rows))


# --- Second synthetic set (also the T18b accuracy fixture): logit opacities, bounded tilt + yaw,
# sparse view-through points behind windows, kind-checked openings.
WALL_OFFSET_TOL = 0.05
WALL_ANGLE_TOL = 2.0
CORNER_TOL = 0.08
CEILING_TOL = 0.03
FLOOR_NORMAL_TOL = 1.0
OPENING_TOL = 0.08


@pytest.mark.parametrize("seed", [0, 1])
@pytest.mark.parametrize("room", ROOMS, ids=[r.name for r in ROOMS])
def test_recovers_second_synthetic_set(room, seed):
    positions, opacity = generate(room, seed=seed)
    result = analyze_room(positions, opacity)
    errors = recovery_errors(room, result)
    assert errors.get("walls_found") == errors.get("walls_expected"), errors
    assert errors["wall_offset_m"] < WALL_OFFSET_TOL
    assert errors["wall_angle_deg"] < WALL_ANGLE_TOL
    assert errors["corner_m"] < CORNER_TOL
    assert errors["ceiling_m"] < CEILING_TOL
    assert errors["floor_normal_deg"] < FLOOR_NORMAL_TOL
    assert errors["openings_matched"] == errors["openings_expected"]
    assert errors["opening_m"] < OPENING_TOL
    assert errors["extra_openings"] == 0

    interp = result.interpretation
    assert result.diagnostics["orientation"]["manhattan"] is (room.name != "non_manhattan")
    assert interp.floor.confidence is not None and interp.ceilingConfidence is not None
    assert all(w.start[1] == 0.0 and w.end[1] == 0.0 for w in interp.walls)
    RoomInterpretation.model_validate(interp.model_dump(mode="json"))


def test_low_opacity_logits_are_filtered():
    room = ROOMS[0]
    positions, opacity = generate(room)
    junk = np.random.default_rng(3).uniform(-3, 3, size=(20_000, 3))
    noisy = analyze_room(np.vstack([positions, junk]), np.concatenate([opacity, np.full(len(junk), -6.0)]))
    errors = recovery_errors(room, noisy)
    assert errors["walls_found"] == 4 and errors["wall_offset_m"] < WALL_OFFSET_TOL


def test_overlapping_image_opening_relabels_the_geometric_one():
    interp = _run("rectangle")[1].interpretation
    window = next(o for o in interp.openings if o.kind == "window")
    merged = merge_external_openings(
        interp, [window.model_copy(update={"id": "img_0", "kind": "door", "confidence": 0.9})]
    )
    assert len(merged.openings) == len(interp.openings)
    assert next(o for o in merged.openings if o.id == window.id).kind == "door"


def test_colmap_points_loaders(tmp_path):
    txt = tmp_path / "points3D.txt"
    txt.write_text("# header\n1 0.5 1.5 2.5 255 0 0 0.1 1 2\n2 -1 0 1 0 0 0 0.2 3 4 5 6\n", encoding="utf-8")
    assert np.allclose(load_colmap_points(txt), [[0.5, 1.5, 2.5], [-1, 0, 1]])

    data = struct.pack("<Q", 1) + struct.pack("<QdddBBBd", 7, 1.0, 2.0, 3.0, 1, 2, 3, 0.5)
    data += struct.pack("<Q", 2) + struct.pack("<iiii", 1, 0, 2, 1)
    binary = tmp_path / "points3D.bin"
    binary.write_bytes(data)
    assert np.allclose(load_colmap_points(binary), [[1.0, 2.0, 3.0]])


def test_service_does_not_require_open3d():
    code = "import sys, services.room_structure; assert 'open3d' not in sys.modules"
    subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1], check=True)
