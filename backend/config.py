from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    gemini_api_key: str = ""
    gemini_fast_model: str = "gemini-2.5-flash"
    gemini_image_model: str = "gemini-2.5-flash"
    gemini_reasoning_model: str = "gemini-2.5-pro"
    cors_origins: str = "http://localhost:3000"

    # Cross-platform data directory (defaults to backend/data)
    data_dir: Path = Path(__file__).resolve().parent / "data"

    # Optional override for reconstruction artifacts directory
    reconstruction_dir: Optional[Path] = None

    # Configurable tool paths for reconstruction binaries
    colmap_path: Optional[str] = None
    ffmpeg_path: Optional[str] = None
    nerfstudio_path: Optional[str] = None
    extra_tool_paths: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def reconstruction_root(self) -> Path:
        """Resolve the cross-platform root directory for reconstruction jobs."""
        root = self.reconstruction_dir or (self.data_dir / "reconstruction")
        return root.resolve()

    @property
    def tool_paths(self) -> List[Path]:
        """Collect extra tool search paths from configuration."""
        paths: List[Path] = []
        if self.extra_tool_paths:
            for p in self.extra_tool_paths.split(os.pathsep):
                if p.strip():
                    paths.append(Path(p.strip()).resolve())
        for explicit in [self.colmap_path, self.ffmpeg_path, self.nerfstudio_path]:
            if explicit:
                p = Path(explicit).resolve()
                paths.append(p.parent if p.is_file() else p)
        return paths


settings = Settings()
