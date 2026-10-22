"""Per-object mesh: TSDF fusion of the object's own rendered depth/RGB (open3d), then a web-ready GLB.

Output frame (Pascal item asset): meters, Y-up, local axes aligned with the object's yaw OBB,
origin at the bottom centre of the mesh bounds. Placement = (world bottom centre, rotationY = yaw).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from gpu_worker.cameras import orbit_cameras
from gpu_worker.render import Renderer
from gpu_worker.splat import Splat
from services.object_detection.geometry import yaw_axes


@dataclass
class ObjectMesh:
    vertices: np.ndarray  # (V, 3) item-local frame
    faces: np.ndarray  # (F, 3)
    colors: np.ndarray  # (V, 3) 0..1
    dimensions: tuple  # (width x, height y, depth z) meters
    position: tuple  # world bottom centre
    rotation_y: float


def tsdf_mesh(
    splat: Splat, obb: dict, renderer: Renderer, voxel: Optional[float] = None, alpha_min: float = 0.5,
    erode_sigmas: float = 1.0, trunc_voxels: float = 2.0,
):  # fmt: skip
    """Fuse depth+colour from orbit views of the isolated object; returns an open3d TriangleMesh (world frame).

    Edge-on Gaussians widen the opaque silhouette by about one footprint sigma, and fusing those halo depths
    fattens the mesh, so each view's valid-depth mask is eroded by `erode_sigmas` screen-space sigmas.
    """
    import cv2
    import open3d as o3d

    size = np.asarray(obb["size"], float)
    # TSDF bulges ~1.5 voxels at convex edges, so use the finest grid the 256^3 cap allows (~1 cm for a sofa)
    voxel = voxel or float(np.clip((np.linalg.norm(size) + 0.1) / 256, 0.004, 0.02))
    # Uniform volume around the object: ScalableTSDFVolume integrated nothing with open3d 0.20 on Windows.
    length = float(np.linalg.norm(size)) + 8 * voxel
    res = min(int(np.ceil(length / voxel)), 256)
    vol = o3d.pipelines.integration.UniformTSDFVolume(
        length=length,
        resolution=res,
        sdf_trunc=trunc_voxels * length / res,
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8,
        origin=np.asarray(obb["center"], float) - length / 2,
    )
    scale = float(np.median(splat.scales.mean(axis=1)))
    for cam in orbit_cameras(obb["center"], size):
        out = renderer.render(splat, cam)
        valid = out.alpha >= alpha_min
        if valid.any() and erode_sigmas > 0:
            sigma_px = erode_sigmas * scale * cam.K[0, 0] / float(np.median(out.depth[valid]))
            r = int(np.ceil(sigma_px))
            if r:
                valid = cv2.erode(valid.astype(np.uint8), np.ones((2 * r + 1, 2 * r + 1), np.uint8)) > 0
        depth = np.where(valid, out.depth, 0.0).astype(np.float32)
        rgb = np.clip(out.features[..., :3] / np.maximum(out.alpha, 1e-6)[..., None], 0, 1)
        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
            o3d.geometry.Image((rgb * 255).astype(np.uint8)),
            o3d.geometry.Image(depth),
            depth_scale=1.0,
            depth_trunc=100.0,
            convert_rgb_to_intensity=False,
        )
        K = cam.K
        # open3d unprojects integer pixel coords; our rasterizer samples pixel centres (u + 0.5)
        intr = o3d.camera.PinholeCameraIntrinsic(cam.width, cam.height, K[0, 0], K[1, 1], K[0, 2] - 0.5, K[1, 2] - 0.5)
        ext = np.eye(4)
        ext[:3, :3], ext[:3, 3] = cam.R, cam.t
        vol.integrate(rgbd, intr, ext)
    return vol.extract_triangle_mesh()


def finalize(mesh, yaw: float, target_triangles: int = 20_000) -> ObjectMesh:
    """Keep the largest connected piece, decimate, rotate into the OBB frame, origin at the bottom centre."""
    if len(mesh.triangles):
        cluster, counts, _ = mesh.cluster_connected_triangles()
        mesh.remove_triangles_by_mask(np.asarray(cluster) != int(np.argmax(counts)))
    if len(mesh.triangles) > target_triangles:
        mesh = mesh.simplify_quadric_decimation(target_number_of_triangles=target_triangles)
    mesh.remove_degenerate_triangles()
    mesh.remove_unreferenced_vertices()
    v = np.asarray(mesh.vertices)
    if len(v) == 0:
        raise ValueError("TSDF produced an empty mesh")
    ax, az = yaw_axes(yaw)
    local = np.stack([v @ ax, v[:, 1], v @ az], axis=1)
    lo, hi = local.min(axis=0), local.max(axis=0)
    origin = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    world_origin = origin[0] * ax + np.array([0, origin[1], 0]) + origin[2] * az
    return ObjectMesh(
        vertices=local - origin,
        faces=np.asarray(mesh.triangles),
        colors=np.asarray(mesh.vertex_colors) if mesh.has_vertex_colors() else np.full((len(v), 3), 0.7),
        dimensions=tuple(float(x) for x in hi - lo),
        position=tuple(float(x) for x in world_origin),
        rotation_y=float(yaw),
    )


def export_glb(obj: ObjectMesh, path: Path) -> None:
    import trimesh

    colors = np.hstack([obj.colors, np.ones((len(obj.colors), 1))])
    trimesh.Trimesh(obj.vertices, obj.faces, vertex_colors=(colors * 255).astype(np.uint8), process=False).export(
        path, file_type="glb"
    )
