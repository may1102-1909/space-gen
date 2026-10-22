from __future__ import annotations

import struct
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from plyfile import PlyData, PlyElement

from main import app
from models.contracts import ConversionJobStatus, OpeningInterpretation, RoomInterpretation
from routes.projects import get_project_repository
from routes.room_structure import RoomStructureJobStore, get_job_store, get_reconstruction_root
from services.project_repository import FilesystemProjectRepository
from services.room_structure import (
    RoomStructureError,
    extract_room_structure,
    load_colmap_points,
    load_splat_ply,
)
from tests.synthetic_rooms import ROOMS, generate, recovery_errors, write_gaussian_ply

BACKEND = Path(__file__).resolve().parents[1]

# Tolerances for synthetic recovery (scene frame, metres / degrees).
WALL_OFFSET_TOL = 0.05
WALL_ANGLE_TOL = 2.0
CORNER_TOL = 0.08
CEILING_TOL = 0.03
FLOOR_NORMAL_TOL = 1.0
OPENING_TOL = 0.08


@pytest.mark.parametrize("seed", [0, 1])
@pytest.mark.parametrize("room", ROOMS, ids=[r.name for r in ROOMS])
def test_recovers_synthetic_room(room, seed):
    positions, opacity = generate(room, seed=seed)
    result = extract_room_structure(positions, opacity)
    errors = recovery_errors(room, result)
    print(f"\n{room.name} seed={seed}: " + ", ".join(f"{k}={v:.3f}" for k, v in errors.items()))

    assert errors["walls_found"] == errors["walls_expected"]
    assert errors["wall_offset_m"] < WALL_OFFSET_TOL
    assert errors["wall_angle_deg"] < WALL_ANGLE_TOL
    assert errors["corner_m"] < CORNER_TOL
    assert errors["ceiling_m"] < CEILING_TOL
    assert errors["floor_normal_deg"] < FLOOR_NORMAL_TOL
    assert errors["openings_matched"] == errors["openings_expected"]
    assert errors["opening_m"] < OPENING_TOL
    assert errors["extra_openings"] == 0

    interp = result.interpretation
    assert result.manhattan is (room.name != "non_manhattan")
    assert 0.0 <= result.gravityConfidence <= 1.0
    assert interp.floor.confidence is not None and interp.ceilingConfidence is not None
    assert all(0.0 < w.confidence <= 1.0 for w in interp.walls)
    assert all(0.0 < o.confidence <= 1.0 for o in interp.openings)
    # The scene frame puts the floor at y=0 and every wall on it.
    assert all(w.start[1] == 0.0 and w.end[1] == 0.0 for w in interp.walls)
    RoomInterpretation.model_validate(interp.model_dump(mode="json"))


def test_rejects_too_few_points():
    with pytest.raises(RoomStructureError):
        extract_room_structure(np.zeros((10, 3)))


def test_low_opacity_logits_are_filtered():
    room = ROOMS[0]
    positions, opacity = generate(room)
    junk = np.random.default_rng(3).uniform(-3, 3, size=(20_000, 3))
    noisy = extract_room_structure(np.vstack([positions, junk]), np.concatenate([opacity, np.full(len(junk), -6.0)]))
    errors = recovery_errors(room, noisy)
    assert errors["walls_found"] == 4 and errors["wall_offset_m"] < WALL_OFFSET_TOL


def test_image_detector_is_fused():
    room = ROOMS[0]
    positions, opacity = generate(room)
    base = extract_room_structure(positions, opacity)
    window = next(o for o in base.interpretation.openings if o.kind == "window")

    class FakeDetector:
        def detect(self, walls, ceiling_height):
            return [
                window.model_copy(update={"kind": "door", "confidence": 0.9}),
                OpeningInterpretation(
                    id="img_0",
                    wallId=walls[0].id,
                    kind="window",
                    offset=0.5,
                    width=0.5,
                    height=0.5,
                    sill=1.0,
                    confidence=0.5,
                    provenance="auto",
                ),
            ]

    fused = extract_room_structure(positions, opacity, image_detector=FakeDetector()).interpretation.openings
    assert len(fused) == len(base.interpretation.openings) + 1
    assert next(o for o in fused if o.id == window.id).kind == "door"


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
    subprocess.run([sys.executable, "-c", code], cwd=BACKEND, check=True)


