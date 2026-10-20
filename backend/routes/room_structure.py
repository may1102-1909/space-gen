"""Room structure analysis as a background job.

Scan formats: `.ply` and `.splat` are decoded. `.sog` / `.spz` are compressed containers that the
analyzer does not decode, so they are rejected with 415 (supply a `.ply`/`.splat` export or a COLMAP
points file instead). `colmapPointsPath` is relative to the project directory.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

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


@router.post("/jobs", status_code=202)
def create_job(request: CreateJobRequest, repository: Repository, jobs: Jobs):
    project_dir = _project_dir(repository, request.projectId)
    _validate_path_component(request.scanAssetId, "scanAssetId")
    suffix = Path(request.scanAssetId).suffix.lower()
    if suffix in UNSUPPORTED_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"'{suffix}' scans are compressed and cannot be analysed; use a .ply or .splat scan.",
        )
    try:
        scan_path = repository.asset_path(request.projectId, request.scanAssetId)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid scanAssetId.") from error
    if not scan_path.is_file():
        raise HTTPException(status_code=404, detail="Scan asset not found.")
    if scan_path.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Room structure analysis needs a .ply or .splat scan.")

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
