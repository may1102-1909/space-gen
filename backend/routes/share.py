"""Share links: designer-side management and the read-only client view.

Share tokens are bearer capabilities. Nothing under /api/share accepts a write.
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from routes.projects import get_project_repository
from services.project_repository import (
    InvalidProjectIdError,
    ProjectNotFoundError,
    ProjectRepository,
    ShareNotFoundError,
    ShareRecord,
)
from services.share_view import build_shared_project

designer_router = APIRouter(prefix="/api/projects/{project_id}/shares", tags=["share"])
public_router = APIRouter(prefix="/api/share", tags=["share"])

Repository = Annotated[ProjectRepository, Depends(get_project_repository)]
_NO_STORE = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer"}
_ASSET_RE = re.compile(r"[0-9a-f]{64}(?:\.[a-z]+)?")


class CreateShareRequest(BaseModel):
    label: str = Field(default="", max_length=120)


def _share_json(record: ShareRecord) -> dict:
    return {"id": record.id, "label": record.label, "createdAt": record.created_at, "revokedAt": record.revoked_at}


def _project_error(error: Exception) -> HTTPException:
    if isinstance(error, ProjectNotFoundError):
        return HTTPException(status_code=404, detail="Project not found.")
    return HTTPException(status_code=400, detail=str(error))


@designer_router.post("", status_code=status.HTTP_201_CREATED)
def create_share(project_id: str, request: CreateShareRequest, repository: Repository):
    try:
        record, token = repository.create_share(project_id, request.label.strip())
    except (ProjectNotFoundError, InvalidProjectIdError) as error:
        raise _project_error(error) from error
    # The token is returned exactly once; only its hash is stored.
    return {**_share_json(record), "token": token}


@designer_router.get("")
def list_shares(project_id: str, repository: Repository):
    try:
        return [_share_json(r) for r in repository.list_shares(project_id)]
    except (ProjectNotFoundError, InvalidProjectIdError) as error:
        raise _project_error(error) from error


@designer_router.delete("/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_share(project_id: str, share_id: str, repository: Repository):
    try:
        repository.revoke_share(project_id, share_id)
    except ShareNotFoundError as error:
        raise HTTPException(status_code=404, detail="Share not found.") from error
    except (ProjectNotFoundError, InvalidProjectIdError) as error:
        raise _project_error(error) from error


def _project_for(token: str, repository: ProjectRepository) -> str:
    project_id = repository.resolve_share(token)
    if project_id is None:
        raise HTTPException(status_code=404, detail="Share not found.")
    return project_id


@public_router.get("/{token}")
def get_shared_project(token: str, request: Request, repository: Repository):
    project_id = _project_for(token, repository)
    try:
        document = repository.get(project_id)
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail="Share not found.") from error
    return JSONResponse(build_shared_project(document, token, str(request.base_url)), headers=_NO_STORE)


@public_router.get("/{token}/assets/{asset_id}")
def get_shared_asset(token: str, asset_id: str, repository: Repository):
    project_id = _project_for(token, repository)
    if not _ASSET_RE.fullmatch(asset_id):
        raise HTTPException(status_code=404, detail="Asset not found.")
    try:
        path = repository.asset_path(project_id, asset_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail="Asset not found.") from error
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    media_type = (
        "model/gltf-binary"
        if path.suffix == ".glb"
        else "model/gltf+json"
        if path.suffix == ".gltf"
        else "application/octet-stream"
    )
    return FileResponse(path, media_type=media_type, headers=_NO_STORE)
