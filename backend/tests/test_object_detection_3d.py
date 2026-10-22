from __future__ import annotations

import struct

import numpy as np
import pytest
from fastapi.testclient import TestClient

from models.contracts import DetectionInterpretation, MaskRegion
from services.object_detection import colmap, detectors
from services.object_detection.detectors import FakeDetector, Keyframe, parse_gemini_boxes
from services.object_detection.geometry import CameraView, fit_obb, look_at_view, obb_iou, points_in_obb
from services.object_detection.lifting import to_contracts
from services.object_detection.pipeline import drop_wall_points, merge_into_interpretation
from services.object_detection.synthetic import (
    LABELS,
    NOISE_LEVELS,
    OBJECTS,
    build_scene,
    evaluate,
    format_table,
    run_benchmark,
    run_detection,
)

# ---------------------------------------------------------------------------
# COLMAP parsing
# ---------------------------------------------------------------------------


def _rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def _rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def test_quaternion_round_trip():
    for R in (np.eye(3), _rot_y(2.5), _rot_x(-1.2) @ _rot_y(0.7), _rot_x(np.pi)):
        assert np.allclose(colmap.qvec_to_rotmat(colmap.rotmat_to_qvec(R)), R, atol=1e-9)


def test_read_text_model_with_comments_and_empty_points_lines(tmp_path):
    (tmp_path / "cameras.txt").write_text(
        "# Camera list\n# CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n1 PINHOLE 640 480 500 510 320 240\n2 SIMPLE_RADIAL 800 600 700 400 300 0.01\n"
    )
    (tmp_path / "images.txt").write_text(
        "# Image list with two lines of data per image:\n"
        "1 1 0 0 0 0.1 0.2 0.3 1 frame 001.jpg\n"
        "\n"
        "2 0.7071067811865476 0 0.7071067811865476 0 1 2 3 2 frame_002.jpg\n"
        "10.0 20.0 -1 30.0 40.0 5\n"
    )
    model = colmap.read_model(tmp_path)
    assert model.cameras[1].K.tolist() == [[500, 0, 320], [0, 510, 240], [0, 0, 1]]
    assert model.cameras[2].K[0, 0] == model.cameras[2].K[1, 1] == 700
    assert [im.name for im in model.images.values()] == ["frame 001.jpg", "frame_002.jpg"]
    im2 = model.images[2]
    assert np.allclose(im2.R, _rot_y(np.pi / 2))
    assert np.allclose(im2.center, -im2.R.T @ np.array([1.0, 2.0, 3.0]))
    assert colmap.find_model_dir(tmp_path.parent) == tmp_path


def test_read_binary_model(tmp_path):
    with open(tmp_path / "cameras.bin", "wb") as f:
        f.write(struct.pack("<Q", 1))
        f.write(struct.pack("<iiQQ", 3, 4, 1920, 1080))  # OPENCV
        f.write(struct.pack("<8d", 1000, 1001, 960, 540, 0.1, 0.01, 0, 0))
    with open(tmp_path / "images.bin", "wb") as f:
        f.write(struct.pack("<Q", 1))
        f.write(struct.pack("<i7di", 7, 1, 0, 0, 0, 0.5, -0.5, 2.0, 3))
        f.write(b"img_007.png\x00")
        f.write(struct.pack("<Q", 2))
        f.write(struct.pack("<ddq", 1.0, 2.0, -1) * 2)
    model = colmap.read_model(tmp_path)
    assert model.cameras[3].model == "OPENCV"
    assert model.cameras[3].K[1, 1] == 1001
    assert model.images[7].name == "img_007.png"
    assert np.allclose(model.images[7].tvec, [0.5, -0.5, 2.0])


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def test_obb_iou_known_values():
    a = {"center": (0, 0.5, 0), "size": (1, 1, 1), "yaw": 0.0}
    assert obb_iou(a, a) == pytest.approx(1.0)
    assert obb_iou(a, {**a, "center": (0.5, 0.5, 0)}) == pytest.approx(1 / 3)
    assert obb_iou(a, {**a, "yaw": np.pi / 2}) == pytest.approx(1.0)
    # 45 deg rotated unit square: overlap octagon area = 2*(sqrt(2)-1)
    inter = 2 * (np.sqrt(2) - 1)
    assert obb_iou(a, {**a, "yaw": np.pi / 4}) == pytest.approx(inter / (2 - inter), rel=1e-6)
    assert obb_iou(a, {**a, "center": (3, 0.5, 0)}) == 0.0


