"""Local & Cloud video ingestion and Gaussian Splatting training pipeline.

Persists reconstruction jobs and serves 3D Gaussian Splat (.ply, .spz, .ksplat)
artifacts for real-time browser rendering.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from config import settings
from db.database import db

router = APIRouter(prefix="/api/reconstruction", tags=["reconstruction"])
ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = settings.reconstruction_root
DATA_ROOT.mkdir(parents=True, exist_ok=True)
CATALOG_DIR = (settings.data_dir / "furniture_catalog").resolve()
SUPPORTED_3D_EXTS = {".sog", ".splat", ".ply", ".spz", ".ksplat", ".glb", ".gltf", ".obj"}

# Dynamically add configured tool paths to PATH without hardcoded OS paths
if settings.tool_paths:
    _current_path = os.environ.get("PATH", "")
    _path_parts = _current_path.split(os.pathsep)
    for _tp in settings.tool_paths:
        if _tp.exists() and str(_tp) not in _path_parts:
            _path_parts.insert(0, str(_tp))
    os.environ["PATH"] = os.pathsep.join(_path_parts)

os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"


def _validate_path_component(component: str, field_name: str = "identifier") -> str:
    """Ensure an identifier or path component does not contain directory traversal sequences."""
    if not component:
        raise HTTPException(status_code=400, detail=f"Empty {field_name}")
    if "\x00" in component or "/" in component or "\\" in component or ".." in component:
        raise HTTPException(status_code=400, detail=f"Access denied: Invalid {field_name} (path traversal rejected)")
    return component


def _safe_resolve_child(base_dir: Path, requested_path: str) -> Path:
    """
    Resolve requested_path relative to base_dir, strictly ensuring that the
    resolved path remains within base_dir and does not escape.
    Rejects directory traversal attempts with HTTP 400.
    """
    if not requested_path or "\x00" in requested_path:
        raise HTTPException(status_code=400, detail="Invalid path")

    # Reject traversal sequences early
    normalized = requested_path.replace("\\", "/")
    segments = [s for s in normalized.split("/") if s]
    if any(s == ".." for s in segments):
        raise HTTPException(status_code=400, detail="Access denied: Directory traversal rejected")

    base = base_dir.resolve()
    target = (base / requested_path).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=400, detail="Access denied: Path traversal detected")

    return target


def _find_tool(name: str) -> str | None:
    """Find a binary in configured paths, system PATH, or configured binary directories."""
    # 1. Configured explicit path
    if name == "colmap" and settings.colmap_path and Path(settings.colmap_path).exists():
        return str(Path(settings.colmap_path).resolve())
    if name == "ffmpeg" and settings.ffmpeg_path and Path(settings.ffmpeg_path).exists():
        return str(Path(settings.ffmpeg_path).resolve())
    if "ns-" in name and settings.nerfstudio_path and Path(settings.nerfstudio_path).exists():
        candidate = Path(settings.nerfstudio_path)
        if candidate.is_file() and candidate.name.startswith(name):
            return str(candidate.resolve())
        if candidate.is_dir():
            for ext in [".exe", ".bat", ".cmd", ""]:
                target = candidate / f"{name}{ext}"
                if target.exists():
                    return str(target.resolve())

    # 2. Check system PATH
    found = shutil.which(name)
    if found:
        return found

    # 3. Check extra tool directories from settings
    for directory in settings.tool_paths:
        for ext in [".exe", ".bat", ".cmd", ""]:
            candidate = directory / f"{name}{ext}"
            if candidate.exists():
                return str(candidate.resolve())
    return None


def _update(job_id: str, **values: Any) -> None:
    db.update_job(job_id, **values)


def _run(command: list[str], cwd: Path, job_id: str, step: str) -> None:
    """Run a CLI command and stream the last line into persistent job state."""
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=env,
    )
    assert process.stdout is not None
    for line in process.stdout:
        line = line.strip()
        if line:
            _update(job_id, step=step, log=line[-240:])
    code = process.wait()
    if code:
        raise RuntimeError(f"{step} failed with exit code {code}")


def _worker(job_id: str, video_path: Path, job_dir: Path, mode: str = "fast") -> None:
    try:
        _update(
            job_id,
            status="running",
            progress=12,
            step="Extracting keyframes",
            log="Extracting keyframes for reconstruction…",
        )
        frames = job_dir / "frames"
        script = ROOT / "scripts" / "process_video.py"
        fps_val = "2" if mode == "fast" else "3"
        min_frames = "28" if mode == "fast" else "36"
        thresh = "45" if mode == "fast" else "40"
        max_iters = "6000" if mode == "fast" else "15000"

        if script.exists():
            _run(
                [
                    sys.executable,
                    str(script),
                    str(video_path),
                    str(frames),
                    "--fps",
                    fps_val,
                    "--min-frames",
                    min_frames,
                    "--quality-threshold",
                    thresh,
                ],
                ROOT,
                job_id,
                "Extracting keyframes",
            )

        ns_process = _find_tool("ns-process-data")
        ns_train = _find_tool("ns-train")
        ns_export = _find_tool("ns-export")
        if not (ns_process and ns_train):
            _update(
                job_id,
                status="ready_for_training",
                progress=38,
                step="Frames ready — install Nerfstudio or use Cloud GPU",
                log="Keyframes extracted. Ready for Gaussian Splatting training.",
                frames_dir=str(frames),
            )
            return

        processed = job_dir / "processed"
        _update(
            job_id,
            progress=45,
            step="Estimating camera poses",
            log="Running fast sequential feature extraction & bundle adjustment…",
        )
        _run(
            [
                ns_process,
                "images",
                "--data",
                str(frames),
                "--output-dir",
                str(processed),
                "--camera-type",
                "perspective",
                "--matching-method",
                "sequential",
                "--num-downscales",
                "2",
            ],
            ROOT,
            job_id,
            "Estimating camera poses",
        )

        output = job_dir / "output"
        _update(
            job_id,
            progress=58,
            step="Training Gaussian Splatting",
            log=f"Training splatfacto on GPU ({max_iters} steps)…",
        )

        train_cmd = [
            ns_train,
            "splatfacto",
            "--data",
            str(processed),
            "--output-dir",
            str(output),
            "--max-num-iterations",
            max_iters,
            "--pipeline.model.num-downscales",
            "1" if mode == "quality" else "2",
            "--pipeline.model.sh-degree",
            "2" if mode == "quality" else "1",
            "--pipeline.model.cull-alpha-thresh",
            "0.005",
            "--pipeline.model.camera-optimizer.mode",
            "off",
            "--viewer.quit-on-train-completion",
            "True",
        ]
        _run(train_cmd, ROOT, job_id, "Training Gaussian Splatting")

        export_dir = job_dir / "export"
        if ns_export:
            configs = sorted(output.glob("**/config.yml"), key=lambda p: p.stat().st_mtime, reverse=True)
            if configs:
                _update(job_id, progress=88, step="Exporting scene", log="Packaging the trained splat for the viewer…")
                _run(
                    [ns_export, "gaussian-splat", "--load-config", str(configs[0]), "--output-dir", str(export_dir)],
                    ROOT,
                    job_id,
                    "Exporting scene",
                )

                exported_ply = export_dir / "splat.ply"
                if exported_ply.exists():
                    _update(
                        job_id,
                        progress=95,
                        step="Compressing splat",
                        log="Optimizing splat stream for 60-144 FPS web viewing…",
                    )
                    try:
                        export_script = ROOT / "scripts" / "export_gsplat.py"
                        if export_script.exists():
                            subprocess.run(
                                [
                                    sys.executable,
                                    str(export_script),
                                    "--input",
                                    str(exported_ply),
                                    "--output-dir",
                                    str(export_dir),
                                    "--format",
                                    "all",
                                ],
                                check=True,
                                timeout=60,
                            )
                    except Exception as e:
                        print(f"gsplat compression warning: {e}")

        _update(
            job_id,
            status="completed",
            progress=100,
            step="Scene ready",
            log="Gaussian Splatting scene completed.",
            scene_path=str(export_dir),
        )
    except Exception as exc:
        _update(job_id, status="failed", step="Reconstruction failed", log=str(exc))


@router.post("/jobs", status_code=202)
async def create_reconstruction_job(video: UploadFile = File(...), mode: str = "fast"):
    allowed = {".mp4", ".mov", ".m4v", ".webm", ".avi"}
    suffix = Path(video.filename or "capture.mp4").suffix.lower()
    if suffix not in allowed:
        raise HTTPException(400, "Upload an MP4, MOV, M4V, WebM, or AVI video.")
    job_id = uuid.uuid4().hex[:12]
    job_dir = DATA_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    video_path = job_dir / f"capture{suffix}"
    with video_path.open("wb") as target:
        shutil.copyfileobj(video.file, target)

    job_data = {
        "job_id": job_id,
        "status": "queued",
        "progress": 4,
        "step": "Queued",
        "log": f"Video uploaded ({mode} mode) — waiting for worker…",
        "video_path": str(video_path),
        "mode": mode,
    }
    db.save_job(job_id, job_data)
    asyncio.create_task(asyncio.to_thread(_worker, job_id, video_path, job_dir, mode))
    return job_data


@router.post("/upload-model", status_code=201)
async def upload_existing_model(model: UploadFile = File(...)):
    """Upload an existing 3D Gaussian Splat (.sog, .ply, .spz, .splat, .ksplat) or mesh (.glb) to view immediately."""
    allowed = {".sog", ".ply", ".spz", ".splat", ".ksplat", ".glb", ".gltf", ".obj"}
    suffix = Path(model.filename or "model.ply").suffix.lower()
    if suffix not in allowed:
        raise HTTPException(400, f"Unsupported 3D model format. Allowed: {', '.join(allowed)}")

    job_id = f"import_{uuid.uuid4().hex[:8]}"
    job_dir = DATA_ROOT / job_id
    export_dir = job_dir / "export"
    export_dir.mkdir(parents=True, exist_ok=True)

    target_filename = "splat.ply" if suffix == ".ply" else f"scene{suffix}"
    target_path = export_dir / target_filename
    with target_path.open("wb") as out:
        shutil.copyfileobj(model.file, out)

    size_mb = round(target_path.stat().st_size / (1024 * 1024), 1)

    splat_url = f"/api/reconstruction/jobs/{job_id}/model/{target_filename}"
    if suffix == ".ply":
        try:
            export_script = ROOT / "scripts" / "export_gsplat.py"
            if export_script.exists():
                subprocess.run(
                    [
                        sys.executable,
                        str(export_script),
                        "--input",
                        str(target_path),
                        "--output-dir",
                        str(export_dir),
                        "--format",
                        "all",
                    ],
                    timeout=30,
                )
                if (export_dir / "scene.splat").exists():
                    splat_url = f"/api/reconstruction/jobs/{job_id}/model/scene.splat"
        except Exception as e:
            print(f"gsplat auto-compression skipped: {e}")

    job_data = {
        "job_id": job_id,
        "status": "completed",
        "progress": 100,
        "step": "Model ready",
        "log": f"Imported {model.filename} ({size_mb} MB) successfully.",
        "scene_path": str(export_dir),
        "splat_url": splat_url,
    }
    db.save_job(job_id, job_data)
    return job_data


@router.get("/models")
async def list_available_models():
    """List all available 3D Gaussian Splat and mesh models stored on disk."""
    models = []
    if DATA_ROOT.exists():
        job_dirs = sorted([d for d in DATA_ROOT.iterdir() if d.is_dir()], key=lambda d: d.stat().st_mtime, reverse=True)
        for d in job_dirs:
            export_dir = d / "export"
            if not export_dir.exists():
                export_dir = d

            found_file = None
            for candidate_name in [
                "scene.sog",
                "scene.splat",
                "splat.ply",
                "scene.spz",
                "scene.ksplat",
                "scene.glb",
                "scene.gltf",
                "scene.obj",
                "point_cloud.ply",
            ]:
                target_file = export_dir / candidate_name
                if target_file.exists():
                    found_file = target_file
                    break

            if not found_file and export_dir.exists():
                for f in export_dir.iterdir():
                    if f.is_file() and f.suffix.lower() in SUPPORTED_3D_EXTS:
                        found_file = f
                        break

            if found_file:
                size_mb = round(found_file.stat().st_size / (1024 * 1024), 1)
                models.append(
                    {
                        "job_id": d.name,
                        "filename": found_file.name,
                        "size_mb": size_mb,
                        "format": found_file.suffix.replace(".", ""),
                        "url": f"/api/reconstruction/jobs/{d.name}/model/{found_file.name}",
                        "modified": found_file.stat().st_mtime,
                    }
                )
    return models


@router.get("/jobs/latest")
async def get_latest_reconstruction_job():
    """Get the most recent completed reconstruction job or check data directory for existing splats."""
    job = db.get_latest_job()
    if job and job.get("status") == "completed":
        return job

    if DATA_ROOT.exists():
        job_dirs = sorted([d for d in DATA_ROOT.iterdir() if d.is_dir()], key=lambda d: d.stat().st_mtime, reverse=True)
        for d in job_dirs:
            for sdir in [d / "export", d]:
                if sdir.exists():
                    for candidate in [
                        "scene.sog",
                        "scene.splat",
                        "splat.ply",
                        "scene_mesh.glb",
                        "scene.spz",
                        "scene.obj",
                    ]:
                        cf = sdir / candidate
                        if cf.exists() and cf.is_file():
                            return {
                                "job_id": d.name,
                                "status": "completed",
                                "progress": 100,
                                "step": "Model ready",
                                "log": f"3D model ({cf.name}) ready.",
                                "scene_path": str(sdir),
                                "splat_url": f"/api/reconstruction/jobs/{d.name}/model/{cf.name}",
                            }
    if job:
        return job
    raise HTTPException(404, "No reconstruction jobs found")


@router.api_route("/jobs/{job_id}/model", methods=["GET", "HEAD"])
async def get_reconstruction_model_default(job_id: str):
    _validate_path_component(job_id, "job_id")
    return _resolve_and_serve_model(job_id, None)


@router.api_route("/jobs/{job_id}/model/{filename:path}", methods=["GET", "HEAD"])
async def get_reconstruction_model(job_id: str, filename: str):
    _validate_path_component(job_id, "job_id")
    return _resolve_and_serve_model(job_id, filename)


def _resolve_and_serve_model(job_id: str, filename: Optional[str] = None):
    """Serve the exported 3D Gaussian Splat (.sog, .ply, .spz, .splat) or mesh (.glb, .obj) for a reconstruction job."""
    _validate_path_component(job_id, "job_id")
    job_dir = (DATA_ROOT / job_id).resolve()
    if not job_dir.exists():
        fallback_dir = (ROOT / "data" / "reconstruction" / job_id).resolve()
        if fallback_dir.exists():
            job_dir = fallback_dir

    export_dir = job_dir / "export"
    search_dirs = [export_dir, job_dir]

    # 1. If explicit filename requested, safely resolve and ensure it remains inside search dir
    if filename:
        for sdir in search_dirs:
            target = _safe_resolve_child(sdir, filename)
            if target.exists() and target.is_file():
                return _create_model_response(target)
        raise HTTPException(404, f"3D model file {filename} not found for job {job_id}")

    # 2. Check standard candidate names (prefer fast streamable scene.splat or scene.sog)
    for sdir in search_dirs:
        for candidate_name in [
            "scene.sog",
            "scene.splat",
            "splat.ply",
            "scene.spz",
            "scene.ksplat",
            "scene.glb",
            "scene.gltf",
            "scene.obj",
            "point_cloud.ply",
        ]:
            candidate = sdir / candidate_name
            if candidate.exists() and candidate.is_file():
                return _create_model_response(candidate)

    # 3. Check for any supported 3D file in export or job directory
    for sdir in search_dirs:
        if sdir.exists():
            for f in sdir.iterdir():
                if f.is_file() and f.suffix.lower() in SUPPORTED_3D_EXTS:
                    return _create_model_response(f)

    raise HTTPException(404, f"3D model file not found for job {job_id}")


def _create_model_response(file_path: Path) -> FileResponse:
    ext = file_path.suffix.lower()
    media_types = {
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
        ".sog": "application/octet-stream",
        ".ply": "application/octet-stream",
        ".spz": "application/octet-stream",
        ".splat": "application/octet-stream",
        ".ksplat": "application/octet-stream",
        ".obj": "text/plain",
    }
    media_type = media_types.get(ext, "application/octet-stream")
    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=file_path.name,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Length, Content-Type, Accept-Ranges",
            "Accept-Ranges": "bytes",
        },
    )


@router.get("/jobs/{job_id}")
async def get_reconstruction_job(job_id: str):
    _validate_path_component(job_id, "job_id")
    job = db.get_job(job_id)
    if job:
        return job

    job_dir = DATA_ROOT / job_id
    splat_file = job_dir / "export" / "splat.ply"
    if splat_file.exists():
        return {
            "job_id": job_id,
            "status": "completed",
            "progress": 100,
            "step": "Scene ready",
            "log": "Gaussian Splatting scene completed.",
            "scene_path": str(job_dir / "export"),
            "splat_url": f"/api/reconstruction/jobs/{job_id}/model",
        }
    raise HTTPException(404, "Reconstruction job not found")


@router.post("/convert-upload-to-mesh")
async def convert_uploaded_file_to_mesh(file: UploadFile = File(...)):
    """
    Upload a local Gaussian Splat (.sog, .ply) and convert it directly into a solid polygon mesh (.glb).
    Returns real job ID, mesh URL, floor infill URL, manifest, and any embedded license notice.
    """
    allowed = {".sog", ".ply"}
    suffix = Path(file.filename or "scene.sog").suffix.lower()
    if suffix not in allowed:
        raise HTTPException(400, f"Unsupported splat format '{suffix}' for mesh conversion. Allowed: .sog, .ply")

    job_id = f"sog_mesh_{uuid.uuid4().hex[:8]}"
    job_dir = DATA_ROOT / job_id
    export_dir = job_dir / "export"
    mesh_dir = job_dir / "mesh"
    export_dir.mkdir(parents=True, exist_ok=True)
    mesh_dir.mkdir(parents=True, exist_ok=True)

    target_filename = f"scene{suffix}"
    target_path = export_dir / target_filename
    with target_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    from services.mesh_extractor import convert_splat_to_mesh

    try:
        manifest = await asyncio.to_thread(convert_splat_to_mesh, target_path, mesh_dir)
        job_data = {
            "job_id": job_id,
            "status": "completed",
            "progress": 100,
            "step": "Mesh ready",
            "log": f"Converted {file.filename} into solid mesh successfully.",
            "scene_path": str(export_dir),
            "splat_url": f"/api/reconstruction/jobs/{job_id}/model/{target_filename}",
            "mesh_url": f"/api/reconstruction/jobs/{job_id}/mesh/scene_mesh.glb",
            "manifest": manifest,
        }
        db.save_job(job_id, job_data)
        return {
            "status": "completed",
            "job_id": job_id,
            "splat_url": f"/api/reconstruction/jobs/{job_id}/model/{target_filename}",
            "mesh_url": f"/api/reconstruction/jobs/{job_id}/mesh/scene_mesh.glb",
            "floor_infill_url": f"/api/reconstruction/jobs/{job_id}/mesh/floor_infill.glb",
            "manifest": manifest,
            "license": manifest.get("license"),
        }
    except Exception as e:
        raise HTTPException(500, f"Mesh conversion failed: {str(e)}")


@router.post("/jobs/{job_id}/convert-to-mesh")
async def convert_job_to_mesh(job_id: str):
    """Convert an existing Gaussian Splat job (.sog, .ply) into an editable solid polygon mesh (.glb)."""
    _validate_path_component(job_id, "job_id")
    from services.mesh_extractor import convert_splat_to_mesh

    job_dir = (DATA_ROOT / job_id).resolve()
    if not job_dir.exists():
        fallback = (ROOT / "data" / "reconstruction" / job_id).resolve()
        if fallback.exists():
            job_dir = fallback
        else:
            raise HTTPException(404, f"Job {job_id} not found")

    export_dir = job_dir / "export"
    candidates = [
        export_dir / "scene.sog",
        export_dir / "splat.ply",
    ]
    splat_file = None
    for cand in candidates:
        if cand.exists():
            splat_file = cand
            break

    if not splat_file:
        all_sog = list(export_dir.glob("*.sog")) or list(job_dir.glob("*.sog"))
        all_ply = list(export_dir.glob("*.ply")) or list(job_dir.glob("*.ply"))
        if all_sog:
            splat_file = all_sog[0]
        elif all_ply:
            splat_file = all_ply[0]
        else:
            raise HTTPException(400, "No splat (.sog or .ply) file found in job to convert into mesh.")

    mesh_dir = job_dir / "mesh"
    try:
        manifest = await asyncio.to_thread(convert_splat_to_mesh, splat_file, mesh_dir)
        return {
            "status": "completed",
            "job_id": job_id,
            "mesh_url": f"/api/reconstruction/jobs/{job_id}/mesh/scene_mesh.glb",
            "floor_infill_url": f"/api/reconstruction/jobs/{job_id}/mesh/floor_infill.glb",
            "manifest": manifest,
            "license": manifest.get("license"),
        }
    except Exception as e:
        raise HTTPException(500, f"Mesh conversion failed: {str(e)}")


@router.api_route("/jobs/{job_id}/mesh", methods=["GET", "HEAD"])
async def get_job_mesh_manifest(job_id: str):
    """Get the mesh manifest or default scene_mesh.glb for a job."""
    _validate_path_component(job_id, "job_id")
    job_dir = (DATA_ROOT / job_id).resolve()
    mesh_dir = job_dir / "mesh"
    manifest_file = mesh_dir / "mesh_manifest.json"
    if manifest_file.exists():
        with manifest_file.open("r", encoding="utf-8") as f:
            return json.load(f)
    mesh_file = mesh_dir / "scene_mesh.glb"
    if mesh_file.exists():
        return _create_model_response(mesh_file)
    raise HTTPException(404, "No converted mesh found for this job. Call /convert-to-mesh first.")


@router.api_route("/jobs/{job_id}/mesh/{filename:path}", methods=["GET", "HEAD"])
async def get_job_mesh_file(job_id: str, filename: str):
    """Serve a specific sub-mesh or scene_mesh.glb for a job."""
    _validate_path_component(job_id, "job_id")
    job_dir = (DATA_ROOT / job_id).resolve()
    mesh_dir = job_dir / "mesh"
    target = _safe_resolve_child(mesh_dir, filename)
    if target.exists() and target.is_file():
        return _create_model_response(target)
    raise HTTPException(404, f"Mesh file {filename} not found.")


@router.get("/furniture-catalog")
async def get_furniture_catalog():
    """List all available replacement 3D furniture models from the curated catalog."""
    catalog_json = CATALOG_DIR / "catalog.json"
    if catalog_json.exists():
        with catalog_json.open("r", encoding="utf-8") as f:
            return json.load(f)
    return []


@router.api_route("/furniture-catalog/{filename:path}", methods=["GET", "HEAD"])
async def get_furniture_catalog_model(filename: str):
    """Serve a GLB 3D model from the furniture catalog."""
    target = _safe_resolve_child(CATALOG_DIR, filename)
    if target.exists() and target.is_file():
        return _create_model_response(target)
    raise HTTPException(404, f"Furniture model {filename} not found.")


@router.post("/jobs/{job_id}/export-modified-scene")
async def export_modified_scene(job_id: str, payload: dict):
    """
    Accepts client overrides (moved objects, rotations, scales, replacements)
    and combines them into a final consolidated downloadable GLB.
    """
    _validate_path_component(job_id, "job_id")
    import trimesh

    job_dir = (DATA_ROOT / job_id).resolve()
    mesh_dir = job_dir / "mesh"
    master_mesh_path = mesh_dir / "scene_mesh.glb"
    if not master_mesh_path.exists():
        raise HTTPException(400, "Mesh scene not available. Convert scene to mesh first.")

    scene = trimesh.load(str(master_mesh_path), force="scene")
    overrides = payload.get("overrides", {})

    for _entity_id, trans in overrides.items():
        replacement_url = trans.get("replacement_url")
        if replacement_url:
            fname = Path(replacement_url).name
            rep_path = _safe_resolve_child(CATALOG_DIR, fname)
            if rep_path.exists():
                rep_scene = trimesh.load(str(rep_path), force="scene")
                pos = trans.get("position", [0, 0, 0])
                rep_scene.apply_translation(pos)
                scene.add_geometry(rep_scene.dump())

    out_file = mesh_dir / "modified_scene.glb"
    out_file.write_bytes(scene.export(file_type="glb"))
    return {
        "status": "success",
        "url": f"/api/reconstruction/jobs/{job_id}/mesh/modified_scene.glb",
        "size_mb": round(out_file.stat().st_size / (1024 * 1024), 2),
    }
