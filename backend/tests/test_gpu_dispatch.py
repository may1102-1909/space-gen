"""GPU worker chunked uploads (worker side + client) and the conversion's objects stage (dispatch)."""

from __future__ import annotations

import hashlib
import json
import threading
import time

import httpx
import pytest
import trimesh
from fastapi.testclient import TestClient

from gpu_worker import client as worker
from gpu_worker.render import NumpyRenderer
from gpu_worker.server import create_app
from gpu_worker.synthetic import write_room_ply
from main import app
from models.contracts import ConversionJobStatus
from routes.projects import get_project_repository
from routes.room_structure import ConversionRegistry, get_conversions
from services.gpu_dispatch import ObjectsDispatcher, get_dispatcher
from services.project_repository import FilesystemProjectRepository
from services.room_structure.jobs import RoomStructureJobs, get_jobs

AUTH = {"Authorization": "Bearer s3cret"}


# --- worker side: chunked, resumable upload ------------------------------------------------------


@pytest.fixture
def worker_app(tmp_path):
    return create_app("s3cret", tmp_path / "worker", renderer_factory=NumpyRenderer)


def _start(client, data: bytes, chunk: int):
    body = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "chunkSize": chunk}
    return client.post("/uploads", json=body)


def _put(client, upload_id, n, data):
    return client.put(
        f"/uploads/{upload_id}/chunks/{n}", content=data, headers={"X-Chunk-Sha256": hashlib.sha256(data).hexdigest()}
    )


