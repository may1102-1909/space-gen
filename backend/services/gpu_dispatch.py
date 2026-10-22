"""Objects stage of a splat conversion: push the scan to the GPU worker, poll it, store its meshes.

Runs in a background thread per conversion (never inside an HTTP request). Modes (GPU_WORKER_MODE):
colab = the remote worker behind a tunnel (docs/gpu-worker-setup.md); fake = the same worker app and
CPU pipeline in-process (numpy renderer, geometric masks) so the flow works without a GPU; off = skipped.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
import threading
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Callable, Optional

import httpx
from fastapi import UploadFile

from config import settings
from gpu_worker import client as worker
from models.contracts import (
    AssetRef,
    ObjectPlacement,
    OrientedBoundingBox,
    ProposalAssetDimensions,
    SegmentedObject,
    ShellSurfaceTexture,
)
from services.project_repository import ProjectRepository

log = logging.getLogger(__name__)

JOB_TIMEOUT_S = 2 * 3600.0
FAKE_TOKEN = "fake-worker"
MB = 1e6


class WorkerError(Exception):
    """A failure with a message the user can act on."""


@dataclass
class ObjectsSpec:
    conversion_id: str
    project_id: str
    project_dir: Path
    scan_path: Path
    structure: dict[str, Any]  # room-structure payload: interpretation + scanToScene
    repository: ProjectRepository


@dataclass
class ObjectsState:
    status: str = "pending"  # pending | running | completed | failed
    detail: str = ""
    progress: int = 0
    objects_count: Optional[int] = None
    objects: list[SegmentedObject] = field(default_factory=list)
    surfaces: list[ShellSurfaceTexture] = field(default_factory=list)
    error: Optional[str] = None


def fake_worker_client(work_root: Path) -> httpx.Client:
    """The real worker app, served in-process, running the CPU pipeline on geometric pseudo-masks."""
    from fastapi.testclient import TestClient

    from gpu_worker.render import NumpyRenderer
    from gpu_worker.server import create_app
    from gpu_worker.synthetic import GeometricMaskDetector

    renderer = NumpyRenderer()
    app = create_app(
        FAKE_TOKEN,
        work_root,
        detector_factory=lambda splat: GeometricMaskDetector(splat, renderer),
        renderer_factory=lambda: renderer,
        pipeline_kwargs={"view_size": (128, 96), "target_triangles": 5000},
    )
    return TestClient(app, headers={"Authorization": f"Bearer {FAKE_TOKEN}"}, raise_server_exceptions=False)


class ObjectsDispatcher:
    def __init__(
        self,
        mode: str,
        url: str = "",
        token: str = "",
        work_root: Optional[Path] = None,
        timeout: float = JOB_TIMEOUT_S,
        poll: float = 2.0,
        client_factory: Optional[Callable[[], httpx.Client]] = None,
    ):
        self.mode, self.url, self.token, self.timeout, self.poll = mode, url.rstrip("/"), token, timeout, poll
        self.work_root = Path(work_root or settings.data_dir / "gpu_worker")
        self._client_factory = client_factory
        self._fake_client: Optional[httpx.Client] = None
        self._states: dict[str, ObjectsState] = {}
        self._specs: dict[str, ObjectsSpec] = {}
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self.mode != "off"

    def get(self, conversion_id: str) -> Optional[ObjectsState]:
        with self._lock:
            state = self._states.get(conversion_id)
            return replace(state, objects=list(state.objects), surfaces=list(state.surfaces)) if state else None

    def start(self, spec: ObjectsSpec) -> None:
        if not self.enabled:
            return
        with self._lock:
            self._specs[spec.conversion_id] = spec
            self._states[spec.conversion_id] = ObjectsState(status="running", detail="Waiting for the GPU worker…")
        threading.Thread(target=self._run, args=(spec,), daemon=True, name=f"objects-{spec.conversion_id[:8]}").start()

    def retry(self, conversion_id: str) -> bool:
        with self._lock:
            state, spec = self._states.get(conversion_id), self._specs.get(conversion_id)
            if state is None or spec is None or state.status != "failed":
                return False
        self.start(spec)
        return True

    def _set(self, conversion_id: str, **fields: Any) -> None:
        with self._lock:
            state = self._states[conversion_id]
            for key, value in fields.items():
                setattr(state, key, value)

    def _client(self) -> httpx.Client:
        if self._client_factory:
            return self._client_factory()
        if self.mode == "fake":
            with self._lock:  # one in-process worker, so a retry resumes its finished upload
                if self._fake_client is None:
                    self._fake_client = fake_worker_client(self.work_root / "fake")
                return self._fake_client
        if not (self.url and self.token):
            raise WorkerError(
                "GPU_WORKER_MODE=colab needs GPU_WORKER_URL and GPU_WORKER_TOKEN in backend/.env "
                "(the two lines the Colab notebook prints); restart the backend after setting them."
            )
        return worker.make_client(self.url, self.token, timeout=300)

    def _run(self, spec: ObjectsSpec) -> None:
        cid = spec.conversion_id
        try:
            client = self._client()
            try:
                self._dispatch(client, spec)
            finally:
                if client is not self._fake_client:
                    client.close()
        except WorkerError as error:
            self._set(cid, status="failed", error=str(error), detail="Separating objects failed.")
        except httpx.HTTPStatusError as error:
            self._set(cid, status="failed", error=self._http_message(error), detail="Separating objects failed.")
        except httpx.TransportError as error:
            self._set(cid, status="failed", error=self._offline_message(error), detail="GPU worker unreachable.")
        except TimeoutError as error:
            self._set(cid, status="failed", error=f"{error}; the worker may be stuck — retry.", detail="Timed out.")
        except Exception as error:  # noqa: BLE001 - surfaced to the user instead of a silently stuck stage
            log.exception("objects stage of conversion %s failed", cid)
            self._set(cid, status="failed", error=f"Unexpected error: {error}", detail="Separating objects failed.")

    def _offline_message(self, error: Exception) -> str:
        where = self.url or "the in-process worker"
        return (
            f"Cannot reach the GPU worker at {where} ({type(error).__name__}). Is the Colab notebook still running? "
            "Quick-tunnel URLs change on every restart: copy the new GPU_WORKER_URL into backend/.env, "
            "restart the backend, then retry."
        )

    def _http_message(self, error: httpx.HTTPStatusError) -> str:
        code = error.response.status_code
        if code == 401:
            return "The GPU worker rejected the token: set GPU_WORKER_TOKEN in backend/.env to the value the notebook printed."
        if code in (404, 502, 503, 504, 530):
            return self._offline_message(error) + f" (HTTP {code}: the tunnel has probably expired)"
        detail = error.response.text[:300]
        return f"GPU worker request failed (HTTP {code}): {detail}"

    def _dispatch(self, client: httpx.Client, spec: ObjectsSpec) -> None:
        cid = spec.conversion_id
        self._set(cid, detail="Connecting to the GPU worker…", progress=0, error=None)
        client.get("/health").raise_for_status()

        def uploaded(sent: int, total: int) -> None:
            self._set(cid, detail=f"Uploading {sent / MB:.0f}/{total / MB:.0f} MB", progress=int(40 * sent / total))

        structure = spec.structure
        job_id = worker.submit_job(
            client, spec.scan_path, structure["interpretation"], structure["scanToScene"], progress=uploaded
        )
        self._set(cid, detail="Queued on the GPU worker…", progress=40)

        def polled(status: dict) -> None:
            if status["status"] == "queued":
                self._set(cid, detail="Waiting for the GPU (another job is running)…")
            elif status["status"] == "running":
                step = f" ({status['step']})" if status.get("step") else ""
                self._set(cid, detail=f"Segmenting on GPU…{step}", progress=40 + int(0.45 * status.get("progress", 0)))

        status = worker.wait_job(client, job_id, timeout=self.timeout, poll=self.poll, on_status=polled)
        if status["status"] != "completed":
            raise WorkerError(f"The GPU worker failed: {status.get('error') or 'unknown error'}")
        result = status["result"] or {}
        objects, surfaces = self._store(client, spec, job_id, result)
        summary = {
            "conversionId": cid,
            "objects": [o.model_dump(mode="json") for o in objects],
            "surfaces": [s.model_dump(mode="json") for s in surfaces],
        }
        target = spec.project_dir / "objects" / f"{cid}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(summary), encoding="utf-8")
        self._set(
            cid,
            status="completed",
            progress=100,
            objects=objects,
            surfaces=surfaces,
            objects_count=len(objects),
            detail=f"{len(objects)} object{'s' if len(objects) != 1 else ''} separated",
        )

    def _store(self, client: httpx.Client, spec: ObjectsSpec, job_id: str, result: dict):
        cid, pid = spec.conversion_id, spec.project_id
        raw_objects = list(result.get("objects") or [])
        raw_surfaces = list(result.get("surfaces") or [])
        self._set(cid, objects_count=len(raw_objects))
        url = f"/api/projects/{pid}/assets/"
        temp = Path(tempfile.mkdtemp(prefix="objects-", dir=self._temp_root()))
        try:
            objects = []
            for i, raw in enumerate(raw_objects):
                self._set(
                    cid,
                    detail=f"Downloading {i + 1}/{len(raw_objects)} meshes",
                    progress=85 + 10 * i // max(len(raw_objects), 1),
                )
                filename = self._fetch_and_save(client, spec, job_id, raw["mesh"], ".glb", temp)
                objects.append(self._segmented(cid, i, raw, url + filename))
            surfaces = []
            for raw in raw_surfaces:
                filename = self._fetch_and_save(client, spec, job_id, raw["texture"], ".png", temp)
                surfaces.append(
                    ShellSurfaceTexture(
                        target=raw["target"],
                        wallId=raw.get("wallId"),
                        textureAsset=url + filename,
                        repeat=tuple(raw["repeat"]),
                        coverage=min(1.0, max(0.0, float(raw.get("coverage", 0.0)))),
                    )
                )
            return objects, surfaces
        finally:
            shutil.rmtree(temp, ignore_errors=True)

    def _temp_root(self) -> Path:
        self.work_root.mkdir(parents=True, exist_ok=True)
        return self.work_root

    @staticmethod
    def _fetch_and_save(client, spec: ObjectsSpec, job_id: str, name: Any, suffix: str, temp: Path) -> str:
        # Worker output is untrusted: only plain file names with the expected type are fetched.
        if not isinstance(name, str) or Path(name).name != name or not name.endswith(suffix) or name.startswith("."):
            raise WorkerError(f"The GPU worker returned an invalid artefact name: {name!r}")
        path = worker.fetch_file(client, job_id, name, temp)

        async def save() -> tuple[str, int]:
            with open(path, "rb") as handle:
                return await spec.repository.save_asset(spec.project_id, UploadFile(handle, filename=name))

        return asyncio.run(save())[0]

    @staticmethod
    def _segmented(cid: str, index: int, raw: dict, mesh_url: str) -> SegmentedObject:
        object_id = f"seg_{cid[:8]}_{index}"
        dims = raw["dimensions"]
        size = [max(float(dims[k]), 0.01) for k in ("width", "height", "depth")]
        label = str(raw.get("label") or "object")
        return SegmentedObject(
            id=object_id,
            label=label,
            confidence=min(1.0, max(0.0, float(raw.get("confidence", 0.0)))),
            meshAsset=AssetRef(
                id=f"asset_{object_id}",
                name=label.capitalize(),
                source="segmented",
                url=mesh_url,
                format="glb",
                dimensions=ProposalAssetDimensions(width=size[0], height=size[1], depth=size[2]),
                categories=[label],
            ),
            placement=ObjectPlacement(
                position=tuple(float(v) for v in raw["placement"]["position"]),
                rotationY=float(raw["placement"]["rotationY"]),
            ),
            obb=OrientedBoundingBox.model_validate(raw["obb"]),
            maskRegionId=f"mask_{object_id}",
        )


_dispatcher: Optional[ObjectsDispatcher] = None
_dispatcher_lock = threading.Lock()


def get_dispatcher() -> ObjectsDispatcher:
    global _dispatcher
    with _dispatcher_lock:
        if _dispatcher is None:
            _dispatcher = ObjectsDispatcher(
                settings.gpu_worker_mode, settings.gpu_worker_url, settings.gpu_worker_token
            )
        return _dispatcher
