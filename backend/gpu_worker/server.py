"""GPU worker job API (runs on Colab / any CUDA box, exposed through a tunnel).

  POST /jobs                       multipart: splat=<.ply>, interpretation=<RoomInterpretation JSON>,
                                   scanToScene=<16 floats JSON, optional> -> {"jobId"}
  GET  /jobs/{id}                  -> {"status", "progress", "step", "error", "result"}
  GET  /jobs/{id}/files/{name}     -> artefact (GLB, PNG, .idx.u32, result.json)
Every request needs `Authorization: Bearer $GPU_WORKER_TOKEN`. Jobs run one at a time (one GPU).
"""

from __future__ import annotations

import hmac
import json
import re
import threading
import traceback
import uuid
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

from gpu_worker.pipeline import run_pipeline
from gpu_worker.render import Renderer, get_renderer
from gpu_worker.splat import Splat, load_ply, transform
from services.object_detection.detectors import Detector2D, get_detector

_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")


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
    gpu = threading.Lock()
    app = FastAPI(title="SpaceGen GPU worker")

    def auth(authorization: str = Header(default="")):
        if not hmac.compare_digest(authorization.encode(), f"Bearer {token}".encode()):
            raise HTTPException(status_code=401, detail="bad token")

    def run(job_id: str, ply: Path, interpretation: dict, scan_to_scene):
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
                    ply.parent / "out",
                    progress=progress,
                    **(pipeline_kwargs or {}),
                )
                job["status"] = "completed"
        except Exception as error:  # report every failure to the dispatcher instead of dying silently
            job.update(status="failed", error=f"{type(error).__name__}: {error}", log=traceback.format_exc())

    @app.post("/jobs", dependencies=[Depends(auth)])
    async def submit(splat: UploadFile = File(...), interpretation: str = Form(...), scanToScene: str = Form("")):
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
        job_dir = work_root / job_id
        job_dir.mkdir(parents=True)
        ply = job_dir / "scene.ply"
        with open(ply, "wb") as f:
            while chunk := await splat.read(1 << 20):
                f.write(chunk)
        jobs[job_id] = {"status": "queued", "progress": 0, "step": "", "error": None, "result": None}
        threading.Thread(target=run, args=(job_id, ply, interp, matrix), daemon=True).start()
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
