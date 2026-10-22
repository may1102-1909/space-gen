# ADR 002: Gaussian Splat → Separated, Editable Objects (Per-Object Meshes on a Cloud GPU)

- **Status**: Proposed (spike; CPU prototype verified, GPU path unexecuted)
- **Date**: 2026-10-22
- **Branch**: `spike/gpu-object-meshing` (from `integration/phase2-5`)
- **Prototype**: `backend/gpu_worker/`, tests `backend/tests/test_gpu_worker.py`, Colab `notebooks/gpu_worker.ipynb`, deps `backend/requirements-gpu-worker.txt`
- **Inputs available**: a trained splat only (`.ply` / `.sog` / `.spz`), plus T10 room structure from that splat. No source photos, no COLMAP model.

## 1. Decision

1. **Segmentation without photos**: render the splat from **virtual cameras placed inside the T10 room outline**, run the existing T11 `Detector2D` (OWLv2 / Grounding DINO + SAM 2) on the renders, and lift masks to per-Gaussian labels **training-free** with **FlashSplat-style contribution accumulation** (sum of blending weights `α·T` per mask), cross-view association by Gaussian overlap, and a shell prior from T10. Implemented on **gsplat** (Apache-2.0) via the gradient trick, not FlashSplat's code (non-commercial).
2. **Per-object mesh**: **TSDF fusion of each object's own rendered depth + colour** from orbit cameras (open3d, MIT), largest component, quadric decimation to **20k triangles**, **vertex colours**, exported as GLB in meters, Y-up, OBB-aligned, origin bottom-centre, with measured dimensions and a placement (`position`, `rotationY`).
3. **Shell**: Pascal walls/slabs from T10, appearance **baked into textures that fit Pascal's existing world-planar UV mapping** (`material.texture.url` + `repeat`) — no Pascal schema change needed.
4. **Holes**: v1 hides the object's Gaussians (existing `MaskRegion` OBB masks / per-Gaussian index list) and covers floor/walls with the baked shell textures, whose holes are filled with OpenCV Telea inpainting. Learned inpainting is a later option.
5. **Worker**: the GPU box (Colab or any CUDA host) **exposes a small bearer-token job API through a tunnel**; the local FastAPI backend pushes the splat, polls, downloads artefacts and stores them in the project asset store.

Rejected for v1: 2DGS / GOF / PGSR / SuGaR (need re-training from source images and are non-commercial code), Gaussian Grouping / SAGA / OpenGaussian / Gaga / LangSplat (per-scene training from posed photos; see §2).

## 2. Method shortlist (skill-pack catalog + repo checks)

Sources: `.claude/skills/jaccen-gaussian-skills` (`3dgs-method-compare` fragments, `3dgs-methods-overview.csv`, `references/methods-semantic-editing.md`), repository license fields fetched from the GitHub API on 2026-10-22. The compare fragments do not cover FlashSplat, Gaussian Grouping, SAGA, OpenGaussian, Gaga or GOF; those rows come from the overview CSV. The catalog's GOF row is inconsistent (it cites arXiv 2312.13299, which is Self-Organizing Gaussian Grids, and a `Janotor/GOF` repo); GOF is arXiv 2404.10772, code `autonomousvision/gaussian-opacity-fields`.

### Segmentation (splat already trained, no photos)

