"""Filesystem-backed project persistence with optimistic revisions."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from fastapi import UploadFile

from models.contracts import ProjectManifest

PROJECT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
ASSET_SUFFIXES = {".sog", ".spz", ".ply", ".splat", ".glb", ".gltf"}


class ProjectNotFoundError(Exception):
    pass


class ProjectAlreadyExistsError(Exception):
    pass


class ProjectRevisionConflictError(Exception):
    def __init__(self, current_revision: int):
        self.current_revision = current_revision
        super().__init__(f"Project revision conflict; current revision is {current_revision}.")


class ProjectAssetTooLargeError(Exception):
    pass


class InvalidProjectIdError(ValueError):
    pass


@dataclass(frozen=True)
class ProjectDocument:
    manifest: ProjectManifest
    revision: int
    updated_at: str


class ProjectRepository(Protocol):
    """Storage boundary so filesystem persistence can be replaced by a database adapter."""

    def create(self, manifest: ProjectManifest) -> ProjectDocument: ...
    def get(self, project_id: str) -> ProjectDocument: ...
    def list(self) -> list[ProjectDocument]: ...
    def update(self, project_id: str, manifest: ProjectManifest, expected_revision: int) -> ProjectDocument: ...
    def delete(self, project_id: str) -> None: ...
    async def save_asset(self, project_id: str, upload: UploadFile) -> tuple[str, int]: ...
    def asset_path(self, project_id: str, filename: str) -> Path: ...


class FilesystemProjectRepository:
    """Repository interface implementation using JSON files and content-hashed assets."""

    def __init__(self, root: Path, max_asset_bytes: int = 100 * 1024 * 1024):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.max_asset_bytes = max_asset_bytes
        self._lock = threading.RLock()

    @staticmethod
    def _validate_id(project_id: str) -> str:
        if not PROJECT_ID_RE.fullmatch(project_id):
            raise InvalidProjectIdError("Invalid project id.")
        return project_id

    def _project_dir(self, project_id: str) -> Path:
        project_id = self._validate_id(project_id)
        target = (self.root / project_id).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError("Project path escapes storage root.")
        return target

    def _manifest_path(self, project_id: str) -> Path:
        return self._project_dir(project_id) / "project.json"

    def _read(self, project_id: str) -> ProjectDocument:
        path = self._manifest_path(project_id)
        if not path.is_file():
            raise ProjectNotFoundError(project_id)
        payload = json.loads(path.read_text(encoding="utf-8"))
        return ProjectDocument(
            manifest=ProjectManifest.model_validate(payload["manifest"]),
            revision=int(payload["revision"]),
            updated_at=str(payload["updatedAt"]),
        )

    @staticmethod
    def _document_dict(document: ProjectDocument) -> dict[str, Any]:
        return {
            "manifest": document.manifest.model_dump(mode="json"),
            "revision": document.revision,
            "updatedAt": document.updated_at,
        }

    def _write(self, document: ProjectDocument) -> None:
        directory = self._project_dir(document.manifest.id)
        directory.mkdir(parents=True, exist_ok=True)
        lock_path = directory / ".project.lock"
        if not lock_path.exists():
            lock_path.write_bytes(b"0")
        path = directory / "project.json"
        handle, temp_name = tempfile.mkstemp(prefix="project-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as temp_file:
                json.dump(self._document_dict(document), temp_file, ensure_ascii=False, separators=(",", ":"))
                temp_file.flush()
                os.fsync(temp_file.fileno())
            os.replace(temp_name, path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    @contextmanager
    def _project_file_lock(self, project_id: str):
        """Lock the revision read/modify/write across threads and server processes."""
        lock_path = self._project_dir(project_id) / ".project.lock"
        with lock_path.open("r+b") as lock_file:
            if os.name == "nt":
                import msvcrt

                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
                try:
                    yield
                finally:
                    lock_file.seek(0)
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def create(self, manifest: ProjectManifest) -> ProjectDocument:
        with self._lock:
            if self._manifest_path(manifest.id).exists():
                raise ProjectAlreadyExistsError(manifest.id)
            from datetime import datetime, timezone

            document = ProjectDocument(
                manifest=manifest,
                revision=1,
                updated_at=datetime.now(timezone.utc).isoformat(),
            )
            self._write(document)
            return document

    def get(self, project_id: str) -> ProjectDocument:
        with self._lock:
            return self._read(project_id)

    def list(self) -> list[ProjectDocument]:
        with self._lock:
            documents: list[ProjectDocument] = []
            for directory in self.root.iterdir():
                if directory.is_dir() and PROJECT_ID_RE.fullmatch(directory.name):
                    try:
                        documents.append(self._read(directory.name))
                    except (OSError, ValueError, KeyError, json.JSONDecodeError):
                        continue
            documents.sort(key=lambda doc: doc.updated_at, reverse=True)
            return documents

    def update(self, project_id: str, manifest: ProjectManifest, expected_revision: int) -> ProjectDocument:
        with self._lock:
            directory = self._project_dir(project_id)
            if not (directory / "project.json").is_file():
                raise ProjectNotFoundError(project_id)
            with self._project_file_lock(project_id):
                current = self._read(project_id)
                if manifest.id != project_id:
                    raise ValueError("Manifest id must match the project id.")
                if current.revision != expected_revision:
                    raise ProjectRevisionConflictError(current.revision)
                from datetime import datetime, timezone

                document = ProjectDocument(
                    manifest=manifest,
                    revision=current.revision + 1,
                    updated_at=datetime.now(timezone.utc).isoformat(),
                )
                self._write(document)
                return document

    def delete(self, project_id: str) -> None:
        with self._lock:
            directory = self._project_dir(project_id)
            if not (directory / "project.json").is_file():
                raise ProjectNotFoundError(project_id)
            # Project deletion is requested by the API; remove only its validated leaf directory.
            import shutil

            shutil.rmtree(directory)

    async def save_asset(self, project_id: str, upload: UploadFile) -> tuple[str, int]:
        directory = self._project_dir(project_id)
        if not (directory / "project.json").is_file():
            raise ProjectNotFoundError(project_id)
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix not in ASSET_SUFFIXES:
            raise ValueError("Unsupported asset type. Use a scan file or GLB/GLTF asset.")

        assets_dir = directory / "assets"
        assets_dir.mkdir(exist_ok=True)
        handle, temp_name = tempfile.mkstemp(prefix="upload-", suffix=".tmp", dir=assets_dir)
        digest = hashlib.sha256()
        size = 0
        try:
            with os.fdopen(handle, "wb") as temp_file:
                while chunk := await upload.read(1024 * 1024):
                    if size + len(chunk) > self.max_asset_bytes:
                        raise ProjectAssetTooLargeError(f"Asset exceeds the {self.max_asset_bytes}-byte upload limit.")
                    digest.update(chunk)
                    size += len(chunk)
                    temp_file.write(chunk)
                temp_file.flush()
                os.fsync(temp_file.fileno())
            filename = f"{digest.hexdigest()}{suffix}"
            target = assets_dir / filename
            if target.exists():
                os.unlink(temp_name)
            else:
                os.replace(temp_name, target)
            return filename, size
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    def asset_path(self, project_id: str, filename: str) -> Path:
        if Path(filename).name != filename or not re.fullmatch(
            r"[0-9a-f]{64}(?:\.(?:sog|spz|ply|splat|glb|gltf))?", filename
        ):
            raise ValueError("Invalid asset filename.")
        directory = self._project_dir(project_id)
        assets_dir = (directory / "assets").resolve()
        target = (assets_dir / filename).resolve()
        if not target.is_file() and "." not in filename:
            matches = list(assets_dir.glob(f"{filename}.*"))
            if matches:
                target = matches[0].resolve()
        if not target.is_relative_to(assets_dir):
            raise ValueError("Asset path escapes project storage.")
        return target
