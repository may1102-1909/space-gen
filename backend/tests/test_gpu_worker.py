"""CPU tests for the splat -> per-object mesh worker (synthetic room, numpy renderer, fake SAM-like masks)."""

import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient

from gpu_worker.cameras import point_in_polygon, room_cameras
from gpu_worker.client import download_artifacts, submit_job, wait_job
from gpu_worker.mesh import export_glb, finalize, tsdf_mesh
from gpu_worker.render import NumpyRenderer
from gpu_worker.segment import segment, shell_prior
from gpu_worker.server import create_app
from gpu_worker.shell import bake_floor
from gpu_worker.splat import load_ply, save_ply, transform
from gpu_worker.synthetic import (
    CEILING,
    FLOOR_RGB,
    INTERPRETATION,
    OBJECTS,
    OUTLINE,
    FakeMaskDetector,
    build_scene,
    precision_recall,
)
from services.object_detection.geometry import fit_obb

VIEW = (192, 144)


@pytest.fixture(scope="module")
def scene():
    splat, gt = build_scene()
    renderer = NumpyRenderer()
    cams = room_cameras(OUTLINE, CEILING, width=VIEW[0], height=VIEW[1])
    detector = FakeMaskDetector(splat, gt, renderer)
    dets = [detector.detect_view(c) for c in cams]
    return splat, gt, renderer, cams, dets


def test_virtual_cameras_inside_room_and_cover_every_object(scene):
    splat, gt, renderer, cams, _ = scene
    poly = np.asarray(OUTLINE)
    assert len(cams) >= 16
    for cam in cams:
        c = cam.center
        assert point_in_polygon((c[0], c[2]), poly) and 0 < c[1] < CEILING
    seen_by = np.zeros(len(OBJECTS), int)
    for cam in cams:
        w = renderer.contributions(splat, cam, np.zeros((cam.height, cam.width), int), 1)[:, 0]
        for k in range(1, len(OBJECTS) + 1):
            seen_by[k - 1] += w[gt == k].sum() > 50  # > 50 pixels' worth of visible object
    print("\nviews seeing each object:", dict(zip([b.label for b in OBJECTS], seen_by.tolist())))
    assert (seen_by >= 3).all()


@pytest.mark.parametrize("method,min_p,min_r", [("contribution", 0.98, 0.9), ("center", 0.97, 0.85)])
def test_mask_lifting_assigns_gaussians_to_the_right_object(scene, method, min_p, min_r):
    splat, gt, renderer, cams, dets = scene
    n_fp = sum(d.score < 0.5 for ds in dets for d in ds)
    seg = segment(splat, cams, dets, renderer, method=method, bg_prior=shell_prior(splat, INTERPRETATION))
    assert n_fp > 0 and len(seg.instances) == len(OBJECTS)  # view-inconsistent false positives are dropped
    print(f"\n{method}: {n_fp} fake false-positive masks injected")
    for inst in seg.instances:
        k = int(np.bincount(gt[inst.indices]).argmax())
        p, r = precision_recall(inst.indices, gt, k)
        print(
            f"  {inst.label:6s} gt={OBJECTS[k - 1].label:6s} views={inst.n_views:2d} precision={p:.3f} recall={r:.3f}"
        )
        assert inst.label == OBJECTS[k - 1].label
        assert p >= min_p and r >= min_r


def test_per_object_tsdf_mesh_dimensions_and_glb(tmp_path):
    splat, gt = build_scene()
    renderer = NumpyRenderer()
    print()
    for k, box in enumerate(OBJECTS, start=1):
        sub = splat.subset(np.nonzero(gt == k)[0])
        obb = fit_obb(sub.means)
        mesh = finalize(tsdf_mesh(sub, obb, renderer), obb["yaw"])
        err = np.array(mesh.dimensions) - box.size
        print(f"  {box.label:6s} dims={np.round(mesh.dimensions, 3)} true={box.size} err_m={np.round(err, 3)}")
        assert np.abs(err[[0, 2]]).max() <= 0.045 and abs(err[1]) <= 0.02
        assert abs(mesh.rotation_y - box.yaw) < np.deg2rad(2)
        assert np.allclose(np.array(mesh.position)[[0, 2]], np.array(box.center)[[0, 2]], atol=0.03)
        assert len(mesh.faces) <= 20_000
        path = tmp_path / f"{box.label}.glb"
        export_glb(mesh, path)
        glb = trimesh.load(path, force="mesh")
        assert glb.visual.kind == "vertex"
        assert np.allclose(glb.extents, mesh.dimensions, atol=1e-3)
        assert abs(glb.bounds[0][1]) < 1e-4  # origin at the bottom
        assert np.allclose((glb.bounds[0] + glb.bounds[1])[[0, 2]] / 2, 0, atol=1e-4)  # ... centre