def test_upload_needs_the_token(worker_app):
    with TestClient(worker_app) as anon:
        assert anon.post("/uploads", json={"size": 1, "sha256": "0" * 64, "chunkSize": 1}).status_code == 401
        assert anon.put("/uploads/x/chunks/0", content=b"x", headers={"X-Chunk-Sha256": "0" * 64}).status_code == 401
        assert anon.post("/uploads/x/complete").status_code == 401
        assert anon.get("/health", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_chunks_assemble_in_order_and_resume(worker_app, tmp_path):
    data = bytes(range(256)) * 41  # 10,496 bytes -> 3 chunks of 4096
    with TestClient(worker_app, headers=AUTH) as client:
        up = _start(client, data, 4096).json()
        assert up["chunks"] == 3 and up["received"] == [] and not up["complete"]
        uid = up["uploadId"]
        assert _put(client, uid, 2, data[8192:]).status_code == 200  # out of order
        assert _put(client, uid, 0, data[:4096]).status_code == 200
        missing = client.post(f"/uploads/{uid}/complete")
        assert missing.status_code == 409 and missing.json()["detail"]["missing"] == [1]
        # Asking again for the same file resumes the same upload.
        again = _start(client, data, 4096).json()
        assert again["uploadId"] == uid and again["received"] == [0, 2]
        assert _put(client, uid, 1, data[4096:8192]).status_code == 200
        done = client.post(f"/uploads/{uid}/complete").json()
        assert done["complete"]
        assert (tmp_path / "worker" / "uploads" / uid / "scene.ply").read_bytes() == data
        assert _start(client, data, 4096).json()["complete"]  # a finished upload is not re-sent


def test_chunk_hash_size_and_index_are_checked(worker_app, tmp_path):
    data = b"a" * 5000
    with TestClient(worker_app, headers=AUTH) as client:
        uid = _start(client, data, 4096).json()["uploadId"]
        bad = client.put(f"/uploads/{uid}/chunks/0", content=data[:4096], headers={"X-Chunk-Sha256": "0" * 64})
        assert bad.status_code == 422 and "sha256" in bad.json()["detail"]
        assert _put(client, uid, 0, data[:100]).status_code == 422  # short chunk
        assert _put(client, uid, 1, data[:4096]).status_code == 413  # last chunk is only 904 bytes
        assert _put(client, uid, 7, data[:10]).status_code == 404
        assert client.get(f"/uploads/{uid}").json()["received"] == []
        assert not list((tmp_path / "worker" / "uploads" / uid).iterdir())  # rejected chunks leave nothing


def test_whole_file_hash_mismatch_is_rejected(worker_app, tmp_path):
    data = b"b" * 3000
    with TestClient(worker_app, headers=AUTH) as client:
        uid = _start(client, data, 2048).json()["uploadId"]
        assert _put(client, uid, 0, data[:2048]).status_code == 200
        assert _put(client, uid, 1, data[2048:]).status_code == 200
        (tmp_path / "worker" / "uploads" / uid / "0.part").write_bytes(b"c" * 2048)  # corrupted at rest
        r = client.post(f"/uploads/{uid}/complete")
        assert r.status_code == 422 and "mismatch" in r.json()["detail"]
        assert client.get(f"/uploads/{uid}").json()["received"] == []
        assert client.post("/jobs", data={"uploadId": uid, "interpretation": "{}"}).status_code == 409


def test_client_uploads_in_chunks_with_progress_and_resumes(worker_app, tmp_path):
    path = tmp_path / "scan.ply"
    path.write_bytes(bytes(range(256)) * 100)
    seen = []
    with TestClient(worker_app, headers=AUTH) as client:
        uid = worker.upload_file(client, path, chunk_size=7000, progress=lambda s, t: seen.append((s, t)))
        assert seen[-1] == (25600, 25600) and len(seen) == 5  # initial report + 4 chunks
        assert (tmp_path / "worker" / "uploads" / uid / "scene.ply").read_bytes() == path.read_bytes()
        assert worker.upload_file(client, path, chunk_size=7000) == uid


# --- dispatch: conversion objects stage -------------------------------------------------------------


def _glb() -> bytes:
    return trimesh.creation.box((0.5, 0.5, 0.5)).export(file_type="glb")


def stub_worker(result: dict, files: dict, job_status: str = "completed") -> httpx.Client:
    """A scripted worker over httpx.MockTransport (speaks the protocol, no pipeline)."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/health":
            return httpx.Response(200, json={"ok": True})
        if path == "/uploads":
            return httpx.Response(200, json={"uploadId": "u1", "chunks": 1, "received": [], "complete": False})
        if path.startswith("/uploads/"):
            return httpx.Response(200, json={"complete": True})
        if path == "/jobs":
            return httpx.Response(200, json={"jobId": "j1"})
        if path == "/jobs/j1":
            return httpx.Response(
                200, json={"status": job_status, "progress": 100, "step": "", "error": "boom", "result": result}
            )
        name = path.rsplit("/", 1)[-1]
        return httpx.Response(200, content=files[name]) if name in files else httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://worker")


ONE_OBJECT = {
    "objects": [
        {
            "id": "obj_0",
            "label": "chair",
            "confidence": 0.9,
            "obb": {"center": [1.0, 0.4, 2.0], "size": [0.5, 0.8, 0.5], "yaw": 0.3},
            "mesh": "obj_0.glb",
            "dimensions": {"width": 0.5, "height": 0.8, "depth": 0.5},
            "placement": {"position": [1.0, 0.0, 2.0], "rotationY": 0.3},
        }
    ],
    "surfaces": [{"target": "slab", "texture": "floor.png", "repeat": [0.1, 0.1], "coverage": 0.9}],
}


@pytest.fixture
def api(tmp_path):
    repository = FilesystemProjectRepository(tmp_path / "projects")
    holder = {"dispatcher": ObjectsDispatcher("fake", work_root=tmp_path / "gpu", poll=0.05)}
    app.dependency_overrides[get_project_repository] = lambda: repository
    jobs = RoomStructureJobs()
    registry = ConversionRegistry()
    app.dependency_overrides[get_jobs] = lambda: jobs
    app.dependency_overrides[get_conversions] = lambda: registry
    app.dependency_overrides[get_dispatcher] = lambda: holder["dispatcher"]
    with TestClient(app) as client:
        project_id = client.post("/api/projects", json={"name": "Objects"}).json()["manifest"]["id"]
        ply = tmp_path / "room.ply"
        write_room_ply(ply)
        with ply.open("rb") as handle:
            scan = client.post(f"/api/projects/{project_id}/assets", files={"file": ("room.ply", handle)}).json()
        yield client, holder, project_id, scan["filename"], repository
    app.dependency_overrides.clear()


def _convert(client, project_id, scan_id):
    r = client.post("/api/room-structure/conversions", json={"projectId": project_id, "scanAssetId": scan_id})
    assert r.status_code == 202, r.text
    return r.json()["jobId"]


def _poll(client, job_id, timeout=300.0):
    deadline, details = time.time() + timeout, []
    while time.time() < deadline:
        body = client.get(f"/api/room-structure/conversions/{job_id}").json()
        objects = next(s for s in body["stages"] if s["name"] == "objects")
        if objects["detail"] and (not details or details[-1] != objects["detail"]):
            details.append(objects["detail"])
        if body["status"] in ("completed", "failed"):
            return body, details
        time.sleep(0.05)
    raise AssertionError("conversion did not finish")


def test_fake_mode_separates_objects_and_stores_meshes(api, tmp_path):
    client, holder, project_id, scan_id, _ = api
    job_id = _convert(client, project_id, scan_id)
    body, _ = _poll(client, job_id)
    assert body["status"] == "completed", body
    ConversionJobStatus.model_validate(body)
    assert body["stage"] == "ready" and body["objectsCount"] == 3
    # Polling can miss short-lived stages on a fast runner; the dispatcher records every detail it showed.
    history = holder["dispatcher"].get(job_id).history
    assert any(d.startswith("Uploading") for d in history) and any(
        d.startswith("Segmenting on GPU") for d in history
    ), history
    assert body["stages"][2] == {
        "name": "objects",
        "status": "completed",
        "detail": "3 objects separated",
        "error": None,
    }
    labels = sorted(o["label"] for o in body["objects"])
    assert labels == ["lamp", "sofa", "table"]
    sofa = next(o for o in body["objects"] if o["label"] == "sofa")
    dims = sofa["meshAsset"]["dimensions"]
    assert abs(dims["width"] - 2.0) < 0.1 and abs(dims["depth"] - 0.85) < 0.1  # synthetic sofa is 2.0 x 0.9 x 0.85 m
    for obj in body["objects"]:
        assert obj["maskRegionId"] == f"mask_{obj['id']}" and obj["meshAsset"]["source"] == "segmented"
        url = obj["meshAsset"]["url"]
        assert url.startswith(f"/api/projects/{project_id}/assets/") and url.endswith(".glb")
        glb = client.get(url)
        assert glb.status_code == 200 and glb.headers["content-type"] == "model/gltf-binary"
        assert trimesh.load(trimesh.util.wrap_as_stream(glb.content), file_type="glb", force="mesh").vertices.size
    assert {s["target"] for s in body["surfaces"]} == {"slab", "wall"}
    assert client.get(body["surfaces"][0]["textureAsset"]).headers["content-type"] == "image/png"
    saved = json.loads((tmp_path / "projects" / project_id / "objects" / f"{job_id}.json").read_text())
    assert len(saved["objects"]) == 3


def test_offline_worker_fails_clearly_then_retry_succeeds(api):
    client, holder, project_id, scan_id, _ = api
    holder["dispatcher"] = ObjectsDispatcher("colab", url="http://127.0.0.1:9", token="t", poll=0.05)
    job_id = _convert(client, project_id, scan_id)
    body, _ = _poll(client, job_id, timeout=120)
    assert body["status"] == "failed" and body["stage"] == "objects"
    assert "Cannot reach the GPU worker at http://127.0.0.1:9" in body["error"]
    assert body["result"]["interpretation"]["walls"], "the room structure survives an objects failure"
    assert {s["name"]: s["status"] for s in body["stages"]}["objects"] == "failed"

    files = {"obj_0.glb": _glb(), "floor.png": b"\x89PNG fake"}
    holder["dispatcher"]._client_factory = lambda: stub_worker(ONE_OBJECT, files)
    retried = client.post(f"/api/room-structure/conversions/{job_id}/objects/retry")
    assert retried.status_code == 202, retried.text
    body, _ = _poll(client, job_id)
    assert body["status"] == "completed" and body["objectsCount"] == 1
    assert body["objects"][0]["placement"] == {"position": [1.0, 0.0, 2.0], "rotationY": 0.3}
    assert client.post(f"/api/room-structure/conversions/{job_id}/objects/retry").status_code == 409


def test_missing_colab_settings_and_bad_token_are_explained(api):
    client, holder, project_id, scan_id, _ = api
    holder["dispatcher"] = ObjectsDispatcher("colab", url="", token="")
    body, _ = _poll(client, _convert(client, project_id, scan_id), timeout=120)
    assert body["status"] == "failed" and "GPU_WORKER_URL" in body["error"]

    def rejecting():
        return httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(401)), base_url="http://w")

    holder["dispatcher"] = ObjectsDispatcher("colab", url="http://w", token="x", client_factory=rejecting)
    body, _ = _poll(client, _convert(client, project_id, scan_id), timeout=120)
    assert body["status"] == "failed" and "GPU_WORKER_TOKEN" in body["error"]


def test_stuck_worker_times_out(api, tmp_path):
    client, holder, project_id, scan_id, _ = api
    release = threading.Event()

    def blocking_detector(splat):
        release.wait(30)
        raise RuntimeError("released")

    stuck = create_app("s3cret", tmp_path / "stuck", detector_factory=blocking_detector, renderer_factory=NumpyRenderer)
    holder["dispatcher"] = ObjectsDispatcher(
        "colab", url="http://w", token="s3cret", timeout=1.0, poll=0.05,
        client_factory=lambda: TestClient(stuck, headers=AUTH),
    )  # fmt: skip
    try:
        body, _ = _poll(client, _convert(client, project_id, scan_id), timeout=120)
    finally:
        release.set()
    assert body["status"] == "failed" and "did not finish within" in body["error"]


def test_worker_artefact_names_are_confined(api, tmp_path):
    client, holder, project_id, scan_id, _ = api
    evil = json.loads(json.dumps(ONE_OBJECT))
    evil["objects"][0]["mesh"] = "../../project.json.glb"
    holder["dispatcher"] = ObjectsDispatcher(
        "colab", url="http://w", token="x", client_factory=lambda: stub_worker(evil, {"x": b""})
    )
    body, _ = _poll(client, _convert(client, project_id, scan_id), timeout=120)
    assert body["status"] == "failed" and "invalid artefact name" in body["error"]
    assets = list((tmp_path / "projects" / project_id / "assets").iterdir())
    assert [p.suffix for p in assets] == [".ply"]  # nothing was written besides the scan
    with pytest.raises(ValueError):
        worker.fetch_file(stub_worker({}, {}), "j1", "../x.glb", tmp_path / "dl")


def test_worker_job_failure_is_reported(api):
    client, holder, project_id, scan_id, _ = api
    holder["dispatcher"] = ObjectsDispatcher(
        "colab", url="http://w", token="x", poll=0.05, client_factory=lambda: stub_worker({}, {}, job_status="failed")
    )
    body, _ = _poll(client, _convert(client, project_id, scan_id), timeout=120)
    assert body["status"] == "failed" and body["error"] == "The GPU worker failed: boom"


def test_off_mode_keeps_objects_pending(api):
    client, holder, project_id, scan_id, _ = api
    holder["dispatcher"] = ObjectsDispatcher("off")
    body, _ = _poll(client, _convert(client, project_id, scan_id), timeout=120)
    assert body["status"] == "completed" and body["objects"] == []
    objects = body["stages"][2]
    assert objects["status"] == "pending" and "GPU_WORKER_MODE" in objects["detail"]
