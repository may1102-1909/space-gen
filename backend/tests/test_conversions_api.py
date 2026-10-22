"""Splat import conversion jobs (scan asset -> room structure -> ready) through the HTTP API."""

from __future__ import annotations

import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from main import app
from models.contracts import ConversionJobStatus
from routes.projects import get_project_repository
from routes.room_structure import ConversionRegistry, get_conversions
from services.project_repository import FilesystemProjectRepository
from services.room_structure.jobs import RoomStructureJobs, get_jobs

from .synthetic_rooms import ROOMS, write_gaussian_ply
from .test_room_structure_api import _ply_bytes


@pytest.fixture
def client(tmp_path):
    repository = FilesystemProjectRepository(tmp_path / "projects")
    jobs = RoomStructureJobs()
    registry = ConversionRegistry()
    app.dependency_overrides[get_project_repository] = lambda: repository
    app.dependency_overrides[get_jobs] = lambda: jobs
    app.dependency_overrides[get_conversions] = lambda: registry
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def project(client, tmp_path):
    """A project with the synthetic rectangle room stored as a .ply asset, plus a non-PLY asset."""
    project_id = client.post("/api/projects", json={"name": "Import"}).json()["manifest"]["id"]
    ply = tmp_path / "room.ply"
    write_gaussian_ply(ply, ROOMS[0])
    with ply.open("rb") as handle:
        scan = client.post(f"/api/projects/{project_id}/assets", files={"file": ("room.ply", handle)}).json()
    glb = client.post(f"/api/projects/{project_id}/assets", files={"file": ("chair.glb", b"glTF")}).json()
    return project_id, scan["filename"], glb["filename"]


def _poll_conversion(client, job_id, timeout=90.0):
    deadline = time.time() + timeout
    seen = set()
    while time.time() < deadline:
        body = client.get(f"/api/room-structure/conversions/{job_id}").json()
        seen.add(body["stage"])
        if body["status"] in ("completed", "failed"):
            return body, seen
        time.sleep(0.05)
    raise AssertionError("conversion job did not finish")


def test_conversion_job_reports_stages(client, project):
    project_id, scan_id, glb_id = project
    created = client.post("/api/room-structure/conversions", json={"projectId": project_id, "scanAssetId": scan_id})
    assert created.status_code == 202, created.text
    first = created.json()
    assert first["stages"][0]["name"] == "uploaded" and first["stages"][0]["status"] == "completed"
    assert [s["name"] for s in first["stages"]] == ["uploaded", "structure", "objects", "ready"]

    body, seen = _poll_conversion(client, first["jobId"])
    assert body["status"] == "completed", body.get("error")
    assert body["stage"] == "ready" and seen <= {"structure", "ready"}
    states = {s["name"]: s["status"] for s in body["stages"]}
    assert states == {"uploaded": "completed", "structure": "completed", "objects": "pending", "ready": "completed"}
    assert body["scanAssetId"] == scan_id and body["pointsAssetId"] == scan_id
    assert len(body["result"]["interpretation"]["walls"]) == 4
    assert len(body["result"]["scanToScene"]) == 16
    ConversionJobStatus.model_validate(body)

    # A non-PLY scan (e.g. .sog/.spz) needs decoded points; a GLB stands in for one here.
    no_points = {"projectId": project_id, "scanAssetId": glb_id}
    assert client.post("/api/room-structure/conversions", json=no_points).status_code == 400
    with_points = {**no_points, "pointsAssetId": scan_id}
    assert client.post("/api/room-structure/conversions", json=with_points).status_code == 202


def test_conversion_input_is_validated_and_path_confined(client, project):
    project_id, scan_id, _ = project
    post = lambda **body: client.post("/api/room-structure/conversions", json=body).status_code  # noqa: E731
    assert post(projectId=project_id, scanAssetId="../project.json") == 400
    assert post(projectId=project_id, scanAssetId="..\\..\\project.json") == 400
    assert post(projectId=project_id, scanAssetId=scan_id, pointsAssetId="../project.json") == 400
    assert post(projectId=project_id, scanAssetId="0" * 64 + ".ply") == 404
    assert post(projectId="../etc", scanAssetId=scan_id) == 400
    assert post(projectId="missing-project", scanAssetId=scan_id) == 404
    assert post(projectId=project_id, scanAssetId=scan_id, upHint=[0, 0, 0]) == 422
    assert client.get("/api/room-structure/conversions/nope").status_code == 404


def test_conversion_job_surfaces_structure_failure(client, project):
    project_id, _, _ = project
    tiny = client.post(
        f"/api/projects/{project_id}/assets", files={"file": ("tiny.ply", _ply_bytes(np.zeros((10, 3)), np.ones(10)))}
    ).json()
    created = client.post(
        "/api/room-structure/conversions", json={"projectId": project_id, "scanAssetId": tiny["filename"]}
    )
    body, _ = _poll_conversion(client, created.json()["jobId"])
    assert body["status"] == "failed" and "Too few" in body["error"]
    assert {s["name"]: s["status"] for s in body["stages"]}["structure"] == "failed"
    assert body["stage"] == "structure"
