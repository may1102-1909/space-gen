"""Room structure analysis as a background job.

Scan formats: `.ply` and `.splat` are decoded. `.sog` / `.spz` are compressed containers that the
analyzer does not decode, so they are rejected with 415 (supply a `.ply`/`.splat` export or a COLMAP
points file instead). `colmapPointsPath` is relative to the project directory.
"""

from __future__ import annotations

import json
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from models.contracts import ConversionJobStatus, ConversionStage, RoomStructureResult
from routes.projects import get_project_repository
from routes.reconstruction import _safe_resolve_child, _validate_path_component
from services.project_repository import (
    InvalidProjectIdError,
    ProjectNotFoundError,
    ProjectRepository,
)
from services.room_structure import RoomStructureOptions
from services.room_structure.jobs import LATEST_RELATIVE, JobSpec, RoomStructureJobs, get_jobs

router = APIRouter(prefix="/api/room-structure", tags=["room-structure"])

Repository = Annotated[ProjectRepository, Depends(get_project_repository)]
Jobs = Annotated[RoomStructureJobs, Depends(get_jobs)]

UNSUPPORTED_SUFFIXES = {".sog", ".spz"}
SUPPORTED_SUFFIXES = {".ply", ".splat"}


class AnalysisOptions(BaseModel):
    scale: float = Field(default=1.0, gt=0.0, le=1000.0)
    minOpacity: float = Field(default=0.35, ge=0.0, le=1.0)
    upHint: Optional[tuple[float, float, float]] = None
    seed: int = 7
    detectOpenings: bool = True

    def to_options(self) -> RoomStructureOptions:
        if self.upHint is not None and not any(self.upHint):
            raise HTTPException(status_code=422, detail="upHint must be a non-zero vector.")
        return RoomStructureOptions(
            scale=self.scale,
            min_opacity=self.minOpacity,
            up_hint=self.upHint,
            seed=self.seed,
            detect_openings=self.detectOpenings,
        )


class CreateJobRequest(BaseModel):
    projectId: str = Field(min_length=1, max_length=64)
    scanAssetId: str = Field(min_length=1, max_length=128)
    colmapPointsPath: Optional[str] = Field(default=None, max_length=512)
    options: AnalysisOptions = Field(default_factory=AnalysisOptions)


def _project_dir(repository: ProjectRepository, project_id: str) -> Path:
    _validate_path_component(project_id, "projectId")
    try:
        repository.get(project_id)
    except InvalidProjectIdError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail="Project not found.") from error
    return _safe_resolve_child(repository.root, project_id)  # type: ignore[attr-defined]


def _scan_asset(repository: ProjectRepository, project_id: str, asset_id: str, field: str) -> Path:
    """A stored project asset; the repository validates the id and confines the path to the project."""
    try:
        path = repository.asset_path(project_id, asset_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=f"Invalid {field}.") from error
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Scan asset not found.")
    return path


def _analysable_scan(repository: ProjectRepository, project_id: str, asset_id: str, field: str) -> Path:
    suffix = Path(asset_id).suffix.lower()
    if suffix in UNSUPPORTED_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"'{suffix}' scans are compressed and cannot be analysed; use a .ply or .splat scan.",
        )
    path = _scan_asset(repository, project_id, asset_id, field)
    if path.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Room structure analysis needs a .ply or .splat scan.")
    return path


