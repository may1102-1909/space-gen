"""Dispatcher side of the worker protocol (used by the local FastAPI backend). `client` is an httpx.Client
with base_url = worker tunnel URL and the bearer header set."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

import httpx


def submit_job(client: httpx.Client, splat_path: Path, interpretation: dict, scan_to_scene=None) -> str:
    with open(splat_path, "rb") as f:
        data = {"interpretation": json.dumps(interpretation)}
        if scan_to_scene is not None:
            data["scanToScene"] = json.dumps([float(x) for x in scan_to_scene])
        r = client.post("/jobs", files={"splat": ("scene.ply", f, "application/octet-stream")}, data=data)
    r.raise_for_status()
    return r.json()["jobId"]


def wait_job(client: httpx.Client, job_id: str, timeout: float = 3600, poll: float = 2.0) -> dict:
    deadline = time.monotonic() + timeout
    while True:
        r = client.get(f"/jobs/{job_id}")
        r.raise_for_status()
        status = r.json()
        if status["status"] in ("completed", "failed") or time.monotonic() > deadline:
            return status
        time.sleep(poll)


def download_artifacts(client: httpx.Client, job_id: str, result: dict, dest: Path) -> list:
    """Fetch every file the result references (GLBs, index files, textures); returns local paths."""
    names = [o[k] for o in result["objects"] for k in ("mesh", "gaussianIndices")]
    names += [s["texture"] for s in result["surfaces"]] + ["result.json"]
    dest.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in names:
        r = client.get(f"/jobs/{job_id}/files/{name}")
        r.raise_for_status()
        (dest / name).write_bytes(r.content)
        paths.append(dest / name)
    return paths


def make_client(base_url: str, token: str, timeout: Optional[float] = 600) -> httpx.Client:
    return httpx.Client(base_url=base_url, headers={"Authorization": f"Bearer {token}"}, timeout=timeout)
