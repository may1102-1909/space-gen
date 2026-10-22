# ADR 003: Reconcile duplicate T10/T11/T13 and splat-masking implementations

Status: accepted (2026-10-22)

## Context

`main` (PRs #6–#9) and `integration/phase2-5` each implemented T10 room structure, T11 3D object detection, T13 placement and a set of splat-masking fixes. `services/room_structure.py` (module) and `services/room_structure/` (package) cannot coexist, and integration's T12/T14/T18 work depends on its own T11/T13 APIs. We keep exactly one implementation per task, chosen on evidence: accuracy first, then features/coverage, then simplicity.

Each side was checked out in a temporary worktree and run against **both** sides' synthetic data (each generator was dumped to a common ground-truth format and fed to the other implementation, with one shared metric). Scripts lived in the session scratchpad; the numbers below are their output.

## T10 room structure — winner: main's package (`services/room_structure/`)

Shared metric: walls matched (≤15°, ≤15 cm), max wall offset (max of endpoint/midpoint distance), max corner error, ceiling error, opening edge error (horizontal / vertical). 18 cases = main's 5 rooms × 2 seeds + integration's 4 rooms × 2 seeds.

| implementation | cases fully recovered | main's rooms (arbitrary rotation) | integration's rooms (≤12° tilt, logit opacity, window view-through) | opening edge err h / v | runtime |
|---|---|---|---|---|---|
| integration module | 12/18 | 4/10 — fails all uniformly-rotated scans (needs a near-Y-up hint) | 8/8, wall ≤1.5 cm, corner ≤1.9 cm | ≤2.5 / ≤6.2 cm | ~0.5 s |
| main package (as merged in #7) | 18/18 | 10/10, wall ≤3.6 cm | 8/8, wall ≤5.6 cm, corner ≤5.6 cm | ≤5.3 / 5.0 cm (5 cm grid) | ~1.1 s |
| **main package, reconciled** | **18/18** | 10/10, wall ≤3.6 cm | 8/8, wall ≤5.6 cm | **≤1.3 / ≤0.95 cm** | ~0.7 s |

Main's package wins on robustness (gravity estimation for any scan orientation, up-sign resolution, scale warning, project-scoped job store, `.splat` loader). The reconciled version also:

- emits `OpeningInterpretation.offset` = wall.start → opening **centre** (the locked contract). Main emitted the start edge.
- ports the dropped module's sub-cell opening-edge refinement (5 cm → ~1 cm error),
- fills `floor.confidence` and `ceilingConfidence`, accepts raw 3DGS logit opacities, reads COLMAP `points3D.bin`,
- breaks an exact up-sign tie (no openings, floor/ceiling mass within 2 %) toward scan +Y. Without it, the empty non-Manhattan room came out upside down for one seed.

Ported tests: the second synthetic set (all 4 rooms × 2 seeds with the original tolerances), the logit-floater filter, image-opening relabel, the COLMAP txt/bin loaders, and "no open3d import". `tests/synthetic_rooms.py` stays as the T18b accuracy fixture. The T18b harness (`scripts/accuracy_report.py`, `tests/test_accuracy.py`) now calls `analyze_room`. Deleted: `services/room_structure.py`, its route and tests, and the unused `RoomStructureResult`/`RoomStructureJobStatus` pydantic models. Endpoint: `/api/room-structure` (main's). The frontend calls no room-structure or detection endpoint.

## T11 object detection — winner: integration (`lifting.py` + `/api/detection`)

Both pipelines were fed the same scene-frame points, cameras and 2D boxes. Mean IoU counts unmatched GT as 0.

| benchmark | integration mean IoU / R@0.5 / P@0.25 | main mean IoU / R@0.5 / P@0.25 |
|---|---|---|
| integration synthetic, clean (seeds 3–5, 6 objects, 20 views) | **0.93 / 1.00 / 1.00** | 0.66 / 0.67 / 0.68 |
| integration synthetic, moderate noise | **0.87 / 0.94 / 0.94** | 0.65 / 0.61 / 0.68 |
| integration synthetic, heavy noise | **0.71 / 0.83 / 0.74** | 0.51 / 0.50 / 0.68 |
| main synthetic fixture scan (seeds 7–9, 3 objects + 1-view lamp) | **0.984 / 1.00 / 1.00** | 0.972 / 1.00 / 1.00 |

Integration wins on accuracy on both benchmarks. It also has SAM 2 masks, view-agreement confidence, a merge that keeps user-reviewed detections, and the wall-point filter used by the T12 glue. Ported tests: single-view false positive rejected, empty-detections result, low-opacity splats not loaded. Deleted: main's `pipeline/runner/scan_folder/splat_io/evaluation.py`, `/api/object-detection`, `scripts/eval_detection.py` and their tests. Main's `requirements-gpu.txt` (adds `transformers`, which `GroundedSamDetector` needs) is kept. Not ported: main's labelled-box evaluation CLI for real scans. Follow-up: re-add it on top of `run_scan_detection` once hand-labelled scans exist.

## T13 placement — winner: integration (`lib/placement` rules/validate/solver/adapter)

| | integration | main |
|---|---|---|
| rules | 8 (inside-room, item/wall overlap, door clearance, walkway, front clearance, support, window sill) | the same 8 |
| opening offset convention | centre (contract) | **start edge** (contract violation) |
| tests | 58 (+3 ported) | 30 |
| same 30-item scene, median: validate 1 proposal | **0.14 ms** | 0.18 ms |
| same scene: solve 2 / 4 chairs, top-3 | **1.5 / 2.1 ms** | 6.6 / 8.5 ms |
| replaces `lib/ai/spatialLayoutSolver.ts` (T13 spec) | yes (deleted) | kept as a delegating shim |
| T14 dependents (`solvePlacement`, `toEditProposals`, `sceneFromPascalNodes`) | provided | absent |

Ported from main: floor-level `opening` kinds (open passages) get the door clearance zone, solver placements stay inside an L-shaped room, and the solver is deterministic. Deleted: `lib/placement/context.ts`, main's validator/solver/types/geometry, `lib/ai/spatialLayoutSolver.ts` and `tests/unit/placement.test.ts`.

## Splat masking — combined

Both sides fixed the double-applied mask: SplatEdits were added to the scene graph and also to `mesh.edits`, so a 25 % ghost rendered at about 6 %. Kept from integration: `lib/splat/maskEdits.ts`, lint-clean latest-props refs, the `__spacegenSplat` E2E hook and the pixel-diff masking E2E (mask, undo, redo, four angles, ghost). Kept from main: on-demand rendering (redraw only on camera, size, mesh or edit change, or Spark `onDirty`), and replacing an item without a scan no longer creates a demo scan (returns `maskRegion: null`). Main's structural E2E checks were added to the pixel spec through two new hook methods (`globalEditCount`, `edits`): no global edits, half-extent 0.275 → 0.425 → 0.275 on resize/undo, and exactly one ghost edit at 0.25.

## Consequences

- One router per feature: `/api/room-structure` (main), `/api/detection` (integration).
- Branches based on `integration/phase2-5` must merge the reconciled `main`. Code that read origin's start-edge opening offsets must use centres.
