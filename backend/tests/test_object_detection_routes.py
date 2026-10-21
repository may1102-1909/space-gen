import time

import pytest
from fastapi.testclient import TestClient

from main import app
from services.object_detection.synthetic import write_scan_folder

client = TestClient(app)


@pytest.fixture
def scan_root(tmp_path, monkeypatch):
    monkeypatch.setattr("routes.object_detection.settings.reconstruction_dir", tmp_path)
    write_scan_folder(tmp_path / "scan1")
    return tmp_path


def _wait(job_id: str, timeout: float = 25.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/object-detection/jobs/{job_id}").json()
        if job["status"] in ("completed", "failed"):
            return job
        time.sleep(0.1)
    raise AssertionError("detection job did not finish")


def test_job_lifecycle(scan_root):
    res = client.post("/api/object-detection/jobs", json={"scanId": "scan1", "detector": "fixture"})
    assert res.status_code == 202
    job = _wait(res.json()["jobId"])
    assert job["status"] == "completed", job["error"]
    assert job["progress"] == 1.0
    result = job["result"]
    assert {d["label"] for d in result["detections"]} == {"sofa", "table", "chair"}
    assert len(result["maskRegions"]) == len(result["detections"])


def test_failed_job_reports_error(scan_root):
    (scan_root / "empty").mkdir()
    res = client.post("/api/object-detection/jobs", json={"scanId": "empty", "detector": "fixture"})
    job = _wait(res.json()["jobId"])
    assert job["status"] == "failed" and job["error"]


def test_unknown_job_and_scan(scan_root):
    assert client.get("/api/object-detection/jobs/nope").status_code == 404
    assert client.post("/api/object-detection/jobs", json={"scanId": "missing"}).status_code == 404


@pytest.mark.parametrize("scan_id", ["..", "../x", "a/b", "a\\b", "..secret"])
def test_scan_id_traversal_rejected(scan_root, scan_id):
    res = client.post("/api/object-detection/jobs", json={"scanId": scan_id})
    assert res.status_code == 400


@pytest.mark.parametrize("subpath", ["../scan1", "a/../../etc", "/etc/passwd"])
def test_subpath_traversal_rejected(scan_root, subpath):
    res = client.post("/api/object-detection/jobs", json={"scanId": "scan1", "subpath": subpath})
    assert res.status_code == 400


def test_job_id_traversal_rejected():
    assert client.get("/api/object-detection/jobs/..secret").status_code == 400
