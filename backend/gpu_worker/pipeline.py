"""Splat -> per-object GLBs + shell textures. Every stage is a plain function; this module only wires them."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Optional, Sequence

import numpy as np

from gpu_worker.cameras import room_cameras
from gpu_worker.mesh import export_glb, finalize, tsdf_mesh
from gpu_worker.render import Renderer
from gpu_worker.segment import segment, shell_prior
from gpu_worker.shell import bake_floor, bake_wall
from gpu_worker.splat import Splat
from services.object_detection.detectors import Detector2D, Keyframe

DEFAULT_LABELS = ("sofa", "armchair", "chair", "table", "desk", "bed", "lamp", "cabinet", "shelf", "tv", "plant", "rug")


def _save_png(path: Path, rgb: np.ndarray) -> None:
    from PIL import Image

    Image.fromarray(np.clip(rgb * 255, 0, 255).astype(np.uint8)).save(path)


def run_pipeline(
    splat: Splat,
    interpretation: dict,
    detector: Detector2D,
    renderer: Renderer,
    out_dir: Path,
    labels: Sequence[str] = DEFAULT_LABELS,
    method: str = "contribution",
    target_triangles: int = 20_000,
    view_size: tuple = (320, 240),
    progress: Optional[Callable[[int, str], None]] = None,
) -> dict:
    """`splat` must already be in the scene frame (apply splat.transform(scanToScene) first)."""
    report = progress or (lambda p, s: None)
    out_dir = Path(out_dir)
    (out_dir / "views").mkdir(parents=True, exist_ok=True)
    outline, ceiling = interpretation["outline"], float(interpretation["ceilingHeight"])

    cams = room_cameras(outline, ceiling, width=view_size[0], height=view_size[1])
    detections = []
    for i, cam in enumerate(cams):
        out = renderer.render(splat, cam)
        path = out_dir / "views" / f"view_{i:03d}.png"
        _save_png(path, out.features[..., :3])
        detections.append(detector.detect(Keyframe(path.stem, cam, path), labels))
        report(5 + int(40 * (i + 1) / len(cams)), f"detect {i + 1}/{len(cams)}")

    seg = segment(splat, cams, detections, renderer, method=method, bg_prior=shell_prior(splat, interpretation))
    report(50, f"segmented {len(seg.instances)} objects")

    objects = []
    for j, inst in enumerate(seg.instances):
        mesh = finalize(tsdf_mesh(splat.subset(inst.indices), inst.obb, renderer), inst.obb["yaw"], target_triangles)
        export_glb(mesh, out_dir / f"{inst.id}.glb")
        inst.indices.astype("<u4").tofile(out_dir / f"{inst.id}.idx.u32")
        w, h, d = mesh.dimensions
        objects.append(
            {
                "id": inst.id,
                "label": inst.label,
                "confidence": inst.confidence,
                "views": inst.n_views,
                "obb": inst.obb,
                "gaussianCount": int(len(inst.indices)),
                "gaussianIndices": f"{inst.id}.idx.u32",
                "mesh": f"{inst.id}.glb",
                "triangles": int(len(mesh.faces)),
                "dimensions": {"width": w, "height": h, "depth": d},
                "placement": {"position": mesh.position, "rotationY": mesh.rotation_y},
            }
        )
        report(50 + int(40 * (j + 1) / max(len(seg.instances), 1)), f"meshed {inst.id}")

    shell = seg.labels == 0
    poly = np.asarray(outline, float)
    center = (poly[:, 0].mean(), 0.0, poly[:, 1].mean())
    floor = bake_floor(splat, shell, outline)
    _save_png(out_dir / "floor.png", floor.image / 255.0)
    surfaces = [{"target": "slab", "texture": "floor.png", "repeat": floor.repeat, "coverage": floor.coverage}]
    for wall in interpretation.get("walls", []):
        tex = bake_wall(splat, shell, wall["start"], wall["end"], wall["height"], center)
        name = f"wall_{wall['id']}.png"
        _save_png(out_dir / name, tex.image / 255.0)
        surfaces.append(
            {"target": "wall", "wallId": wall["id"], "texture": name, "repeat": tex.repeat, "coverage": tex.coverage}
        )

    result = {"objects": objects, "surfaces": surfaces, "views": len(cams), "gaussians": len(splat), "method": method}
    (out_dir / "result.json").write_text(json.dumps(result, indent=2))
    report(100, "done")
    return result
