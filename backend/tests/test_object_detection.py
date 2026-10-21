import numpy as np
import pytest

from services.object_detection import pipeline as pl
from services.object_detection.colmap import quat_to_rotation, read_model
from services.object_detection.detectors import Detection2D, FixtureDetector, GeminiDetector
from services.object_detection.evaluation import box_from_dict, evaluate, load_labelled_boxes
from services.object_detection.geometry import fit_obb, obb_iou
from services.object_detection.runner import run_on_scan_folder
from services.object_detection.synthetic import build_synthetic_scan, write_scan_folder


@pytest.fixture(scope="module")
def scan_dir(tmp_path_factory):
    return write_scan_folder(tmp_path_factory.mktemp("scan") / "synthetic")


@pytest.fixture(scope="module")
def result(scan_dir):
    return run_on_scan_folder(scan_dir, detector_name="fixture")


def test_synthetic_accuracy(scan_dir, result):
    truth = load_labelled_boxes(scan_dir / "labels.json")
    preds = [box_from_dict(d.model_dump()) for d in result.detections]
    metrics = evaluate(preds, truth)
    for row in metrics["thresholds"].values():
        assert row["recall"] == 1.0 and row["precision"] == 1.0
    assert metrics["meanIou"] > 0.9
    assert metrics["maxCentreErrorM"] < 0.05
    assert metrics["maxSizeErrorM"] < 0.08


def test_single_view_lamp_is_rejected(scan_dir, result):
    scan = build_synthetic_scan()
    assert sum(1 for dets in scan.detections_json.values() for d in dets if d["label"] == "lamp") == 1
    assert "lamp" not in {d.label for d in result.detections}
    assert result.diagnostics["rejectedClusters"] >= 1


def test_output_contract(result):
    assert {d.label for d in result.detections} == {"sofa", "table", "chair"}
    masks = {m.id: m for m in result.maskRegions}
    assert len(masks) == len(result.detections)
    for det in result.detections:
        assert det.status == "auto" and det.provenance == "auto"
        assert 0.0 < det.confidence <= 1.0
        mask = masks[det.maskRegionId]
        assert mask.detectionId == det.id and mask.obb == det.obb


def test_colmap_text_roundtrip_matches_scan(scan_dir):
    scan = build_synthetic_scan()
    model = read_model(scan_dir / "sparse" / "0")
    for written, truth in zip(model.images, scan.model.images, strict=True):
        assert np.allclose(written.R_cw, truth.R_cw, atol=1e-9)
        assert np.allclose(written.center, truth.center, atol=1e-9)


def test_opacity_floaters_are_filtered(scan_dir):
    from services.object_detection.splat_io import load_splat_centers

    scan = build_synthetic_scan()
    assert len(load_splat_centers(scan_dir / "splat.ply")) == len(scan.points_scan) - 400


def test_no_detections_gives_empty_result():
    scan = build_synthetic_scan()
    out = pl.run_pipeline(scan.points_scan, scan.model, scan.frames, FixtureDetector({}), scan.scan_to_scene)
    assert out.detections == [] and out.maskRegions == []


def test_cross_label_nms_keeps_most_confident():
    box = ((0.0, 0.5, 0.0), (1.0, 1.0, 1.0), 0.0)
    kept = pl.nms(
        [{"label": "chair", "obb": box, "confidence": 0.4}, {"label": "armchair", "obb": box, "confidence": 0.8}], 0.5
    )
    assert [k["label"] for k in kept] == ["armchair"]


def test_fit_obb_recovers_yaw_and_size():
    rng = np.random.default_rng(0)
    local = rng.uniform([-1.0, 0.0, -0.4], [1.0, 0.9, 0.4], (4000, 3))
    yaw = 0.6
    pts = np.stack(
        [
            2.0 + local[:, 0] * np.cos(yaw) + local[:, 2] * np.sin(yaw),
            local[:, 1],
            1.0 - local[:, 0] * np.sin(yaw) + local[:, 2] * np.cos(yaw),
        ],
        axis=1,
    )
    center, size, fitted_yaw = fit_obb(pts)
    assert obb_iou((center, size, fitted_yaw), ((2.0, 0.45, 1.0), (2.0, 0.9, 0.8), yaw)) > 0.9


def test_gemini_parse_response_and_key_gating(monkeypatch):
    text = '```json\n[{"label": "Sofa", "box_2d": [100, 200, 500, 900], "confidence": 0.9}, {"label": "x", "box_2d": [0, 0, 1, 1]}]\n```'
    dets = GeminiDetector.parse_response(text, ["sofa"])
    assert dets == [Detection2D("sofa", 0.9, (0.2, 0.1, 0.9, 0.5))]
    monkeypatch.setattr("services.object_detection.detectors.settings.gemini_api_key", "")
    assert not GeminiDetector.is_configured()


def test_quaternion_normalised():
    assert np.allclose(quat_to_rotation(2.0, 0, 0, 0), np.eye(3))