def test_floor_bake_fills_the_hole_under_a_removed_object():
    splat, gt = build_scene()
    sofa = OBJECTS[0]
    m = splat.means
    under = (
        (np.abs(m[:, 0] - sofa.center[0]) < sofa.size[0] / 2)
        & (np.abs(m[:, 2] - sofa.center[2]) < sofa.size[2] / 2)
        & (m[:, 1] < 0.05)
    )
    tex = bake_floor(splat, (gt == 0) & ~under, OUTLINE)  # real captures have no floor under furniture
    h, w, _ = tex.image.shape

    def texel(x, z):  # what Pascal samples at world (x, z): uv = (x, -z), repeat, flipY
        tu, tv = (x * tex.repeat[0]) % 1, (-z * tex.repeat[1]) % 1
        return tex.image[int((1 - tv) * h) % h, int(tu * w) % w] / 255

    assert 0.8 < tex.coverage < 0.97
    for x, z in [(sofa.center[0], sofa.center[2]), (0.3, 0.3), (4.0, 1.0)]:
        assert np.abs(texel(x, z) - (FLOOR_RGB + 0.08 * np.sin(3 * x))).max() < 0.07


def test_ply_roundtrip_and_scan_transform(tmp_path):
    splat, _ = build_scene()
    save_ply(splat, tmp_path / "s.ply")
    back = load_ply(tmp_path / "s.ply")
    assert np.allclose(back.means, splat.means, atol=1e-5) and np.allclose(back.colors, splat.colors, atol=1e-5)
    a = 2.0 * np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], float)  # yaw 90 deg, scale 2
    m = np.eye(4)
    m[:3, :3], m[:3, 3] = a, (1, 2, 3)
    moved = transform(back, m)
    assert np.allclose(moved.means, back.means @ a.T + (1, 2, 3))
    assert np.allclose(moved.scales, back.scales * 2)


def test_worker_http_protocol_end_to_end(tmp_path):
    splat, gt = build_scene()
    save_ply(splat, tmp_path / "scene.ply")
    renderer = NumpyRenderer()
    app = create_app(
        "s3cret",
        tmp_path / "jobs",
        detector_factory=lambda s: FakeMaskDetector(s, gt, renderer),
        renderer_factory=lambda: renderer,
        pipeline_kwargs={"view_size": VIEW},
    )
    with TestClient(app) as anon:
        assert anon.get("/jobs/x").status_code == 401
    with TestClient(app, headers={"Authorization": "Bearer s3cret"}) as client:
        job = submit_job(client, tmp_path / "scene.ply", INTERPRETATION, np.eye(4).ravel())
        status = wait_job(client, job, timeout=600, poll=0.5)
        assert status["status"] == "completed", status
        result = status["result"]
        assert sorted(o["label"] for o in result["objects"]) == sorted(b.label for b in OBJECTS)
        assert len(result["surfaces"]) == 1 + len(INTERPRETATION["walls"])
        paths = download_artifacts(client, job, result, tmp_path / "artefacts")
        assert all(p.stat().st_size > 0 for p in paths)
        assert client.get(f"/jobs/{job}/files/..%2Fscene.ply").status_code == 404
        print()
        for o in result["objects"]:
            print(f"  {o['label']:6s} {o['gaussianCount']} gaussians, {o['triangles']} tris, dims {o['dimensions']}")
