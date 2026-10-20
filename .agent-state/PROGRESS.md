# SpaceGen Engineering System — Progress & State

**Last Updated:** 2026-10-20 18:05 IST  
**Branch:** `feat/splat-rendering-decision`  
**Execution Scope:** Splat & Pascal Co-Rendering Decision, Spark & WebGPU Incompatibility Analysis, Dual-Canvas Architecture, Depth Occlusion Proxy, Playwright E2E Verification  
**Status:** COMPLETED (All Checks Verified with Empirical Proof)

---

## 1. Verified CI/CD Suite Status

### Frontend (`frontend/`)
| Step | Command | Status | Result / Metrics |
| :--- | :--- | :--- | :--- |
| **Clean Install** | `npm ci` | **PASS** | 548 packages audited (0 peer dependency conflicts, no `--legacy-peer-deps`) |
| **Lint** | `npm run lint` | **PASS** | `eslint .` passed with 0 errors / 0 warnings |
| **Typecheck** | `npm run typecheck` | **PASS** | `tsc --noEmit` passed with 0 errors |
| **Unit Tests** | `npm run test` | **PASS** | 12/12 Vitest unit tests passed (including 7 splat decision tests) |
| **Production Build** | `npm run build` | **PASS** | Next.js 16.4.0 (Turbopack) compiled cleanly (including `/splat-prototype`) |
| **E2E Smoke & Decision Tests** | `npm run test:e2e` | **PASS** | 2/2 Playwright tests passed in 7.3s (`editor-smoke.spec.ts` & `splat-decision.spec.ts`) |

### Backend (`backend/`)
| Step | Command | Status | Result / Metrics |
| :--- | :--- | :--- | :--- |
| **Dependencies** | `pip install -r requirements.txt` | **PASS** | `open3d`, `trimesh`, `plyfile`, `fastapi`, `pytest`, `ruff` installed |
| **Linting** | `ruff check backend` | **PASS** | 0 errors, all checks passed |
| **Formatting** | `ruff format --check backend` | **PASS** | 27 files verified formatted |
| **Unit Tests** | `pytest backend/tests -v` | **PASS** | 13/13 tests passed in 0.88s |

---

## 2. ADR 001: Splat Rendering Decision Summary
- **Delivered ADR:** `docs/decisions/001-splat-rendering.md`
- **Prototype Route:** `/splat-prototype` (`frontend/app/splat-prototype/page.tsx`)
- **Visual Evidence:** `docs/decisions/splat-prototype-screenshot.png`
- **Evaluation Outcome:**
  - **Option (a) [Spark in WebGPURenderer]**: Crashes fatally (`renderer.properties` undefined, `getContext()` unsupported in WebGPU).
  - **Option (b) [Force Pascal to WebGL + Spark]**: Incompatible (Three.js `forceWebGL` uses WebGLBackend with TSL NodeMaterials; breaks Spark raw GLSL and Pascal postprocessing).
  - **Option (c) [Dual-Canvas Synced] (RECOMMENDED)**: Sustains 60 FPS on Hurstville 161K splats; loads `.sog`/`.spz`/`.ply`; supports OBB SDF box masking; solves depth occlusion using invisible scan proxy meshes (`colorWrite: false, depthWrite: true`).
  - **Option (d) [Native WebGPU Splatter]**: Long-term migration target when TSL SplatNode matures; currently lacks `.sog` decoder and cross-platform compute sorting.

---

## 3. Key Backend Safety & Architecture Fixes (Prior Phase)

1. **Dependency Splitting (`requirements.txt` vs `requirements-gpu.txt`):**
   - Added `open3d>=0.18.0`, `trimesh>=4.0.0`, `plyfile>=1.0.0`, `pytest>=8.0.0`, `pytest-asyncio>=0.23.0`, `ruff>=0.5.0` to `backend/requirements.txt`.
   - Quarantined heavy GPU dependencies (`torch`, `gsplat`, `nerfstudio`) in `backend/requirements-gpu.txt`.

2. **Cross-Platform Configuration & `DATA_ROOT` Normalization:**
   - Eliminated hardcoded `Path("D:/spacegen_data/reconstruction")` which created a literal `./D:` directory on non-Windows/Linux hosts.
   - Refactored `config.Settings` with cross-platform default `data_dir` (`Path(__file__).resolve().parent / "data"`), `reconstruction_root` property, and configurable tool binaries (`colmap_path`, `ffmpeg_path`, `nerfstudio_path`, `extra_tool_paths`).
   - Removed hardcoded Windows drive tool search paths (`C:/colmap`, `Anaconda3`, etc.) from `routes/reconstruction.py` in favor of dynamic `Settings.tool_paths`.

3. **Path Traversal Remediation:**
   - Implemented strict path resolution helper `_safe_resolve_child(base_dir, requested_path)` enforcing `is_relative_to(base_dir)` and rejecting `..` traversal sequences with HTTP 400.
   - Implemented `_validate_path_component` preventing traversal in `job_id` route parameters.
   - Secured all file-serving endpoints:
     - `/api/reconstruction/jobs/{job_id}/model/{filename:path}`
     - `/api/reconstruction/jobs/{job_id}/mesh/{filename:path}`
     - `/api/reconstruction/furniture-catalog/{filename:path}`

4. **Explicit Demo-Data Fallbacks:**
   - Added explicit `demo: bool = False` flag to `SceneGraph` schema (`backend/models/scene.py`).
   - Added `"demo": true` to `backend/data/demo_scene.json`.
   - Updated `backend/services/scene_analyzer.py` and `backend/routes/scenes.py` to always return `demo: True` when demo scenes or fallbacks are served.

5. **Shared Contracts & Testing:**
   - Established `backend/models/contracts.py` as canonical sync point with frontend Zod contracts, exporting `SceneGraph`, `SceneObject`, `EditProposal`, and `ReconstructionJobStatus`.
   - Added 13 Pytest cases covering health check, traversal rejection, explicit demo fallbacks, and cross-platform config.
   - Updated `.github/workflows/ci.yml` with dual-matrix CI running frontend and backend suites.
