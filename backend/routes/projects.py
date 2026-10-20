"""Project manifests and content-addressed project assets."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from config import settings
from models.contracts import ProjectManifest
from services.project_repository import (
    FilesystemProjectRepository,
    InvalidProjectIdError,
    ProjectAlreadyExistsError,
    ProjectAssetTooLargeError,
    ProjectNotFoundError,
    ProjectRepository,
    ProjectRevisionConflictError,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


@lru_cache(maxsize=1)
def get_project_repository() -> ProjectRepository:
    return FilesystemProjectRepository(settings.data_dir / "projects", settings.project_asset_max_bytes)


Repository = Annotated[ProjectRepository, Depends(get_project_repository)]


def _etag(revision: int) -> str:
    return f'"{revision}"'


def _document_response(document, *, code: int = 200):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=code,
        content={
            "manifest": document.manifest.model_dump(mode="json"),
            "revision": document.revision,
            "updatedAt": document.updated_at,
        },
        headers={"ETag": _etag(document.revision)},
    )


def _not_found(error: Exception) -> HTTPException:
    return HTTPException(status_code=404, detail="Project not found.")


@router.get("")
def list_projects(repository: Repository):
    return [
        {
            "manifest": document.manifest.model_dump(mode="json"),
            "revision": document.revision,
            "updatedAt": document.updated_at,
        }
        for document in repository.list()
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(request: ProjectManifest | CreateProjectRequest, repository: Repository):
    from datetime import datetime, timezone
    from uuid import uuid4

    now = datetime.now(timezone.utc).isoformat()
    if isinstance(request, ProjectManifest):
        manifest = request
        if not manifest.id:
            manifest_dict = manifest.model_dump(mode="json")
            manifest_dict["id"] = uuid4().hex
            manifest = ProjectManifest.model_validate(manifest_dict)
    else:
        manifest = ProjectManifest.model_validate(
            {
                "schemaVersion": "1.0.0",
                "id": uuid4().hex,
                "name": request.name,
                "scan": {
                    "url": "",
                    "format": "ply",
                    "scanToScene": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                    "scaleSource": "none",
                    "bounds": {"min": [0, 0, 0], "max": [0, 0, 0]},
                },
                "interpretation": {
                    "provenance": "auto",
                    "floor": {"normal": [0, 1, 0], "constant": 0, "provenance": "auto"},
                    "ceilingHeight": 2.5,
                    "outline": [],
                    "walls": [],
                    "openings": [],
                    "detections": [],
                },
                "maskRegions": [],
                "sceneSnapshot": {},
                "assets": [],
                "history": [],
                "variants": [{"id": "default", "name": "Default", "sceneSnapshot": {}, "createdAt": now}],
                "activeVariantId": "default",
            }
        )
    try:
        document = repository.create(manifest)
    except ProjectAlreadyExistsError as error:
        raise HTTPException(status_code=409, detail="Project already exists.") from error
    return _document_response(document, code=201)


@router.get("/{project_id}")
def get_project(project_id: str, repository: Repository):
    try:
        return _document_response(repository.get(project_id))
    except ProjectNotFoundError as error:
        raise _not_found(error) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.put("/{project_id}")
def put_project(
    project_id: str, manifest: ProjectManifest, repository: Repository, if_match: Annotated[str | None, Header()] = None
):
    if if_match is None:
        raise HTTPException(status_code=428, detail="If-Match with the current project revision is required.")
    try:
        expected_revision = int(if_match.strip().strip('"'))
        document = repository.update(project_id, manifest, expected_revision)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ProjectRevisionConflictError as error:
        raise HTTPException(
            status_code=409,
            detail={"message": str(error), "revision": error.current_revision},
            headers={"ETag": _etag(error.current_revision)},
        ) from error
    except ProjectNotFoundError as error:
        raise _not_found(error) from error
    return _document_response(document)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, repository: Repository):
    try:
        repository.delete(project_id)
    except ProjectNotFoundError as error:
        raise _not_found(error) from error
    except InvalidProjectIdError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/{project_id}/assets", status_code=status.HTTP_201_CREATED)
async def upload_asset(project_id: str, repository: Repository, file: UploadFile = File(...)):
    try:
        filename, size = await repository.save_asset(project_id, file)
    except ProjectNotFoundError as error:
        raise _not_found(error) from error
    except InvalidProjectIdError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ProjectAssetTooLargeError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    return {"filename": filename, "size": size, "url": f"/api/projects/{project_id}/assets/{filename}"}


@router.get("/{project_id}/assets/{asset_id}")
def get_asset(project_id: str, asset_id: str, repository: Repository):
    try:
        path = repository.asset_path(project_id, asset_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    media_type = (
        "model/gltf-binary"
        if path.suffix == ".glb"
        else "model/gltf+json"
        if path.suffix == ".gltf"
        else "application/octet-stream"
    )
    return FileResponse(path, media_type=media_type, filename=path.name)
