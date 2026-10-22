"""Room structure job lifecycle through the HTTP API."""

from __future__ import annotations

import io
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient
from plyfile import PlyData, PlyElement

from main import app
from routes.projects import get_project_repository
from services.project_repository import FilesystemProjectRepository
from services.room_structure.jobs import RoomStructureJobs, get_jobs

from .room_structure_synth import RECTANGLE, Opening, make_room


def _ply_bytes(positions: np.ndarray, opacity: np.ndarray) -> bytes:
    vertex = np.zeros(len(positions), dtype=[("x", "f4"), ("y", "f4"), ("z", "f4"), ("opacity", "f4")])
    vertex["x"], vertex["y"], vertex["z"] = positions.T
    clipped = np.clip(opacity, 1e-4, 1 - 1e-4)
    vertex["opacity"] = np.log(clipped / (1 - clipped))
    buffer = io.BytesIO()
    PlyData([PlyElement.describe(vertex, "vertex")]).write(buffer)
    return buffer.getvalue()


@pytest.fixture
def api(tmp_path):
    repository = FilesystemProjectRepository(tmp_path / "projects")
    jobs = RoomStructureJobs()
    app.dependency_overrides[get_project_repository] = lambda: repository
    app.dependency_overrides[get_jobs] = lambda: jobs
    with TestClient(app) as client:
        yield client, repository
    app.dependency_overrides.clear()


@pytest.fixture
def project(api):
    client, repository = api
    project_id = client.post("/api/projects", json={"name": "Room"}).json()["manifest"]["id"]
    return project_id


def _upload(client, project_id: str, name: str, data: bytes) -> str:
    response = client.post(f"/api/projects/{project_id}/assets", files={"file": (name, data)})
    assert response.status_code == 201, response.text
    return response.json()["filename"]


def _wait(client, job_id: str, timeout: float = 90.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/room-structure/jobs/{job_id}").json()
        if body["status"] in ("succeeded", "failed"):
            return body
        time.sleep(0.1)
    raise AssertionError("job did not finish")


@pytest.fixture(scope="module")
def scan_ply() -> bytes:
    scene = make_room(polygon=RECTANGLE, openings=[Opening(0, 1.65, 0.9, 0.0, 2.0)], seed=11, density=900.0)
    return _ply_bytes(scene.positions, scene.opacity)


def test_job_lifecycle_and_latest_result(api, project, scan_ply):
    client, repository = api
    assert client.get(f"/api/room-structure/projects/{project}/latest").status_code == 404

    asset = _upload(client, project, "scan.ply", scan_ply)
    response = client.post("/api/room-structure/jobs", json={"projectId": project, "scanAssetId": asset})
    assert response.status_code == 202
    job_id = response.json()["jobId"]

    first = client.get(f"/api/room-structure/jobs/{job_id}").json()
    assert first["status"] in ("queued", "running", "succeeded")

    done = _wait(client, job_id)
    assert done["status"] == "succeeded", done
    assert done["progress"] == 1.0
    result = done["result"]
    interpretation = result["interpretation"]
    assert len(interpretation["walls"]) == 4
    assert interpretation["ceilingHeight"] == pytest.approx(2.6, abs=0.05)
    assert [o["kind"] for o in interpretation["openings"]] == ["door"]
    assert len(result["scanToScene"]) == 16

    latest = client.get(f"/api/room-structure/projects/{project}/latest")
    assert latest.status_code == 200
    assert latest.json()["interpretation"] == interpretation
    assert (repository.root / project / "room_structure" / "latest.json").is_file()


def test_failed_job_reports_error(api, project):
    client, _ = api
    asset = _upload(client, project, "tiny.ply", _ply_bytes(np.zeros((10, 3)), np.ones(10)))
    job_id = client.post("/api/room-structure/jobs", json={"projectId": project, "scanAssetId": asset}).json()["jobId"]
    done = _wait(client, job_id)
    assert done["status"] == "failed"
    assert "Too few" in done["error"]
    assert client.get(f"/api/room-structure/projects/{project}/latest").status_code == 404


@pytest.mark.parametrize("suffix", [".sog", ".spz"])
def test_compressed_scans_are_415(api, project, suffix):
    client, _ = api
    asset = _upload(client, project, f"scan{suffix}", b"compressed")
    response = client.post("/api/room-structure/jobs", json={"projectId": project, "scanAssetId": asset})
    assert response.status_code == 415
    assert suffix in response.json()["detail"]


def test_unknown_project_asset_and_job(api, project):
    client, _ = api
    assert (
        client.post("/api/room-structure/jobs", json={"projectId": "nope", "scanAssetId": "a" * 64}).status_code == 404
    )
    assert (
        client.post(
            "/api/room-structure/jobs", json={"projectId": project, "scanAssetId": "a" * 64 + ".ply"}
        ).status_code
        == 404
    )
    assert client.get("/api/room-structure/jobs/deadbeef").status_code == 404


def test_path_traversal_is_rejected(api, project, scan_ply):
    client, _ = api
    asset = _upload(client, project, "scan.ply", scan_ply)
    post = client.post

    for bad_project in ["..", "../x", "a/../b", "a\\b"]:
        assert (
            post("/api/room-structure/jobs", json={"projectId": bad_project, "scanAssetId": asset}).status_code == 400
        )
    for bad_asset in ["../../etc/passwd", "..\\x.ply", "a/b.ply"]:
        assert (
            post("/api/room-structure/jobs", json={"projectId": project, "scanAssetId": bad_asset}).status_code == 400
        )
    for bad_colmap in ["../../etc/passwd", "/etc/passwd", "a/../../b.txt"]:
        res = post(
            "/api/room-structure/jobs",
            json={"projectId": project, "scanAssetId": asset, "colmapPointsPath": bad_colmap},
        )
        assert res.status_code == 400, bad_colmap
    assert client.get("/api/room-structure/jobs/..secret").status_code == 400
    assert client.get("/api/room-structure/projects/..secret/latest").status_code == 400
    assert client.get("/api/room-structure/projects/..%2f..%2fetc/latest").status_code in (400, 404)


def test_options_are_validated(api, project, scan_ply):
    client, _ = api
    asset = _upload(client, project, "scan.ply", scan_ply)
    res = client.post(
        "/api/room-structure/jobs", json={"projectId": project, "scanAssetId": asset, "options": {"scale": -1}}
    )
    assert res.status_code == 422


def test_colmap_points_path_is_accepted(api, project, scan_ply):
    client, repository = api
    asset = _upload(client, project, "scan.ply", scan_ply)
    colmap_dir = repository.root / project / "colmap"
    colmap_dir.mkdir()
    (colmap_dir / "points3D.txt").write_text(
        "# header\n" + "\n".join(f"{i} {i * 0.01} 0 0 255 255 255 0.1" for i in range(600))
    )
    response = client.post(
        "/api/room-structure/jobs",
        json={"projectId": project, "scanAssetId": asset, "colmapPointsPath": "colmap/points3D.txt"},
    )
    assert response.status_code == 202
    done = _wait(client, response.json()["jobId"])
    assert done["status"] == "succeeded", done
    missing = client.post(
        "/api/room-structure/jobs",
        json={"projectId": project, "scanAssetId": asset, "colmapPointsPath": "colmap/none.txt"},
    )
    assert missing.status_code == 404