def test_fit_obb_recovers_rotated_box_and_snaps_to_floor():
    rng = np.random.default_rng(0)
    center, size, yaw = (1.0, 0.45, -2.0), (1.6, 0.9, 0.6), 0.6
    pts = rng.uniform(-3, 3, (60000, 3)) + np.array([0, 3, 0])
    pts = pts[points_in_obb(pts, center, size, yaw)]
    obb = fit_obb(pts)
    assert obb["center"][1] - obb["size"][1] / 2 == 0.0
    assert abs(obb["yaw"] - yaw) < np.deg2rad(3)
    # 2-98 percentile extents trim ~4% per axis of a uniformly filled box: IoU ~0.96^3
    assert obb_iou(obb, {"center": center, "size": size, "yaw": yaw}) > 0.85


def test_colmap_camera_matches_scene_camera_through_similarity_transform():
    K = np.array([[400.0, 0, 320], [0, 400.0, 240], [0, 0, 1]])
    scene_cam = look_at_view((2, 1.5, 2), (0, 0.5, 0), K, 640, 480)
    s, Q, b = 0.5, _rot_x(np.pi / 2) @ _rot_y(0.3), np.array([0.2, -1.0, 3.0])
    scene_from_colmap = np.eye(4)
    scene_from_colmap[:3, :3], scene_from_colmap[:3, 3] = s * Q, b
    R_c, t_c = scene_cam.R @ Q, (scene_cam.R @ b + scene_cam.t) / s
    view = CameraView.from_colmap(K, R_c, t_c, 640, 480, np.linalg.inv(scene_from_colmap))
    pts = np.random.default_rng(1).uniform(-1, 1, (50, 3))
    uv_a, d_a = scene_cam.project(pts)
    uv_b, d_b = view.project(pts)
    assert np.allclose(uv_a, uv_b) and np.allclose(d_a, d_b)
    assert np.allclose(view.center, [2, 1.5, 2])


# ---------------------------------------------------------------------------
# Detectors
# ---------------------------------------------------------------------------


def test_fake_detector_is_deterministic_and_noise_free_when_clean():
    _, frames = build_scene(0)
    det = FakeDetector(OBJECTS)
    a = det.detect(frames[0], LABELS)
    assert a and all(0.6 <= d.score <= 0.95 for d in a)
    noisy = FakeDetector(OBJECTS, seed=3, **NOISE_LEVELS["heavy"])
    assert [d.box for d in noisy.detect(frames[1], LABELS)] == [d.box for d in noisy.detect(frames[1], LABELS)]


def test_parse_gemini_boxes():
    text = (
        '```json\n[{"label": "Sofa", "box_2d": [100, 200, 500, 800], "score": 0.9},'
        '{"label": "unicorn", "box_2d": [0, 0, 10, 10]}, {"label": "chair", "box_2d": [10, 10, 5, 5]},'
        '{"label": "chair", "box_2d": [0, 0, 1000, 500]}]\n```'
    )
    dets = parse_gemini_boxes(text, width=1000, height=500, labels=["sofa", "chair"])
    assert [(d.label, d.box) for d in dets] == [
        ("sofa", (200.0, 50.0, 800.0, 250.0)),
        ("chair", (0.0, 0.0, 500.0, 500.0)),
    ]
    assert dets[0].score == 0.9 and dets[1].score == 0.6
    assert parse_gemini_boxes("no json here", 10, 10, ["sofa"]) == []


def test_get_detector_without_models_or_keys_raises(monkeypatch):
    monkeypatch.setattr(detectors.GroundedSamDetector, "is_available", staticmethod(lambda: False))
    monkeypatch.setattr(detectors, "gemini_api_key", lambda: "")
    with pytest.raises(RuntimeError, match="unavailable"):
        detectors.get_detector("auto")


# ---------------------------------------------------------------------------
# Synthetic multi-view evaluation (real hand-labelled scans pending)
# ---------------------------------------------------------------------------


def test_synthetic_benchmark_iou_and_recall():
    table = run_benchmark(seed=3)
    print("\n" + format_table(table))
    assert table["clean"]["recall@0.5"] == 1.0 and table["clean"]["mean_iou"] > 0.85
    assert table["moderate"]["recall@0.5"] >= 0.8 and table["moderate"]["mean_iou"] > 0.7
    assert table["heavy"]["recall@0.25"] >= 0.66


