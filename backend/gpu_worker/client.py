"""Dispatcher side of the worker protocol (used by the local FastAPI backend). `client` is an httpx.Client
with base_url = worker tunnel URL and the bearer header set."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Callable, Optional

import httpx

CHUNK_SIZE = 32 * 1024 * 1024
MAX_ARTEFACT_BYTES = 512 * 1024 * 1024
Progress = Callable[[int, int], None]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def _retryable(error: Exception) -> bool:
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code >= 500 or error.response.status_code in (408, 429)
    return isinstance(error, httpx.TransportError)


def upload_file(
    client: httpx.Client,
    path: Path,
    chunk_size: int = CHUNK_SIZE,
    progress: Optional[Progress] = None,
    retries: int = 4,
) -> str:
    """Chunked, resumable upload (each chunk and the whole file are sha256-checked); returns the upload id.

    Asking again for the same file resumes: the worker only wants the chunks it has not stored yet."""
    report = progress or (lambda sent, total: None)
    size = Path(path).stat().st_size
    r = client.post("/uploads", json={"size": size, "sha256": file_sha256(path), "chunkSize": chunk_size})
    r.raise_for_status()
    upload = r.json()
    upload_id = upload["uploadId"]
    if upload["complete"]:
        report(size, size)
        return upload_id
    received = set(upload["received"])
    sent = sum(min(chunk_size, size - n * chunk_size) for n in received)
    report(sent, size)
    with open(path, "rb") as f:
        for n in range(upload["chunks"]):
            if n in received:
                continue
            f.seek(n * chunk_size)
            data = f.read(min(chunk_size, size - n * chunk_size))
            headers = {"X-Chunk-Sha256": hashlib.sha256(data).hexdigest(), "Content-Type": "application/octet-stream"}
            for attempt in range(retries):
                try:
                    client.put(f"/uploads/{upload_id}/chunks/{n}", content=data, headers=headers).raise_for_status()
                    break
                except (httpx.TransportError, httpx.HTTPStatusError) as error:
                    if attempt == retries - 1 or not _retryable(error):
                        raise
                    time.sleep(2**attempt)
            sent += len(data)
            report(sent, size)
    client.post(f"/uploads/{upload_id}/complete").raise_for_status()
    return upload_id


def submit_job(
    client: httpx.Client,
    splat_path: Path,
    interpretation: dict,
    scan_to_scene=None,
    progress: Optional[Progress] = None,
) -> str:
    upload_id = upload_file(client, splat_path, progress=progress)
    data = {"uploadId": upload_id, "interpretation": json.dumps(interpretation)}
    if scan_to_scene is not None:
        data["scanToScene"] = json.dumps([float(x) for x in scan_to_scene])
    r = client.post("/jobs", data=data)
    r.raise_for_status()
    return r.json()["jobId"]


def wait_job(
    client: httpx.Client,
    job_id: str,
    timeout: float = 3600,
    poll: float = 2.0,
    max_poll: float = 15.0,
    on_status: Optional[Callable[[dict], None]] = None,
    max_errors: int = 5,
) -> dict:
    """Polls with backoff until the job completes or fails. Raises TimeoutError past `timeout` and re-raises
    the last network error after `max_errors` consecutive failed polls, so a dead worker never hangs us."""
    deadline = time.monotonic() + timeout
    delay, errors = poll, 0
    while True:
        try:
            r = client.get(f"/jobs/{job_id}")
            r.raise_for_status()
            status, errors = r.json(), 0
            if on_status:
                on_status(status)
            if status["status"] in ("completed", "failed"):
                return status
        except (httpx.TransportError, httpx.HTTPStatusError) as error:
            errors += 1
            if errors >= max_errors or not _retryable(error):
                raise
        if time.monotonic() > deadline:
            raise TimeoutError(f"GPU job did not finish within {timeout / 60:.0f} min")
        time.sleep(delay)
        delay = min(delay * 1.5, max_poll)


def fetch_file(client: httpx.Client, job_id: str, name: str, dest: Path, max_bytes: int = MAX_ARTEFACT_BYTES) -> Path:
    if Path(name).name != name or name in (".", ".."):
        raise ValueError(f"Invalid artefact name: {name!r}")
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / name
    size = 0
    with client.stream("GET", f"/jobs/{job_id}/files/{name}") as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for block in r.iter_bytes():
                size += len(block)
                if size > max_bytes:
                    raise ValueError(f"Artefact {name} exceeds {max_bytes} bytes")
                f.write(block)
    return path


def download_artifacts(client: httpx.Client, job_id: str, result: dict, dest: Path) -> list:
    """Fetch every file the result references (GLBs, index files, textures); returns local paths."""
    names = [o[k] for o in result["objects"] for k in ("mesh", "gaussianIndices")]
    names += [s["texture"] for s in result["surfaces"]] + ["result.json"]
    return [fetch_file(client, job_id, name, dest) for name in names]


def make_client(base_url: str, token: str, timeout: Optional[float] = 600) -> httpx.Client:
    return httpx.Client(base_url=base_url, headers={"Authorization": f"Bearer {token}"}, timeout=timeout)
