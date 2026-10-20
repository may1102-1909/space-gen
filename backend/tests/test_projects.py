from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from main import app
from routes.projects import get_project_repository
from services.project_repository import (
    FilesystemProjectRepository,
    ProjectRevisionConflictError,
)


@pytest.fixture
def client(tmp_path):
    app.dependency_overrides[get_project_repository] = lambda: FilesystemProjectRepository(tmp_path / "projects")
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_project_save_load_round_trip_and_revision_conflict(client):
    created = client.post("/api/projects", json={"name": "Living room"})
    assert created.status_code == 201
    payload = created.json()
    project_id = payload["manifest"]["id"]
    assert payload["revision"] == 1

    manifest = payload["manifest"]
    manifest["sceneSnapshot"] = {
        "nodes": {
            "item_test": {"id": "item_test", "type": "item", "position": [1.25, 0, -2.5], "rotation": [0, 0.5, 0]}
        },
        "rootNodeIds": ["item_test"],
        "collections": {},
        "materials": {},
        "installedPlugins": [],
    }
    updated = client.put(f"/api/projects/{project_id}", json=manifest, headers={"If-Match": '"1"'})
    assert updated.status_code == 200
    assert updated.json()["revision"] == 2
    loaded = client.get(f"/api/projects/{project_id}")
    assert loaded.status_code == 200
    assert loaded.json()["manifest"]["sceneSnapshot"]["nodes"]["item_test"]["position"] == [1.25, 0, -2.5]

    conflict = client.put(f"/api/projects/{project_id}", json=manifest, headers={"If-Match": '"1"'})
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["revision"] == 2


def test_create_project_from_manifest(client):
    manifest_data = {
        "schemaVersion": "1.0.0",
        "id": "custom-project-id",
        "name": "Custom Manifest Project",
        "scan": {
            "url": "/scans/room.ply",
            "format": "ply",
            "scanToScene": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            "scaleSource": "sensor",
            "bounds": {"min": [-5, 0, -5], "max": [5, 3, 5]},
        },
        "interpretation": {
            "provenance": "auto",
            "floor": {"normal": [0, 1, 0], "constant": 0, "provenance": "auto"},
            "ceilingHeight": 2.8,
            "outline": [[-5, -5], [5, -5], [5, 5], [-5, 5]],
            "walls": [],
            "openings": [],
            "detections": [],
        },
        "maskRegions": [],
        "sceneSnapshot": {
            "nodes": {"item_table": {"id": "item_table", "type": "item", "position": [0, 0, 0], "rotation": [0, 0, 0]}},
            "rootNodeIds": ["item_table"],
            "collections": {},
            "materials": {},
            "installedPlugins": [],
        },
        "assets": [],
        "history": [],
        "variants": [{"id": "default", "name": "Default", "sceneSnapshot": {}, "createdAt": "2026-01-01T00:00:00Z"}],
        "activeVariantId": "default",
    }
    created = client.post("/api/projects", json=manifest_data)
    assert created.status_code == 201
    payload = created.json()
    assert payload["manifest"]["id"] == "custom-project-id"
    assert payload["manifest"]["name"] == "Custom Manifest Project"
    assert payload["revision"] == 1

    # Conflict if creating again with same id
    dup = client.post("/api/projects", json=manifest_data)
    assert dup.status_code == 409


def test_asset_upload_is_content_hashed_and_readable(client):
    created = client.post("/api/projects", json={"name": "Upload"})
    project_id = created.json()["manifest"]["id"]
    uploaded = client.post(
        f"/api/projects/{project_id}/assets", files={"file": ("chair.glb", b"glb-bytes", "model/gltf-binary")}
    )
    assert uploaded.status_code == 201
    asset = uploaded.json()
    assert asset["filename"].endswith(".glb")
    assert client.get(asset["url"]).content == b"glb-bytes"
    # Access via asset_id without extension
    hash_only = asset["filename"].split(".")[0]
    assert client.get(f"/api/projects/{project_id}/assets/{hash_only}").content == b"glb-bytes"
    assert client.post(f"/api/projects/{project_id}/assets", files={"file": ("chair.exe", b"x")}).status_code == 415


def test_upload_limit_is_enforced_while_streaming(tmp_path):
    app.dependency_overrides[get_project_repository] = lambda: FilesystemProjectRepository(
        tmp_path / "projects", max_asset_bytes=4
    )
    try:
        with TestClient(app) as test_client:
            project_id = test_client.post("/api/projects", json={"name": "Limited"}).json()["manifest"]["id"]
            response = test_client.post(f"/api/projects/{project_id}/assets", files={"file": ("scan.ply", b"12345")})
            assert response.status_code == 413
    finally:
        app.dependency_overrides.clear()


def test_invalid_project_ids_return_bad_request_for_delete_and_upload(client):
    assert client.delete("/api/projects/invalid%21").status_code == 400
    assert client.post("/api/projects/invalid%21/assets", files={"file": ("scan.ply", b"data")}).status_code == 400


def test_revision_update_serializes_across_repository_instances(client, tmp_path):
    created = client.post("/api/projects", json={"name": "Concurrent"}).json()
    manifest = created["manifest"]
    project_id = manifest["id"]
    barrier = Barrier(2)

    def update_once(name: str):
        repository = FilesystemProjectRepository(tmp_path / "projects")
        updated = {**manifest, "name": name}
        barrier.wait()
        try:
            return repository.update(project_id, type(repository.get(project_id).manifest).model_validate(updated), 1)
        except ProjectRevisionConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(update_once, ["Concurrent A", "Concurrent B"]))
    assert sum(result == "conflict" for result in results) == 1
    assert sum(not isinstance(result, str) for result in results) == 1
