# SpaceGen Engineering System — Progress & State

**Last Updated:** 2026-10-20 18:18 IST  
**Branch:** `feat/versioned-contracts`  
**Execution Scope:** Unified Versioned Data Model (Zod in `frontend/lib/contracts/*.ts`, Pydantic v2 in `backend/models/contracts.py`), Generated JSON Schemas in `contracts/schemas/`, CI Schema Drift Check, Realistic Room Fixture, Round-Trip Testing  
**Status:** COMPLETED (All Checks Verified with Empirical Proof)

---

## 1. Verified CI/CD Suite Status

### Contracts & Parity Suite
| Step | Command | Status | Result / Metrics |
| :--- | :--- | :--- | :--- |
| **Schema Drift & Parity Check** | `python scripts/check_contracts_sync.py` | **PASS** | 8/8 models verified 100% in sync across Pydantic v2, Zod, and JSON Schema; 0 drift |
| **JSON Schema Generation** | `python scripts/generate_contracts_schemas.py` | **PASS** | 8 canonical JSON Schemas generated in `contracts/schemas/` |
| **Realistic Room Fixture** | `fixtures/realistic_room.json` | **PASS** | Verified 2 doors, 1 window, 6 detections, provenance on every element |

### Frontend (`frontend/`)
| Step | Command | Status | Result / Metrics |
| :--- | :--- | :--- | :--- |
| **Clean Install** | `npm ci` | **PASS** | 621 packages audited |
| **Lint** | `npm run lint` | **PASS** | `eslint .` passed with 0 errors / 0 warnings |
| **Typecheck** | `npm run typecheck` | **PASS** | `tsc --noEmit` passed with 0 errors |
| **Unit Tests** | `npm run test` | **PASS** | 16/16 Vitest unit tests passed (including 4 contracts round-trip tests) |
| **Contracts Check** | `npm run contracts:check` | **PASS** | Schema drift script passed |
| **Production Build** | `npm run build` | **PASS** | Next.js 16.4.0 (Turbopack) compiled cleanly in 2.2s |
| **E2E Tests** | `npm run test:e2e` | **PASS** | 2/2 Playwright tests passed in 6.9s |

### Backend (`backend/`)
| Step | Command | Status | Result / Metrics |
| :--- | :--- | :--- | :--- |
| **Dependencies** | `pip install -r requirements.txt` | **PASS** | All dependencies satisfied |
| **Linting** | `ruff check backend` | **PASS** | 0 errors, all checks passed |
| **Formatting** | `ruff format --check backend` | **PASS** | 28 files verified formatted |
| **Unit Tests** | `pytest backend/tests -v` | **PASS** | 18/18 tests passed in 0.94s (including 5 contracts tests) |

---

## 2. Shared Versioned Data Model Summary
- **Frontend Zod Contracts:** `frontend/lib/contracts/`
  - `primitives.ts`: `Provenance`, `Vector3`, `Matrix4`, `BoundingBox3D`, `OrientedBoundingBox`
  - `scan.ts`: `ScanAsset`, `MaskRegion`
  - `interpretation.ts`: `RoomInterpretation`, `FloorPlane`, `WallInterpretation`, `OpeningInterpretation`, `DetectionInterpretation`
  - `proposal.ts`: `EditProposal`, `EditRecord`, `ProposalAsset`, `ProposalTransform`, `ProposalValidation`, `Violation`
  - `manifest.ts`: `ProjectManifest`, `AssetRef`, `Variant`
  - `index.ts`: Unified re-export and TypeScript type generation
- **Backend Pydantic v2 Contracts:** `backend/models/contracts.py`
  - Parallel strict Pydantic v2 models mirroring Zod schemas 1-to-1.
  - Backwards compatibility alias getters for legacy pipeline endpoints.
- **Canonical Schemas (`contracts/schemas/`):**
  - Generated draft 2020-12 JSON Schemas for `ProjectManifest`, `ScanAsset`, `MaskRegion`, `RoomInterpretation`, `EditProposal`, `EditRecord`, `AssetRef`, and `Variant`.
- **CI Enforcement:**
  - Added `contracts-schema-drift-check` job to `.github/workflows/ci.yml` that runs `python scripts/check_contracts_sync.py`.

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
