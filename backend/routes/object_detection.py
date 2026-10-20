"""Object detection jobs: detect furniture in a scan's keyframes and lift it to 3D oriented boxes.

Jobs run on a single worker thread with an in-memory store (separate from the reconstruction db),
so results are lost on restart; poll ``GET /api/object-detection/jobs/{id}``.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import settings
from routes.reconstruction import _safe_resolve_child, _validate_path_component
from services.object_detection.pipeline import PipelineConfig
from services.object_detection.runner import run_on_scan_folder

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/object-detection", tags=["object-detection"])

MAX_STORED_JOBS = 100
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="object-detection")
_jobs: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
_lock = threading.Lock()


class DetectionJobRequest(BaseModel):
    scanId: str = Field(description="Reconstruction job folder name that holds the scan folder")
    subpath: Optional[str] = Field(default=None, description="Optional relative folder inside the scan")
    detector: Literal["auto", "gemini", "owlv2", "fixture"] = "auto"
    labels: Optional[list[str]] = None


def _update(job_id: str, **fields: Any) -> None:
    with _lock:
        _jobs[job_id].update(fields, updatedAt=time.time())


def _run_job(job_id: str, scan_dir: Path, detector: str, labels: Optional[list[str]]) -> None:
    _update(job_id, status="running", message="Loading scan")

    def progress(fraction: float, message: str) -> None:
        _update(job_id, progress=round(fraction, 3), message=message)

    try:
        config = PipelineConfig(labels=tuple(labels)) if labels else None
        result = run_on_scan_folder(scan_dir, detector_name=detector, config=config, progress=progress)
        _update(job_id, status="completed", progress=1.0, message="Done", result=result.model_dump())
    except Exception as exc:  # surfaced to the client; full trace stays in the server log
        logger.exception("Object detection job %s failed", job_id)
        _update(job_id, status="failed", error=f"{type(exc).__name__}: {exc}", message="Failed")


@router.post("/jobs", status_code=202)
def create_job(request: DetectionJobRequest) -> dict[str, str]:
    scan_id = _validate_path_component(request.scanId, "scanId")
    scan_dir = settings.reconstruction_root / scan_id
    if request.subpath:
        scan_dir = _safe_resolve_child(scan_dir, request.subpath)
    if not scan_dir.is_dir():
        raise HTTPException(status_code=404, detail="Scan folder not found")

    job_id = uuid.uuid4().hex
    now = time.time()
    with _lock:
        _jobs[job_id] = {
            "jobId": job_id,
            "status": "queued",
            "progress": 0.0,
            "message": "Queued",
            "result": None,
            "error": None,
            "createdAt": now,
            "updatedAt": now,
        }
        while len(_jobs) > MAX_STORED_JOBS:
            _jobs.popitem(last=False)
    _executor.submit(_run_job, job_id, scan_dir, request.detector, request.labels)
    return {"jobId": job_id}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    _validate_path_component(job_id, "job_id")
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Detection job not found")
        return dict(job)