@router.post("/jobs", status_code=202)
def create_job(request: CreateJobRequest, repository: Repository, jobs: Jobs):
    project_dir = _project_dir(repository, request.projectId)
    _validate_path_component(request.scanAssetId, "scanAssetId")
    scan_path = _analysable_scan(repository, request.projectId, request.scanAssetId, "scanAssetId")

    colmap_path = None
    if request.colmapPointsPath:
        colmap_path = _safe_resolve_child(project_dir, request.colmapPointsPath)
        if not colmap_path.is_file():
            raise HTTPException(status_code=404, detail="COLMAP points file not found.")

    spec = JobSpec(
        project_id=request.projectId,
        scan_asset_id=request.scanAssetId,
        scan_path=scan_path,
        project_dir=project_dir,
        colmap_path=colmap_path,
        options=request.options.to_options(),
    )
    return {"jobId": jobs.submit(spec)}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, jobs: Jobs):
    _validate_path_component(job_id, "job_id")
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@router.get("/projects/{project_id}/latest")
def get_latest(project_id: str, repository: Repository):
    project_dir = _project_dir(repository, project_id)
    latest = project_dir / LATEST_RELATIVE
    if not latest.is_file():
        raise HTTPException(status_code=404, detail="No room structure result for this project.")
    return json.loads(latest.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Conversion jobs: uploaded scan -> structure -> objects (GPU worker, pending) -> ready
# ---------------------------------------------------------------------------

OBJECTS_PENDING = "Per-object segmentation waits for the GPU worker (not available yet)."
MAX_CONVERSIONS = 100
_STAGE_STATE = {"queued": "pending", "running": "running", "succeeded": "completed", "failed": "failed"}
_STAGE_DETAIL = {
    "queued": "Queued",
    "filtering": "Filtering points",
    "loading": "Loading scan",
    "gravity": "Finding gravity",
    "floor": "Fitting floor and ceiling",
    "walls": "Fitting walls",
    "openings": "Detecting doors and windows",
    "done": "Room structure ready",
}


class ConversionJobRequest(BaseModel):
    projectId: str = Field(min_length=1, max_length=64)
    scanAssetId: str = Field(min_length=1, max_length=128)
    # Points the structure stage reads; defaults to the scan. For .sog/.spz the client uploads decoded points.
    pointsAssetId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    upHint: Optional[tuple[float, float, float]] = None


class ConversionRegistry:
    """Which structure job belongs to which import (the structure job itself holds the live state)."""

    def __init__(self) -> None:
        self._items: OrderedDict[str, tuple[str, str, str]] = OrderedDict()
        self._lock = threading.Lock()

    def add(self, job_id: str, project_id: str, scan_asset_id: str, points_asset_id: str) -> None:
        with self._lock:
            self._items[job_id] = (project_id, scan_asset_id, points_asset_id)
            while len(self._items) > MAX_CONVERSIONS:
                self._items.popitem(last=False)

    def get(self, job_id: str) -> tuple[str, str, str] | None:
        with self._lock:
            return self._items.get(job_id)


_conversions = ConversionRegistry()


def get_conversions() -> ConversionRegistry:
    return _conversions


Conversions = Annotated[ConversionRegistry, Depends(get_conversions)]


def _structure_result(payload: dict[str, Any]) -> RoomStructureResult:
    diagnostics = payload.get("diagnostics") or {}
    return RoomStructureResult(
        interpretation=payload["interpretation"],
        scanToScene=payload["scanToScene"],
        gravityConfidence=min(1.0, max(0.0, float(diagnostics.get("gravity", {}).get("confidence", 0.0)))),
        manhattan=bool(diagnostics.get("orientation", {}).get("manhattan", False)),
        diagnostics=diagnostics,
    )


def conversion_status(entry: tuple[str, str, str], job_id: str, structure: dict[str, Any]) -> ConversionJobStatus:
    """Combined status derived from the structure job, the only stage that runs today."""
    project_id, scan_asset_id, points_asset_id = entry
    state = structure["status"]
    done = state == "succeeded"
    detail = structure.get("error") or _STAGE_DETAIL.get(structure.get("stage", ""), "Analysing room structure")
    stages = [
        ConversionStage(name="uploaded", status="completed", detail="Scan stored in the project asset store."),
        ConversionStage(name="structure", status=_STAGE_STATE[state], detail=detail),
        # shortcut: objects never runs; wire the GPU segmentation worker here when it lands.
        ConversionStage(name="objects", status="pending", detail=OBJECTS_PENDING),
        ConversionStage(
            name="ready", status="completed" if done else "pending", detail="Room ready to review." if done else ""
        ),
    ]
    return ConversionJobStatus(
        jobId=job_id,
        projectId=project_id,
        scanAssetId=scan_asset_id,
        pointsAssetId=points_asset_id,
        status="completed" if done else ("running" if state == "queued" else state),
        stage="ready" if done else "structure",
        stages=stages,
        progress=round(float(structure.get("progress", 0.0)) * 100),
        error=structure.get("error"),
        result=_structure_result(structure["result"]) if done and structure.get("result") else None,
    )


@router.post("/conversions", status_code=202, response_model=ConversionJobStatus)
def create_conversion(request: ConversionJobRequest, repository: Repository, jobs: Jobs, conversions: Conversions):
    project_dir = _project_dir(repository, request.projectId)
    _validate_path_component(request.scanAssetId, "scanAssetId")
    _scan_asset(repository, request.projectId, request.scanAssetId, "scanAssetId")
    points_id = request.pointsAssetId or request.scanAssetId
    _validate_path_component(points_id, "pointsAssetId")
    if Path(points_id).suffix.lower() not in SUPPORTED_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail="pointsAssetId must be a .ply or .splat file; decode .sog/.spz to points first.",
        )
    points_path = _scan_asset(repository, request.projectId, points_id, "pointsAssetId")
    options = AnalysisOptions(upHint=request.upHint).to_options()
    spec = JobSpec(
        project_id=request.projectId,
        scan_asset_id=points_id,
        scan_path=points_path,
        project_dir=project_dir,
        options=options,
    )
    job_id = jobs.submit(spec)
    entry = (request.projectId, request.scanAssetId, points_id)
    conversions.add(job_id, *entry)
    return conversion_status(entry, job_id, jobs.get(job_id) or {"status": "queued"})


@router.get("/conversions/{job_id}", response_model=ConversionJobStatus)
def get_conversion(job_id: str, jobs: Jobs, conversions: Conversions):
    _validate_path_component(job_id, "job_id")
    entry, structure = conversions.get(job_id), jobs.get(job_id)
    if entry is None or structure is None:
        raise HTTPException(status_code=404, detail="Conversion job not found.")
    return conversion_status(entry, job_id, structure)