def test_confidence_drops_when_views_disagree():
    points, frames = build_scene(0)
    clean = run_detection(FakeDetector(OBJECTS), frames, LABELS, points)
    missing = run_detection(FakeDetector(OBJECTS, miss_rate=0.4), frames, LABELS, points)
    conf = {r.label: r.confidence for r in clean}
    for r in missing:
        assert 0.0 < r.confidence <= 1.0
    assert np.mean([r.view_agreement for r in missing]) < np.mean([r.view_agreement for r in clean])
    assert set(conf) == set(LABELS)


def test_to_contracts_links_detection_and_disabled_mask():
    points, frames = build_scene(0)
    out = to_contracts(run_detection(FakeDetector(OBJECTS), frames, LABELS, points), id_prefix="det_x")
    assert len(out["detections"]) == len(out["maskRegions"]) == len(OBJECTS)
    for det, mask in zip(out["detections"], out["maskRegions"]):
        assert isinstance(det, DetectionInterpretation) and isinstance(mask, MaskRegion)
        assert det.maskRegionId == mask.id and mask.detectionId == det.id
        assert det.status == "auto" and det.provenance == "auto" and mask.enabled is False
        assert mask.obb == det.obb


def test_merge_keeps_user_reviewed_detections():
    obb = {"center": (0, 0.5, 0), "size": (1, 1, 1), "yaw": 0.0}
    base = {
        "detections": [
            {"id": "old_auto", "status": "auto", "provenance": "auto", "obb": obb},
            {"id": "verified", "status": "verified", "provenance": "auto", "obb": obb},
            {"id": "user_drawn", "status": "auto", "provenance": "user", "obb": obb},
        ]
    }
    merged = merge_into_interpretation(base, [{"id": "new", "status": "auto", "provenance": "auto", "obb": obb}])
    assert [d["id"] for d in merged["detections"]] == ["verified", "user_drawn", "new"]


# ---------------------------------------------------------------------------
# Background job endpoint, end to end on a synthetic reconstruction folder
# ---------------------------------------------------------------------------


def _write_reconstruction(job_dir, scan_to_scene, colmap_to_scan):
    from plyfile import PlyData, PlyElement

    points, frames = build_scene(4)
    scene_from_colmap = scan_to_scene @ colmap_to_scan
    s = np.cbrt(np.linalg.det(scene_from_colmap[:3, :3]))
    Q, b = scene_from_colmap[:3, :3] / s, scene_from_colmap[:3, 3]
    model = colmap.ColmapModel()
    model.cameras[1] = colmap.ColmapCamera(1, "PINHOLE", 640, 480, [500.0, 500.0, 320.0, 240.0])
    for i, fr in enumerate(frames, start=1):
        R = fr.camera.R @ Q
        t = (fr.camera.R @ b + fr.camera.t) / s
        model.images[i] = colmap.ColmapImage(i, colmap.rotmat_to_qvec(R), t, 1, fr.name)
    colmap.write_model_text(model, job_dir / "processed" / "colmap" / "sparse" / "0")

    scan_pts = (points - scan_to_scene[:3, 3]) @ np.linalg.inv(scan_to_scene[:3, :3]).T
    vertex = np.zeros(len(scan_pts), dtype=[("x", "f4"), ("y", "f4"), ("z", "f4"), ("opacity", "f4")])
    vertex["x"], vertex["y"], vertex["z"] = scan_pts.T
    vertex["opacity"] = 3.0
    (job_dir / "export").mkdir(parents=True)
    PlyData([PlyElement.describe(vertex, "vertex")]).write(str(job_dir / "export" / "splat.ply"))


@pytest.fixture
def detection_client(tmp_path, monkeypatch):
    from main import app
    from routes import detection

    monkeypatch.setattr(detection, "DATA_ROOT", tmp_path)
    monkeypatch.setattr(
        detection, "get_detector", lambda name: FakeDetector(OBJECTS, seed=1, **NOISE_LEVELS["moderate"])
    )
    with TestClient(app) as client:
        yield client, tmp_path


