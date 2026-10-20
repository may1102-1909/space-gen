"""In-process background jobs for room structure analysis.

One worker thread runs jobs one at a time, so a large scan never competes with another for memory
and never runs inside an HTTP request. Job state lives in memory (bounded); the finished result is
also persisted to `<project>/room_structure/latest.json`.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .analyzer import RoomStructureError, RoomStructureOptions, analyze_room
from .loader import UnsupportedScanFormatError, load_colmap_points, load_scan_points

MAX_JOBS = 100
LATEST_RELATIVE = Path("room_structure") / "latest.json"


@dataclass
class JobSpec:
    project_id: str
    scan_asset_id: str
    scan_path: Path
    project_dir: Path
    colmap_path: Path | None = None
    options: RoomStructureOptions = field(default_factory=RoomStructureOptions)


@dataclass
class Job:
    id: str
    project_id: str
    status: str = "queued"  # queued | running | succeeded | failed
    stage: str = "queued"
    progress: float = 0.0
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    def snapshot(self) -> dict[str, Any]:
        return {
            "jobId": self.id,
            "projectId": self.project_id,
            "status": self.status,
            "stage": self.stage,
            "progress": self.progress,
            "result": self.result,
            "error": self.error,
        }


def write_latest(project_dir: Path, payload: dict[str, Any]) -> Path:
    target = project_dir / LATEST_RELATIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(prefix="latest-", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as temp_file:
            json.dump(payload, temp_file)
        os.replace(temp_name, target)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    return target


def run_analysis(spec: JobSpec, progress: Callable[[str, float], None]) -> dict[str, Any]:
    progress("loading", 0.02)
    positions, opacity = load_scan_points(spec.scan_path)
    colmap = load_colmap_points(spec.colmap_path) if spec.colmap_path else None
    result = analyze_room(positions, opacity, colmap, spec.options, progress=progress)
    del positions, opacity, colmap
    payload = {
        "projectId": spec.project_id,
        "scanAssetId": spec.scan_asset_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "interpretation": result.interpretation.model_dump(mode="json"),
        "scanToScene": list(result.scan_to_scene),
        "diagnostics": result.diagnostics,
    }
    write_latest(spec.project_dir, payload)
    return payload


class RoomStructureJobs:
    def __init__(self, runner: Callable[[JobSpec, Callable[[str, float], None]], dict[str, Any]] = run_analysis):
        self._runner = runner
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="room-structure")
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._lock = threading.Lock()

    def submit(self, spec: JobSpec) -> str:
        job = Job(id=uuid.uuid4().hex, project_id=spec.project_id)
        with self._lock:
            self._jobs[job.id] = job
            while len(self._jobs) > MAX_JOBS:
                oldest = next(iter(self._jobs))
                if self._jobs[oldest].status in ("queued", "running"):
                    break
                del self._jobs[oldest]
        self._executor.submit(self._run, job, spec)
        return job.id

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return job.snapshot() if job else None

    def _update(self, job: Job, **fields: Any) -> None:
        with self._lock:
            for key, value in fields.items():
                setattr(job, key, value)

    def _run(self, job: Job, spec: JobSpec) -> None:
        self._update(job, status="running", stage="loading")

        def progress(stage: str, fraction: float) -> None:
            self._update(job, stage=stage, progress=float(fraction))

        try:
            payload = self._runner(spec, progress)
        except (RoomStructureError, UnsupportedScanFormatError) as exc:
            self._update(job, status="failed", error=str(exc), finished_at=time.time())
        except Exception:  # noqa: BLE001 - surfaced as a failed job, details stay in the server log
            import logging

            logging.getLogger(__name__).exception("room structure job %s failed", job.id)
            self._update(
                job, status="failed", error="Room structure analysis failed unexpectedly.", finished_at=time.time()
            )
        else:
            self._update(job, status="succeeded", stage="done", progress=1.0, result=payload, finished_at=time.time())


_jobs: RoomStructureJobs | None = None
_jobs_lock = threading.Lock()


def get_jobs() -> RoomStructureJobs:
    global _jobs
    with _jobs_lock:
        if _jobs is None:
            _jobs = RoomStructureJobs()
        return _jobs
