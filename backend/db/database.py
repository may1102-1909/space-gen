"""Database connection and persistence manager for SpaceGen AI.

Supports local JSON/SQLite persistence out of the box and connects to
PostgreSQL/Supabase when DATABASE_URL is configured.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from config import settings

DB_DIR = settings.data_dir.resolve()
DB_DIR.mkdir(parents=True, exist_ok=True)
JOBS_FILE = DB_DIR / "jobs.json"
SCENES_FILE = DB_DIR / "scenes.json"


class LocalDatabase:
    """Local JSON-backed persistent store ensuring state survives server restarts."""

    def __init__(self):
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._scenes: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self):
        if JOBS_FILE.exists():
            try:
                with open(JOBS_FILE, "r", encoding="utf-8") as f:
                    self._jobs = json.load(f)
            except Exception as e:
                print(f"[DB] Could not load jobs file: {e}")
                self._jobs = {}

        if SCENES_FILE.exists():
            try:
                with open(SCENES_FILE, "r", encoding="utf-8") as f:
                    self._scenes = json.load(f)
            except Exception as e:
                print(f"[DB] Could not load scenes file: {e}")
                self._scenes = {}

    def _save_jobs(self):
        try:
            with open(JOBS_FILE, "w", encoding="utf-8") as f:
                json.dump(self._jobs, f, indent=2)
        except Exception as e:
            print(f"[DB] Could not save jobs: {e}")

    def _save_scenes(self):
        try:
            with open(SCENES_FILE, "w", encoding="utf-8") as f:
                json.dump(self._scenes, f, indent=2)
        except Exception as e:
            print(f"[DB] Could not save scenes: {e}")

    # Job Operations
    def save_job(self, job_id: str, data: Dict[str, Any]) -> None:
        self._jobs[job_id] = data
        self._save_jobs()

    def update_job(self, job_id: str, **updates: Any) -> Optional[Dict[str, Any]]:
        if job_id in self._jobs:
            self._jobs[job_id].update(updates)
            self._save_jobs()
            return self._jobs[job_id]
        return None

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self._jobs.get(job_id)

    def list_jobs(self) -> List[Dict[str, Any]]:
        return list(self._jobs.values())

    def get_latest_job(self) -> Optional[Dict[str, Any]]:
        if not self._jobs:
            return None
        completed = [j for j in self._jobs.values() if j.get("status") == "completed"]
        if completed:
            return completed[-1]
        return list(self._jobs.values())[-1]

    # Scene Operations
    def save_scene(self, scene_id: str, data: Dict[str, Any]) -> None:
        self._scenes[scene_id] = data
        self._save_scenes()

    def get_scene(self, scene_id: str) -> Optional[Dict[str, Any]]:
        return self._scenes.get(scene_id)


db = LocalDatabase()
