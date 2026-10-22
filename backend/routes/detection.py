"""Background 3D object-detection jobs over a reconstruction job (COLMAP poses + splat)."""

from __future__ import annotations

import json
import threading
import uuid
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from models.contracts import Matrix4, RoomInterpretation
from routes.reconstruction import DATA_ROOT, _validate_path_component
from services.object_detection.detectors import get_detector
from services.object_detection.pipeline import IDENTITY, merge_into_interpretation, run_scan_detection

router = APIRouter(prefix="/api/detection", tags=["detection"])

DEFAULT_LABELS = ["sofa", "chair", "table", "bed", "cabinet", "shelf", "lamp", "tv", "plant", "rug"]

_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()


class DetectionJobRequest(BaseModel):
    reconstructionJobId: str
    labels: List[str] = Field(default_factory=lambda: list(DEFAULT_LABELS), min_length=1, max_length=50)
    detector: Literal["auto", "grounded_sam", "gemini"] = "auto"
    maxViews: int = Field(default=24, ge=2, le=200)
    scanToScene: Matrix4 = tuple(IDENTITY)
    colmapToScan: Matrix4 = tuple(IDENTITY)
    interpretation: Optional[RoomInterpretation] = None


def _set(job_id: str, **values: Any) -> None:
    with _lock:
        _jobs[job_id].update(values)


def _worker(job_id: str, req: DetectionJobRequest) -> None:
    job_dir = DATA_ROOT / req.reconstructionJobId
    try:
        _set(job_id, status="running", step="Loading detector", progress=5)
        detector = get_detector(req.detector)
        _set(job_id, step=f"Detecting objects ({detector.name})", progress=10)

        def progress(done: int, total: int) -> None:
            _set(job_id, progress=10 + int(80 * done / total), step=f"Detecting objects ({done}/{total} views)")

        out = run_scan_detection(
            job_dir,
            req.labels,
            detector,
            scan_to_scene=req.scanToScene,
            colmap_to_scan=req.colmapToScan,
            max_views=req.maxViews,
            progress=progress,
            id_prefix=f"det_{job_id}",
            walls=req.interpretation.walls if req.interpretation is not None else (),
        )
        result: Dict[str, Any] = {
            "detector": detector.name,
            "detections": [d.model_dump() for d in out["detections"]],
            "maskRegions": [m.model_dump() for m in out["maskRegions"]],
        }
        if req.interpretation is not None:
            merged = merge_into_interpretation(req.interpretation.model_dump(), out["detections"])
            result["interpretation"] = RoomInterpretation.model_validate(merged).model_dump()
        out_dir = job_dir / "detections"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{job_id}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        _set(job_id, status="completed", step="Detections ready", progress=100, result=result)
    except Exception as exc:
        _set(job_id, status="failed", step="Detection failed", error=str(exc))


@router.post("/jobs", status_code=202)
async def create_detection_job(req: DetectionJobRequest, background: BackgroundTasks):
    _validate_path_component(req.reconstructionJobId, "reconstructionJobId")
    if not (DATA_ROOT / req.reconstructionJobId).is_dir():
        raise HTTPException(404, "Reconstruction job not found")
    job_id = uuid.uuid4().hex[:12]
    with _lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "reconstructionJobId": req.reconstructionJobId,
            "status": "queued",
            "step": "Queued",
            "progress": 0,
        }
    background.add_task(_worker, job_id, req)
    return _jobs[job_id]


@router.get("/jobs/{job_id}")
async def get_detection_job(job_id: str):
    if not job_id.isalnum():
        raise HTTPException(400, "Invalid job_id")
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            return dict(job)
    for path in DATA_ROOT.glob(f"*/detections/{job_id}.json"):
        return {
            "job_id": job_id,
            "status": "completed",
            "progress": 100,
            "result": json.loads(path.read_text(encoding="utf-8")),
        }
    raise HTTPException(404, "Detection job not found")