| Method | How it labels Gaussians | Needs training / photos | Code license (repo field) | Fit |
| :--- | :--- | :--- | :--- | :--- |
| **FlashSplat** (ECCV'24) | Closed-form LP over accumulated α-blending contributions of 2D masks | No training; needs masks per view | Repo source headers: "free for non-commercial, research and evaluation use" (Inria-derived) | **Algorithm adopted, re-implemented on gsplat** |
| Gaussian Grouping (ECCV'24) | Per-Gaussian identity encoding trained with SAM masks | Re-trains the scene from posed images | Apache-2.0 top level; vendors Inria rasterizer (non-commercial) | No (training, photos) |
| SAGA (AAAI'25) | Contrastive per-Gaussian affinity features from SAM | Feature training per scene | Apache-2.0 top level; Inria rasterizer | No |
| OpenGaussian (NeurIPS'24) | Point-level open-vocab features, codebooks | Training from images | "Other" | No |
| Gaga (TMLR'26) | 3D-aware memory bank associates inconsistent SAM masks | Training from images | MIT (built on 3DGS stack — verify submodules) | Association idea only |
| LangSplat (CVPR'24) | Distilled CLIP features | Training from images | Inria-derived | No (semantic, not instance) |
| T11 lifting (in repo) | Splat-centre voting per view | No training | ours | Baseline (`method="center"`) |

### Gaussian → mesh

| Method | Input | License | Fit |
| :--- | :--- | :--- | :--- |
| **TSDF fusion of rendered depth** (open3d) | Any trained splat (we render depth ourselves) | open3d MIT | **Chosen**: works on our splat-only input, per object, CPU or GPU |
| 2DGS (SIGGRAPH'24) | Re-train with 2D disks from images | `hbb1/2d-gaussian-splatting`: "Other" (Inria-derived, research only per nerfbaselines) | No: no photos; non-commercial. gsplat's own `rasterization_2dgs` (Apache) could re-fit 2DGS to *rendered* views later |
| GOF (SIGGRAPH Asia'24) | Re-train; marching tetrahedra on opacity field | Inria-derived, research only | No |
| PGSR (TVCG'24) | Re-train with planar regulariser | "Other", research only | No |
| SuGaR (CVPR'24) | Re-train with surface alignment | "Other" (Inria-derived) | No |

### Detection / masks / runtime libs (commercial use)

gsplat Apache-2.0 · SAM 2 code+weights Apache-2.0 · Grounding DINO Apache-2.0 · OWLv2 (google `owlv2-base-patch16-ensemble`) Apache-2.0 · open3d MIT · trimesh MIT · OpenCV Apache-2.0. Avoid anything vendoring `graphdeco-inria/diff-gaussian-rasterization` (non-commercial) in the product path.

## 3. Pipeline (as implemented)

```
splat.ply ──load_ply/transform(scanToScene)──▶ scene frame (Y-up, m, floor y=0)
   │                                   T10 interpretation (outline, ceiling, walls)
   ▼                                              │
room_cameras(outline, ceiling) ◀──────────────────┘   ≤48 views, 90° hfov, eye 1.5 m
   │ render RGB (gsplat) ─▶ PNG ─▶ Detector2D (OWLv2/GDINO + SAM 2)  [T11, unchanged]
   ▼
segment(): per view label map → contributions (N × masks) → association → assignment
   │            shell_prior(T10)  ·  unseen completion  ·  floor-under-object rule
   ▼
per instance: orbit_cameras(OBB) → render depth/RGB of that object only → TSDF → mesh → GLB
shell:        bake_floor / bake_wall (Pascal UV frame) → PNG + repeat
result.json + obj_N.glb + obj_N.idx.u32 + floor.png + wall_*.png
```

**Virtual cameras** (`cameras.room_cameras`): positions at outline corners (inset 0.7 m along the diagonal), edge midpoints (inset 0.5 m) and the centroid; each corner/edge position looks at the centroid ±35°, the centroid looks 8 ways; target height 0.7 m (furniture). Positions outside concave outlines are dropped; detailed outlines are thinned to 48 views.

**Lifting** (`segment.segment`):
- *Contribution* (chosen): `C[i, m] = Σ_pixels∈mask m  α_i·T_i`. On gsplat this is `∂/∂f Σ render(f)·onehot(mask)` with per-Gaussian features `f`, because blending is linear in features (`GsplatRenderer.contributions`). Occluded Gaussians get ~0 weight, so they do not vote.
- *Center vote* (baseline, T11-style): depth-tested Gaussian centre votes for the label under it.
- *Association*: same-label detections whose majority Gaussians overlap ≥30% (of the smaller set) merge (union-find); groups seen in <2 views are dropped — this removes view-inconsistent false positives.
- *Assignment*: Gaussian → best instance k if its weight beats `prior × background`, where background is **summed only over views that detected k**. A view that missed the object is not evidence of absence; counting it (plain FlashSplat background) let three seeded misses in the only views that see the sofa's back cut sofa recall to 0.83.
- *Shell prior*: ×3 background weight for Gaussians within 4 cm of T10 floor/ceiling/wall planes; floor-band Gaussians inside a non-flat object's footprint stay shell (they are floor); never-observed Gaussians (total weight < 0.1) inside an instance's OBB join it (backs against walls).

**Mesh** (`mesh.tsdf_mesh`, `mesh.finalize`): 25 orbit views (12 azimuths × 15°/45° + top), valid depth = α ≥ 0.5 eroded by one screen-space Gaussian σ (edge-on Gaussians widen silhouettes), `UniformTSDFVolume` sized to the OBB with ≤256³ voxels and a 2-voxel truncation; largest connected component; quadric decimation to 20k triangles; rotate into the yaw frame; origin at bottom-centre. Vertex colours come from TSDF colour integration. UV texture atlases (xatlas, MIT) + texture baking are the upgrade when vertex colour detail is not enough. Note: open3d 0.20 `ScalableTSDFVolume` integrated nothing on this Windows build (empty point cloud on a trivial plane); `UniformTSDFVolume` works.

## 4. Shell textures in Pascal (checked in `frontend/node_modules/@pascal-app/*` 1.0.4)

- `core/dist/schema/material.js`: `MaterialSchema = { id?, preset?, properties?{color, roughness, metalness, opacity, transparent, side}, texture?{ url: AssetUrl, repeat?: [x, y], scale?: number } }`. No offset/rotation on `texture`. Scene/library materials (`slots` → `scene:<id>` / `library:<id>`) carry `MaterialPresetPayload { maps{albedoMap, normalMap, roughnessMap, …}, mapProperties{repeatX, repeatY, rotation, wrapS, wrapT, flipY, …} }` — also no offset.
- `core/dist/schema/nodes/wall.js`: `material`, `interiorMaterial`, `exteriorMaterial` (MaterialSchema), `slots` (face `a`/`b` → MaterialRef), `legacyFaceMaterials`, `faceRegions` (paint rectangles). `slab.js` / `ceiling.js`: `material`, `materialPreset`, `slots` (`surface`).
- `AssetUrl` (`asset-url.js`) accepts `asset://`, `artifact://<sha256>`, `blob:`, `data:image/`, app-relative `/…`, `https:` and `http://localhost` — so `/api/projects/{id}/assets/floor.png` is valid.
- UVs (`viewer/dist/systems/wall/wall-system.js` `applyWorldPlanarWallUVs`; `slab/slab-system.js`): **world-planar, in meters**. Slab caps: `uv = (x, -z)`. Wall faces: `v = 1 - y`, `u = ±z` when |n.x| dominates else `±x`, sign from the face normal. `viewer/dist/lib/materials.js` sets `RepeatWrapping`, `repeat`, sRGB, default `flipY`.

Consequence: a texture tiles every `P = 1/repeat` meters from the world origin. `shell._bake` bakes each face into a P-sized tile (P ≥ face span), rolls it so world coordinates land on the right texels, and flips for `flipY`. Use `slab.material.texture = {url, repeat}` and per-wall `interiorMaterial.texture` (or a scene material with `albedoMap` + `repeatX/Y`). Ceiling UVs were not checked — unverified. Diagonal walls get projection stretch up to √2 (same mapping as Pascal, so it is consistent, only lower texel density).

## 5. Holes where objects are removed

v1: (a) hide the object's Gaussians — today via the existing `MaskRegion` OBB (Spark `SplatEdit`, ADR 001), later via the exact index list `obj_N.idx.u32`; (b) the Pascal slab/wall textures are baked from shell Gaussians only, and unobserved texels (e.g. under the sofa) are Telea-inpainted; in the synthetic test the floor tile is 84.7% observed and inpainted texels under the removed sofa are within 0.07 of the true floor colour. Later: LaMa-class image inpainting on the baked tiles (check model license), or 3D Gaussian inpainting (Gaussian Grouping's removal+inpainting, InFusion-type methods) — license review needed before use.

## 6. Worker architecture

```
local FastAPI (Windows, AMD)                      GPU worker (Colab / CUDA box)
  dispatch job ── POST /jobs  (splat, interpretation, scanToScene) ──▶ queue (1 GPU lock)
  poll         ── GET  /jobs/{id}  {status, progress, step, error, result}
  fetch        ── GET  /jobs/{id}/files/{name}  (GLB, .idx.u32, PNG, result.json)
  store        ── ProjectRepository.save_asset → /api/projects/{id}/assets/{file}
  all requests: Authorization: Bearer $GPU_WORKER_TOKEN (hmac.compare_digest)
```

Push model chosen over a worker pull loop: the user's machine stays behind NAT with no inbound port; only the disposable GPU host is exposed (Cloudflare quick tunnel, same as `SpaceGen_Colab_GPU_Backend.ipynb`). Any CUDA box runs the same `gpu_worker.server.create_app`. Implemented: `gpu_worker/server.py` (worker side), `gpu_worker/client.py` (`submit_job` / `wait_job` / `download_artifacts`); not yet implemented: the local route/service that calls the client and writes assets + manifest updates (proposed `POST /api/projects/{id}/segment-objects` + job status, mirroring the T10 job pattern).

**Runtime per room — estimate, not measured on GPU.** Measured on this CPU (numpy renderer, 32k-Gaussian synthetic room): 32 views × detect+lift ≈ 40 s, TSDF mesh ≈ 8 s/object at 256³. For a 3M-Gaussian room on a **T4**: gsplat render + contribution backward is tens of ms per 320×240 view (gsplat paper class numbers), so 48 views < 10 s; OWLv2-base + SAM 2-small ≈ 0.3–1 s/view → ~0.5–1 min; per object 25 small renders + open3d integration (CPU) ≈ 5–10 s → 20 objects ≈ 2–3 min; load + T10 ≈ 0.5 min. **Expect ~5 min on T4, ~3 min on A100**, dominated by detection and CPU TSDF; first-run gsplat JIT compile adds minutes. Upload of a 700 MB `.ply` over home broadband likely dominates wall time — convert to `.spz`/`.sog` (PlayCanvas `splat-transform`, MIT) or decimate before upload; the worker currently reads binary little-endian `.ply` only.

## 7. Proposed contract additions (ask-first; not applied)

```python
class SegmentedObject(BaseModel):
    id: str                       # "obj_3"
    label: str                    # detector label
    confidence: float             # mean detector score of associated masks
    views: int                    # views that detected it
    obb: OrientedBoundingBox      # scene frame
    gaussianIndicesRef: str       # asset url of little-endian uint32 indices into the uploaded splat
    gaussianCount: int
    meshAsset: AssetRef           # GLB, meters, Y-up, origin bottom-centre, dimensions measured
    placement: ProposalTransform  # position = world bottom-centre, rotationY = yaw, scale = 1
    maskRegionId: Optional[str]   # MaskRegion hiding the splat part (existing contract)
    status: DetectionStatus       # proposed / accepted / rejected, as detections

class ShellSurfaceTexture(BaseModel):
    target: Literal["slab", "wall", "ceiling"]
    wallId: Optional[str]
    textureAsset: str             # PNG asset url
    repeat: Tuple[float, float]   # material.texture.repeat
    coverage: float               # observed fraction before inpainting

RoomInterpretation.objects: List[SegmentedObject] = []
RoomInterpretation.surfaces: List[ShellSurfaceTexture] = []
```

Mirror in `frontend/lib/contracts`; `AssetSource` gains `"segmented"`. The worker's `result.json` already has these fields (relative file names instead of URLs).

## 8. Evidence (CPU, Windows 11, Python 3.11.9, numpy 2.4.6, open3d 0.20.0)

`python -m pytest tests/test_gpu_worker.py -s -q` → `7 passed` (synthetic 6×5×2.6 m room, 32,025 Gaussians: shell 23,830, sofa 4,174, table 2,500, lamp 1,521; fake SAM masks dilated 1 px, 10% misses, 5 random false-positive masks; 192×144 views):

| Object | Contribution P / R | Center-vote P / R | TSDF mesh dims (m) vs true | Error (m) |
| :--- | :--- | :--- | :--- | :--- |
| sofa 2.0×0.9×0.85 | 0.995 / 1.000 | 0.990 / 0.958 | 2.035 × 0.894 × 0.888 | +0.035 / −0.006 / +0.038 |
| table 1.2×0.75×0.8 (yaw 20°) | 0.995 / 1.000 | 0.983 / 1.000 | 1.237 × 0.743 × 0.840 | +0.037 / −0.007 / +0.040 |
| lamp 0.35×1.6×0.35 | 0.995 / 0.922 | 0.988 / 0.866 | 0.384 × 1.593 × 0.386 | +0.034 / −0.007 / +0.036 |

- Horizontal +3.5–4 cm (≈1.8 cm/side) is the splat footprint (σ ≈ 2.4 cm here) plus TSDF edge bulge: fusing exact ray-cast depth of a 0.35 m box gave 0.40 m at 110³ and 0.386 m at 220³, so the bulge scales with voxel size. Real splats have smaller σ near surfaces (median max-scale 6.3 mm in `test scene.ply`).
- Lamp recall 0.92: its top (1.6 m) is near camera height (1.5 m), so it is barely observed.
- Before the detected-views-only background rule, sofa recall was 0.83; before the shell prior/floor rule, contribution precision was 0.91–0.93 (all false positives were floor hidden under objects).
- End-to-end HTTP test: job submitted through `client.submit_job` to `create_app` (TestClient), completed, 3 GLBs + 3 index files + 5 textures downloaded; missing token → 401; path traversal → 404.

**Real scan** (`test scene.ply`, 707,478,738 bytes, CPU, memory-mapped): binary little-endian, 2,997,785 Gaussians, 59 properties, SH degree 3; 200k-sample bounds min (−6.25, −7.69, −6.13) max (9.73, 4.95, 3.90), 1–99% box (−5.96, −1.14, −4.46)–(3.69, 1.53, 1.65); median max-scale 6.3 mm; 28.5% of Gaussians with opacity ≥ 0.5; inspect 1.5 s. T10 on a 400k sample **fails with the default +Y up hint** ("Ceiling estimate 0.07 m is implausibly low") and **succeeds with `up_hint=(0,-1,0)`**: ceiling 2.59 m, 35-vertex outline, 35 walls, 14 openings, gravity confidence 0.98, 0.8 s; after `scanToScene` the 1–99% height range is −0.03…2.64 m; `room_cameras` places 48 views, all inside the outline. The notebook uses −Y up.

## 9. Not verified / needs a GPU run

- `GsplatRenderer` (render + gradient-based contributions) and `notebooks/gpu_worker.ipynb` have **never run** (no CUDA on this machine). Notebook cell 3 repeats the synthetic test on gsplat for comparison with the CPU numbers above.
- Real-scene segmentation quality with OWLv2/Grounding DINO + SAM 2 on *rendered* splat views (render artefacts, floaters), mesh quality on real objects, and all runtime figures in §6.
- gsplat's handling of arbitrary feature width with `render_mode="RGB+ED"` for the fake detector path.
- Pascal ceiling UV mapping; wall face `a`/`b` ↔ interior mapping when applying textures.
- `.sog` / `.spz` input (convert to `.ply` first).
