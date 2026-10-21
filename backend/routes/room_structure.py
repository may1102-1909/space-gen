"""Room-structure background jobs: splat (+ optional COLMAP points) -> RoomInterpretation."""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config import settings
from models.contracts import RoomStructureJobStatus
from routes.reconstruction import _validate_path_component
from services.room_structure import (
    RoomStructureParams,
    extract_room_structure,
    load_colmap_points,
    load_splat_ply,
)

router = APIRouter(prefix="/api/room-structure", tags=["room-structure"])
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="room-structure")


class RoomStructureJobRequest(BaseModel):
    reconstructionJobId: str
    upHint: Optional[Tuple[float, float, float]] = None
    useColmapPoints: bool = True


class RoomStructureJobStore:
    """In-process job registry (results are recomputable from the scan, so not persisted)."""

    def __init__(self) -> None:
        self._jobs: Dict[str, RoomStructureJobStatus] = {}
        self._lock = threading.Lock()

    def create(self) -> RoomStructureJobStatus:
        job = RoomStructureJobStatus(jobId=uuid.uuid4().hex[:12], status="queued", step="Queued")
        with self._lock:
            self._jobs[job.jobId] = job
        return job

    def update(self, job_id: str, **values) -> None:
        with self._lock:
            self._jobs[job_id] = self._jobs[job_id].model_copy(update=values)

    def get(self, job_id: str) -> Optional[RoomStructureJobStatus]:
        with self._lock:
            return self._jobs.get(job_id)


_store = RoomStructureJobStore()


def get_job_store() -> RoomStructureJobStore:
    return _store


def get_reconstruction_root() -> Path:
    return settings.reconstruction_root


def _find_inputs(job_dir: Path) -> Tuple[Path, Optional[Path]]:
    for candidate in (job_dir / "export" / "splat.ply", job_dir / "export" / "point_cloud.ply"):
        if candidate.exists():
            splat = candidate
            break
    else:
        plys = sorted((job_dir / "export").glob("*.ply")) if (job_dir / "export").exists() else []
        if not plys:
            raise HTTPException(
                400, "No .ply splat found for this reconstruction job (room structure needs PLY input)."
            )
        splat = plys[0]
    colmap = next(
        iter(sorted(job_dir.glob("**/sparse/0/points3D.bin")) + sorted(job_dir.glob("**/sparse/0/points3D.txt"))), None
    )
    return splat, colmap


def _run_job(
    store: RoomStructureJobStore, job_id: str, splat: Path, colmap: Optional[Path], params: RoomStructureParams
) -> None:
    try:
        store.update(job_id, status="running", progress=10, step="Loading splat")
        positions, opacity = load_splat_ply(splat)
        colmap_points = load_colmap_points(colmap) if colmap else None
        store.update(job_id, progress=30, step="Fitting floor, walls and openings")
        result = extract_room_structure(positions, opacity, colmap_points, params)
        store.update(job_id, status="completed", progress=100, step="Room structure ready", result=result)
    except Exception as exc:  # job boundary: report every failure through the status endpoint
        store.update(job_id, status="failed", step="Room structure failed", error=str(exc))


@router.post("/jobs", status_code=202, response_model=RoomStructureJobStatus)
def create_room_structure_job(
    request: RoomStructureJobRequest,
    store: RoomStructureJobStore = Depends(get_job_store),
    root: Path = Depends(get_reconstruction_root),
) -> RoomStructureJobStatus:
    job_dir = root / _validate_path_component(request.reconstructionJobId, "reconstructionJobId")
    if not job_dir.is_dir():
        raise HTTPException(404, "Reconstruction job not found")
    if request.upHint is not None and sum(v * v for v in request.upHint) < 1e-12:
        raise HTTPException(400, "upHint must be a non-zero vector")
    splat, colmap = _find_inputs(job_dir)
    params = RoomStructureParams(up_hint=request.upHint) if request.upHint else RoomStructureParams()
    job = store.create()
    _executor.submit(_run_job, store, job.jobId, splat, colmap if request.useColmapPoints else None, params)
    return job


@router.get("/jobs/{job_id}", response_model=RoomStructureJobStatus)
def get_room_structure_job(
    job_id: str, store: RoomStructureJobStore = Depends(get_job_store)
) -> RoomStructureJobStatus:
    job = store.get(_validate_path_component(job_id, "job_id"))
    if job is None:
        raise HTTPException(404, "Room structure job not found")
    return job
