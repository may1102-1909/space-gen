"""Room structure accuracy against synthetic rooms with known ground truth."""

from __future__ import annotations

import time

import numpy as np
import pytest
from models.contracts import OpeningInterpretation
from services.room_structure import RoomStructureError, RoomStructureOptions, analyze_room

from .room_structure_metrics import ROW_HEADER, evaluate
from .room_structure_synth import L_SHAPE, RECTANGLE, SLANTED, Opening, make_room

DOOR = Opening(wall=0, offset=1.2, width=0.9, sill=0.0, height=2.0)
WINDOW = Opening(wall=2, offset=1.5, width=1.4, sill=0.9, height=1.2)

CASES = {
    "rectangle": dict(polygon=RECTANGLE, openings=[DOOR, WINDOW], seed=1),
    "l_shape": dict(
        polygon=L_SHAPE,
        openings=[Opening(0, 2.0, 0.9, 0.0, 2.0), Opening(4, 0.5, 1.2, 0.9, 1.1)],
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
    "slanted": dict(polygon=SLANTED, openings=[Opening(0, 1.5, 0.9, 0.0, 2.0)], seed=4),
    "tilted_scan": dict(
        polygon=RECTANGLE, openings=[Opening(1, 1.0, 0.9, 0.0, 2.0)], seed=5, max_tilt_deg=30.0
    ),
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
