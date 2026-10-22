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
from models.contracts import ConversionJobStatus, ConversionStage, RoomStructureJobStatus
from routes.projects import Repository
from routes.reconstruction import _validate_path_component
from services.project_repository import ProjectNotFoundError, ProjectRepository
from services.room_structure import (
    RoomStructureParams,
    extract_room_structure,
    load_colmap_points,
    load_splat_ply,
)

router = APIRouter(prefix="/api/room-structure", tags=["room-structure"])
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="room-structure")


class RoomStructureJobRequest(BaseModel):
    """Input is either a reconstruction job folder or a PLY in a project's asset store."""

    reconstructionJobId: Optional[str] = None
    projectId: Optional[str] = None
    assetId: Optional[str] = None
    upHint: Optional[Tuple[float, float, float]] = None
    useColmapPoints: bool = True


class RoomStructureJobStore:
    """In-process job registry (results are recomputable from the scan, so not persisted)."""

    def __init__(self) -> None:
        self._jobs: Dict[str, RoomStructureJobStatus] = {}
        self._conversions: Dict[str, ConversionJobStatus] = {}
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

    def add_conversion(self, conversion: ConversionJobStatus) -> None:
        with self._lock:
            self._conversions[conversion.jobId] = conversion

    def get_conversion(self, job_id: str) -> Optional[ConversionJobStatus]:
        with self._lock:
            return self._conversions.get(job_id)


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


def _project_asset(repository: ProjectRepository, project_id: str, asset_id: str, field: str) -> Path:
    """Resolve a stored project asset; the repository validates the id and confines the path."""
    try:
        repository.get(project_id)
        path = repository.asset_path(project_id, asset_id)
    except ProjectNotFoundError as error:
        raise HTTPException(404, "Project not found.") from error
    except ValueError as error:  # includes InvalidProjectIdError
        raise HTTPException(400, f"Invalid {field}: {error}") from error
    if not path.is_file():
        raise HTTPException(404, f"Project asset not found: {asset_id}")
    return path


def _project_ply(repository: ProjectRepository, project_id: str, asset_id: str, field: str) -> Path:
    path = _project_asset(repository, project_id, asset_id, field)
    if path.suffix != ".ply":
        raise HTTPException(400, f"{field} must be a .ply splat/point file; decode .sog/.spz to points first.")
    return path


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


def _submit(
    store: RoomStructureJobStore, splat: Path, colmap: Optional[Path], up_hint: Optional[Tuple[float, float, float]]
) -> RoomStructureJobStatus:
    if up_hint is not None and sum(v * v for v in up_hint) < 1e-12:
        raise HTTPException(400, "upHint must be a non-zero vector")
    params = RoomStructureParams(up_hint=up_hint) if up_hint else RoomStructureParams()
    job = store.create()
    _executor.submit(_run_job, store, job.jobId, splat, colmap, params)
    return job


@router.post("/jobs", status_code=202, response_model=RoomStructureJobStatus)
def create_room_structure_job(
    request: RoomStructureJobRequest,
    repository: Repository,
    store: RoomStructureJobStore = Depends(get_job_store),
    root: Path = Depends(get_reconstruction_root),
) -> RoomStructureJobStatus:
    from_project = request.projectId is not None or request.assetId is not None
    if from_project == (request.reconstructionJobId is not None):
        raise HTTPException(400, "Provide either reconstructionJobId or projectId + assetId.")
    if from_project:
        if not (request.projectId and request.assetId):
            raise HTTPException(400, "projectId and assetId are both required.")
        splat = _project_ply(repository, request.projectId, request.assetId, "assetId")
        return _submit(store, splat, None, request.upHint)
    job_dir = root / _validate_path_component(request.reconstructionJobId, "reconstructionJobId")
    if not job_dir.is_dir():
        raise HTTPException(404, "Reconstruction job not found")
    if request.upHint is not None and sum(v * v for v in request.upHint) < 1e-12:
        raise HTTPException(400, "upHint must be a non-zero vector")
    splat, colmap = _find_inputs(job_dir)
    return _submit(store, splat, colmap if request.useColmapPoints else None, request.upHint)


@router.get("/jobs/{job_id}", response_model=RoomStructureJobStatus)
def get_room_structure_job(
    job_id: str, store: RoomStructureJobStore = Depends(get_job_store)
) -> RoomStructureJobStatus:
    job = store.get(_validate_path_component(job_id, "job_id"))
    if job is None:
        raise HTTPException(404, "Room structure job not found")
    return job


# ---------------------------------------------------------------------------
# Conversion jobs: uploaded scan -> structure -> objects (GPU worker, pending) -> ready
# ---------------------------------------------------------------------------

OBJECTS_PENDING = "Per-object segmentation waits for the GPU worker (not available yet)."
_STAGE_STATE = {"queued": "pending", "running": "running", "completed": "completed", "failed": "failed"}


class ConversionJobRequest(BaseModel):
    projectId: str
    scanAssetId: str
    # PLY the structure stage reads; defaults to the scan (a .ply). For .sog/.spz the client uploads decoded points.
    pointsAssetId: Optional[str] = None
    upHint: Optional[Tuple[float, float, float]] = None


def conversion_status(conversion: ConversionJobStatus, structure: RoomStructureJobStatus) -> ConversionJobStatus:
    """Combined status derived from the structure job, the only stage that runs today."""
    done = structure.status == "completed"
    stages = [
        ConversionStage(name="uploaded", status="completed", detail="Scan stored in the project asset store."),
        ConversionStage(name="structure", status=_STAGE_STATE[structure.status], detail=structure.step),
        # shortcut: objects never runs; wire the GPU segmentation worker here when it lands.
        ConversionStage(name="objects", status="pending", detail=OBJECTS_PENDING),
        ConversionStage(
            name="ready", status="completed" if done else "pending", detail="Room ready to review." if done else ""
        ),
    ]
    return conversion.model_copy(
        update={
            "status": "running" if structure.status == "queued" else structure.status,
            "stage": "ready" if done else "structure",
            "stages": stages,
            "progress": structure.progress,
            "error": structure.error,
            "result": structure.result,
        }
    )


@router.post("/conversions", status_code=202, response_model=ConversionJobStatus)
def create_conversion_job(
    request: ConversionJobRequest, repository: Repository, store: RoomStructureJobStore = Depends(get_job_store)
) -> ConversionJobStatus:
    scan = _project_asset(repository, request.projectId, request.scanAssetId, "scanAssetId")
    points = _project_ply(repository, request.projectId, request.pointsAssetId or request.scanAssetId, "pointsAssetId")
    structure = _submit(store, points, None, request.upHint)
    conversion = ConversionJobStatus(
        jobId=structure.jobId,
        projectId=request.projectId,
        scanAssetId=scan.name,
        pointsAssetId=points.name,
        status="running",
        stage="structure",
        stages=[],
    )
    store.add_conversion(conversion)
    return conversion_status(conversion, store.get(structure.jobId) or structure)


@router.get("/conversions/{job_id}", response_model=ConversionJobStatus)
def get_conversion_job(job_id: str, store: RoomStructureJobStore = Depends(get_job_store)) -> ConversionJobStatus:
    job_id = _validate_path_component(job_id, "job_id")
    conversion, structure = store.get_conversion(job_id), store.get(job_id)
    if conversion is None or structure is None:
        raise HTTPException(404, "Conversion job not found")
    return conversion_status(conversion, structure)
