"""GPU worker job API (runs on Colab / any CUDA box, exposed through a tunnel).

  GET  /health                       -> {"ok": true}
  POST /uploads                      json {size, sha256, chunkSize} -> {uploadId, chunks, received, complete}
                                     (same size + sha256 + chunkSize returns the existing upload: resume)
  PUT  /uploads/{id}/chunks/{n}      raw bytes, header X-Chunk-Sha256 -> {"received": n}
  GET  /uploads/{id}                 -> upload state (which chunks arrived)
  POST /uploads/{id}/complete        assembles the chunks and verifies the whole-file sha256
  POST /jobs                         form: uploadId, interpretation=<RoomInterpretation JSON>,
                                     scanToScene=<16 floats JSON, optional> -> {"jobId"}
  GET  /jobs/{id}                    -> {"status", "progress", "step", "error", "result"}
  GET  /jobs/{id}/files/{name}       -> artefact (GLB, PNG, .idx.u32, result.json)
Every request needs `Authorization: Bearer $GPU_WORKER_TOKEN`. Jobs run one at a time (one GPU).
Uploads are chunked because Cloudflare quick tunnels reject request bodies over ~100 MB.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import threading
import traceback
import uuid
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from fastapi import Depends, FastAPI, Form, Header, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from gpu_worker.pipeline import run_pipeline
from gpu_worker.render import Renderer, get_renderer
from gpu_worker.splat import Splat, load_ply, transform
from services.object_detection.detectors import Detector2D, get_detector

_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")
MAX_CHUNK = 64 * 1024 * 1024  # stays under the tunnel's ~100 MB request cap
MAX_UPLOAD = 16 * 1024**3


class UploadRequest(BaseModel):
    size: int = Field(gt=0, le=MAX_UPLOAD)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    chunkSize: int = Field(gt=0, le=MAX_CHUNK)


def create_app(
    token: str,
    work_root: Path,
    detector_factory: Callable[[Splat], Detector2D] = lambda splat: get_detector("auto"),
    renderer_factory: Callable[[], Renderer] = lambda: get_renderer("auto"),
    pipeline_kwargs: Optional[dict] = None,
) -> FastAPI:
    if not token:
        raise ValueError("GPU worker needs a non-empty token")
    work_root = Path(work_root)
    jobs: dict = {}
    uploads: dict = {}
    gpu = threading.Lock()
    upload_lock = threading.Lock()
    app = FastAPI(title="SpaceGen GPU worker")

    def auth(authorization: str = Header(default="")):
        if not hmac.compare_digest(authorization.encode(), f"Bearer {token}".encode()):
            raise HTTPException(status_code=401, detail="bad token")

    def run(job_id: str, ply: Path, out_dir: Path, interpretation: dict, scan_to_scene):
        job = jobs[job_id]

        def progress(p, step):
            job.update(progress=p, step=step)

        try:
            with gpu:
                job["status"] = "running"
                splat = load_ply(ply)
                if scan_to_scene is not None:
                    splat = transform(splat, np.asarray(scan_to_scene, float).reshape(4, 4))
                job["result"] = run_pipeline(
                    splat,
                    interpretation,
                    detector_factory(splat),
                    renderer_factory(),
                    out_dir,
                    progress=progress,
                    **(pipeline_kwargs or {}),
                )
                job["status"] = "completed"
        except Exception as error:  # report every failure to the dispatcher instead of dying silently
            job.update(status="failed", error=f"{type(error).__name__}: {error}", log=traceback.format_exc())

    def upload_view(upload_id: str) -> dict:
        up = uploads[upload_id]
        return {
            "uploadId": upload_id,
            "size": up["size"],
            "chunkSize": up["chunkSize"],
            "chunks": up["chunks"],
            "received": sorted(up["received"]),
            "complete": up["path"] is not None,
        }

    def get_upload(upload_id: str) -> dict:
        if upload_id not in uploads:
            raise HTTPException(status_code=404, detail="unknown upload")
        return uploads[upload_id]

    @app.get("/health", dependencies=[Depends(auth)])
    def health():
        return {"ok": True}

    @app.post("/uploads", dependencies=[Depends(auth)])
    def create_upload(request: UploadRequest):
        with upload_lock:
            for upload_id, up in uploads.items():
                if (up["size"], up["sha256"], up["chunkSize"]) == (request.size, request.sha256, request.chunkSize):
                    return upload_view(upload_id)
            upload_id = uuid.uuid4().hex
            directory = work_root / "uploads" / upload_id
            directory.mkdir(parents=True)
            uploads[upload_id] = {
                "size": request.size,
                "sha256": request.sha256,
                "chunkSize": request.chunkSize,
                "chunks": math.ceil(request.size / request.chunkSize),
                "received": set(),
                "dir": directory,
                "path": None,
            }
            return upload_view(upload_id)

    @app.get("/uploads/{upload_id}", dependencies=[Depends(auth)])
    def upload_state(upload_id: str):
        get_upload(upload_id)
        return upload_view(upload_id)

    @app.put("/uploads/{upload_id}/chunks/{index}", dependencies=[Depends(auth)])
    async def put_chunk(upload_id: str, index: int, request: Request, x_chunk_sha256: str = Header(...)):
        up = get_upload(upload_id)
        if up["path"] is not None:
            raise HTTPException(status_code=409, detail="upload already complete")
        if not 0 <= index < up["chunks"]:
            raise HTTPException(status_code=404, detail="chunk index out of range")
        expected = min(up["chunkSize"], up["size"] - index * up["chunkSize"])
        part = up["dir"] / f"{index}.part"
        temp = up["dir"] / f"{index}.{uuid.uuid4().hex}.tmp"
        digest, written = hashlib.sha256(), 0
        try:
            with open(temp, "wb") as f:
                async for block in request.stream():
                    written += len(block)
                    if written > expected:
                        raise HTTPException(status_code=413, detail=f"chunk {index} is larger than {expected} bytes")
                    digest.update(block)
                    f.write(block)
            if written != expected:
                raise HTTPException(status_code=422, detail=f"chunk {index} has {written} bytes, expected {expected}")
            if not hmac.compare_digest(digest.hexdigest(), x_chunk_sha256.strip().lower()):
                raise HTTPException(status_code=422, detail=f"chunk {index} sha256 mismatch")
            os.replace(temp, part)
        finally:
            if temp.exists():
                temp.unlink()
        up["received"].add(index)
        return {"received": index}

    @app.post("/uploads/{upload_id}/complete", dependencies=[Depends(auth)])
    def complete_upload(upload_id: str):
        up = get_upload(upload_id)
        if up["path"] is not None:
            return upload_view(upload_id)
        missing = [n for n in range(up["chunks"]) if n not in up["received"]]
        if missing:
            raise HTTPException(status_code=409, detail={"message": "chunks missing", "missing": missing})
        target = up["dir"] / "scene.ply"
        digest = hashlib.sha256()
        with open(target, "wb") as out:
            for n in range(up["chunks"]):
                with open(up["dir"] / f"{n}.part", "rb") as f:
                    while block := f.read(1 << 20):
                        digest.update(block)
                        out.write(block)
        if not hmac.compare_digest(digest.hexdigest(), up["sha256"]):
            target.unlink()
            up["received"].clear()  # a chunk was corrupted on disk; the client re-sends everything
            raise HTTPException(status_code=422, detail="assembled file sha256 mismatch; re-upload the chunks")
        for n in range(up["chunks"]):
            (up["dir"] / f"{n}.part").unlink()
        up["path"] = target
        return upload_view(upload_id)

    @app.post("/jobs", dependencies=[Depends(auth)])
    def submit(uploadId: str = Form(...), interpretation: str = Form(...), scanToScene: str = Form("")):
        up = get_upload(uploadId)
        if up["path"] is None:
            raise HTTPException(status_code=409, detail="upload is not complete")
        try:
            interp = json.loads(interpretation)
            matrix = json.loads(scanToScene) if scanToScene else None
            if matrix is not None and len(matrix) != 16:
                raise ValueError("scanToScene needs 16 numbers")
            if "outline" not in interp or "ceilingHeight" not in interp:
                raise ValueError("interpretation needs outline and ceilingHeight")
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        job_id = uuid.uuid4().hex
        out_dir = work_root / job_id / "out"
        out_dir.mkdir(parents=True)
        jobs[job_id] = {"status": "queued", "progress": 0, "step": "", "error": None, "result": None}
        threading.Thread(target=run, args=(job_id, up["path"], out_dir, interp, matrix), daemon=True).start()
        return {"jobId": job_id}

    @app.get("/jobs/{job_id}", dependencies=[Depends(auth)])
    def status(job_id: str):
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail="unknown job")
        return {k: v for k, v in jobs[job_id].items() if k != "log"}

    @app.get("/jobs/{job_id}/files/{name}", dependencies=[Depends(auth)])
    def file(job_id: str, name: str):
        path = work_root / job_id / "out" / name
        if job_id not in jobs or not _NAME.match(name) or not path.is_file():
            raise HTTPException(status_code=404, detail="no such artefact")
        return FileResponse(path)

    return app