def test_detection_job_end_to_end(detection_client):
    client, root = detection_client
    scan_to_scene = np.eye(4)
    scan_to_scene[:3, :3], scan_to_scene[:3, 3] = _rot_y(0.4), (0.5, 1.2, -0.3)
    colmap_to_scan = np.eye(4)
    colmap_to_scan[:3, :3], colmap_to_scan[:3, 3] = 2.0 * _rot_x(np.pi / 2), (0.1, 0.0, 0.2)
    _write_reconstruction(root / "recon1", scan_to_scene, colmap_to_scan)

    interpretation = {
        "provenance": "auto",
        "floor": {"normal": (0, 1, 0), "constant": 0, "provenance": "auto"},
        "ceilingHeight": 2.6,
        "outline": [(-3, -2.5), (3, -2.5), (3, 2.5), (-3, 2.5)],
        "walls": [],
        "openings": [],
        "detections": [],
    }
    resp = client.post(
        "/api/detection/jobs",
        json={
            "reconstructionJobId": "recon1",
            "labels": LABELS,
            "scanToScene": scan_to_scene.reshape(-1).tolist(),
            "colmapToScan": colmap_to_scan.reshape(-1).tolist(),
            "interpretation": interpretation,
        },
    )
    assert resp.status_code == 202, resp.text
    job = client.get(f"/api/detection/jobs/{resp.json()['job_id']}").json()
    assert job["status"] == "completed", job
    result = job["result"]
    assert len(result["interpretation"]["detections"]) == len(result["detections"])
    assert {m["detectionId"] for m in result["maskRegions"]} == {d["id"] for d in result["detections"]}

    class _P:
        def __init__(self, d):
            self.label, self.obb = d["label"], d["obb"]

    metrics = evaluate([_P(d) for d in result["detections"]])
    assert metrics["recall@0.5"] >= 0.8, metrics
    assert (root / "recon1" / "detections" / f"{job['job_id']}.json").exists()


def test_detection_job_rejects_traversal_and_missing_jobs(detection_client):
    client, root = detection_client
    assert client.post("/api/detection/jobs", json={"reconstructionJobId": ".."}).status_code == 400
    assert client.post("/api/detection/jobs", json={"reconstructionJobId": "nope"}).status_code == 404
    assert client.get("/api/detection/jobs/does-not-exist").status_code == 400
    assert client.get("/api/detection/jobs/abc123").status_code == 404


def test_detection_job_without_colmap_fails_cleanly(detection_client):
    client, root = detection_client
    (root / "importonly" / "export").mkdir(parents=True)
    job_id = client.post("/api/detection/jobs", json={"reconstructionJobId": "importonly"}).json()["job_id"]
    job = client.get(f"/api/detection/jobs/{job_id}").json()
    assert job["status"] == "failed" and "COLMAP" in job["error"]


def test_keyframe_without_image_raises():
    with pytest.raises(FileNotFoundError):
        Keyframe("x.jpg", build_scene(0)[1][0].camera).load_image()


def test_drop_wall_points_removes_only_points_near_wall_faces():
    wall = {"start": [0.0, 0.0, 0.0], "end": [4.0, 0.0, 0.0], "thickness": 0.1, "height": 2.5}
    points = np.array(
        [
            [2.0, 1.0, 0.04],  # on the wall face
            [2.0, 1.0, 0.09],  # 4 cm in front of the face
            [2.0, 1.0, 0.2],  # object 15 cm off the wall
            [4.2, 1.0, 0.0],  # past the wall end
        ]
    )
    kept = drop_wall_points(points, [wall])
    np.testing.assert_allclose(kept, points[[2, 3]])


# Ported from main's dropped T11 suite.


def test_single_view_false_positive_is_rejected():
    points, frames = build_scene(0)

    class OneViewLamp(FakeDetector):
        def detect(self, frame, labels):
            out = super().detect(frame, labels)
            if frame.name == frames[2].name:  # a lamp "seen" in one keyframe only
                out.append(detectors.Detection2D("lamp", 0.7, (300.0, 200.0, 340.0, 300.0)))
            return out

    others = [o for o in OBJECTS if o.label != "lamp"]
    results = run_detection(OneViewLamp(others), frames, LABELS, points)
    assert {r.label for r in results} == {o.label for o in others}


def test_no_detections_gives_empty_result():
    points, frames = build_scene(0)
    out = to_contracts(run_detection(FakeDetector([]), frames, LABELS, points))
    assert out == {"detections": [], "maskRegions": []}


def test_low_opacity_splats_are_not_loaded(tmp_path):
    from plyfile import PlyData, PlyElement

    from services.object_detection.pipeline import load_splat_points

    vertex = np.zeros(4, dtype=[("x", "f4"), ("y", "f4"), ("z", "f4"), ("opacity", "f4")])
    vertex["x"] = [0, 1, 2, 3]
    vertex["opacity"] = [4.0, -4.0, 4.0, -4.0]  # logits: opaque, floater, opaque, floater
    PlyData([PlyElement.describe(vertex, "vertex")]).write(str(tmp_path / "s.ply"))
    np.testing.assert_allclose(load_splat_points(tmp_path / "s.ply")[:, 0], [0, 2])