def _write_splat(path: Path, positions: np.ndarray, opacity: np.ndarray) -> None:
    vertex = np.empty(len(positions), dtype=[("x", "f4"), ("y", "f4"), ("z", "f4"), ("opacity", "f4")])
    vertex["x"], vertex["y"], vertex["z"] = positions.T
    vertex["opacity"] = opacity
    path.parent.mkdir(parents=True, exist_ok=True)
    PlyData([PlyElement.describe(vertex, "vertex")]).write(str(path))


@pytest.fixture
def client(tmp_path):
    store = RoomStructureJobStore()
    app.dependency_overrides[get_job_store] = lambda: store
    app.dependency_overrides[get_reconstruction_root] = lambda: tmp_path
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _poll(client, job_id, timeout=60.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/room-structure/jobs/{job_id}").json()
        if body["status"] in ("completed", "failed"):
            return body
        time.sleep(0.1)
    raise AssertionError("room structure job did not finish")


def test_job_endpoint_runs_in_background(client, tmp_path):
    positions, opacity = generate(ROOMS[0])
    _write_splat(tmp_path / "scan01" / "export" / "splat.ply", positions, opacity)
    loaded, loaded_opacity = load_splat_ply(tmp_path / "scan01" / "export" / "splat.ply")
    assert loaded.shape == positions.shape and loaded_opacity is not None

    created = client.post("/api/room-structure/jobs", json={"reconstructionJobId": "scan01"})
    assert created.status_code == 202
    assert created.json()["status"] in ("queued", "running", "completed")

    body = _poll(client, created.json()["jobId"])
    assert body["status"] == "completed", body.get("error")
    result = body["result"]
    assert len(result["scanToScene"]) == 16
    assert len(result["interpretation"]["walls"]) == 4
    RoomInterpretation.model_validate(result["interpretation"])


def test_job_endpoint_reports_failures_and_bad_input(client, tmp_path):
    _write_splat(tmp_path / "tiny" / "export" / "splat.ply", np.zeros((10, 3)), np.zeros(10))
    created = client.post("/api/room-structure/jobs", json={"reconstructionJobId": "tiny"})
    assert created.status_code == 202
    body = _poll(client, created.json()["jobId"])
    assert body["status"] == "failed" and "Too few" in body["error"]

    assert client.post("/api/room-structure/jobs", json={"reconstructionJobId": "missing"}).status_code == 404
    assert client.post("/api/room-structure/jobs", json={"reconstructionJobId": "..\\x"}).status_code == 400
    bad_hint = {"reconstructionJobId": "tiny", "upHint": [0, 0, 0]}
    assert client.post("/api/room-structure/jobs", json=bad_hint).status_code == 400
    assert client.get("/api/room-structure/jobs/nope").status_code == 404


@pytest.fixture
def project(client, tmp_path):
    """A project with the synthetic rectangle room stored as a .ply asset, plus a non-PLY asset."""
    app.dependency_overrides[get_project_repository] = lambda: FilesystemProjectRepository(tmp_path / "projects")
    project_id = client.post("/api/projects", json={"name": "Import"}).json()["manifest"]["id"]
    ply = tmp_path / "room.ply"
    write_gaussian_ply(ply, ROOMS[0])
    with ply.open("rb") as handle:
        scan = client.post(f"/api/projects/{project_id}/assets", files={"file": ("room.ply", handle)}).json()
    glb = client.post(f"/api/projects/{project_id}/assets", files={"file": ("chair.glb", b"glTF")}).json()
    return project_id, scan["filename"], glb["filename"]


def _poll_conversion(client, job_id, timeout=60.0):
    deadline = time.time() + timeout
    seen = set()
    while time.time() < deadline:
        body = client.get(f"/api/room-structure/conversions/{job_id}").json()
        seen.add(body["stage"])
        if body["status"] in ("completed", "failed"):
            return body, seen
        time.sleep(0.05)
    raise AssertionError("conversion job did not finish")


def test_structure_job_reads_a_project_asset(client, project):
    project_id, scan_id, _ = project
    created = client.post("/api/room-structure/jobs", json={"projectId": project_id, "assetId": scan_id})
    assert created.status_code == 202, created.text
    body = _poll(client, created.json()["jobId"])
    assert body["status"] == "completed", body.get("error")
    assert len(body["result"]["interpretation"]["walls"]) == 4
    # The bare content hash resolves to the stored file too.
    bare = client.post("/api/room-structure/jobs", json={"projectId": project_id, "assetId": scan_id.split(".")[0]})
    assert bare.status_code == 202


def test_project_asset_input_is_validated_and_path_confined(client, project):
    project_id, scan_id, glb_id = project
    post = lambda **body: client.post("/api/room-structure/jobs", json=body).status_code  # noqa: E731
    assert post(projectId=project_id) == 400  # assetId missing
    assert post(reconstructionJobId="scan01", projectId=project_id, assetId=scan_id) == 400  # two sources
    assert post() == 400
    assert post(projectId=project_id, assetId="../../project.json") == 400
    assert post(projectId=project_id, assetId="..\\..\\project.json") == 400
    assert post(projectId=project_id, assetId="0" * 64 + ".ply") == 404
    assert post(projectId=project_id, assetId=glb_id) == 400  # not a PLY
    assert post(projectId="../etc", assetId=scan_id) == 400
    assert post(projectId="missing-project", assetId=scan_id) == 404
    assert post(projectId=project_id, assetId=scan_id, upHint=[0, 0, 0]) == 400


def test_conversion_job_reports_stages(client, project):
    project_id, scan_id, glb_id = project
    created = client.post("/api/room-structure/conversions", json={"projectId": project_id, "scanAssetId": scan_id})
    assert created.status_code == 202, created.text
    first = created.json()
    assert first["stages"][0] == {"name": "uploaded", "status": "completed", "detail": first["stages"][0]["detail"]}
    assert [s["name"] for s in first["stages"]] == ["uploaded", "structure", "objects", "ready"]

    body, seen = _poll_conversion(client, first["jobId"])
    assert body["status"] == "completed", body.get("error")
    assert body["stage"] == "ready" and seen <= {"structure", "ready"}
    states = {s["name"]: s["status"] for s in body["stages"]}
    assert states == {"uploaded": "completed", "structure": "completed", "objects": "pending", "ready": "completed"}
    assert body["scanAssetId"] == scan_id and body["pointsAssetId"] == scan_id
    assert len(body["result"]["interpretation"]["walls"]) == 4
    ConversionJobStatus.model_validate(body)

    # A non-PLY scan (e.g. .sog/.spz) needs decoded points; a GLB stands in for one here.
    no_points = {"projectId": project_id, "scanAssetId": glb_id}
    assert client.post("/api/room-structure/conversions", json=no_points).status_code == 400
    with_points = {**no_points, "pointsAssetId": scan_id}
    assert client.post("/api/room-structure/conversions", json=with_points).status_code == 202
    escape = {"projectId": project_id, "scanAssetId": "../project.json"}
    assert client.post("/api/room-structure/conversions", json=escape).status_code == 400
    assert client.get("/api/room-structure/conversions/nope").status_code == 404


def test_conversion_job_surfaces_structure_failure(client, project, tmp_path):
    project_id, _, _ = project
    _write_splat(tmp_path / "tiny.ply", np.zeros((10, 3)), np.zeros(10))
    with (tmp_path / "tiny.ply").open("rb") as handle:
        tiny = client.post(f"/api/projects/{project_id}/assets", files={"file": ("tiny.ply", handle)}).json()
    created = client.post(
        "/api/room-structure/conversions", json={"projectId": project_id, "scanAssetId": tiny["filename"]}
    )
    body, _ = _poll_conversion(client, created.json()["jobId"])
    assert body["status"] == "failed" and "Too few" in body["error"]
    assert {s["name"]: s["status"] for s in body["stages"]}["structure"] == "failed"
    assert body["stage"] == "structure"
