# Ellips — Sequential Bug-Fix & Phase-3 Stabilization Plan (For Coding Agents)

**Repository:** `D:\space-gen\space-gen` ([`tanishq-sol/space-gen`](https://github.com/tanishq-sol/space-gen))

**Context:** Read `HANDOFF.md`, `CLAUDE.md`, `.claude/skills/khasky-awesome-agents-md/AGENTS.md`, `.claude/skills/ponytail/AGENTS.md`, `PRODUCT.md`, and `DESIGN.md` before making any changes.

## Mandatory Owner Rules (Strict Enforcement)

* **Product Naming:** Display **Ellips** in all user-facing UI. Keep internal identifiers (`useSpaceGenStore`, repo paths, backend routes) unchanged.

* **Visual & Design System:** Light theme only, white + navy palette, Apple-style Liquid Glass (`.glass` / `.glass-clear` with 88% white fill for ≥4.5:1 contrast over dark scan pixels). Reserve navy exclusively for the single primary action per view (`Share`, `Apply`). Use System UI font (`Hanken Grotesk 600` only on the projects header and share title).

* **Zero AI Attribution:** Commits and PRs must carry **no AI attribution** (no `Co-Authored-By`, no session links, no `"Generated with"`).

* **Test & CI Integrity:** Never weaken, skip, or loosen an existing test. Read real CI artifacts (`"/c/Program Files/GitHub CLI/gh.exe" run download 40011149774`) before changing test-related code, and verify CI after pushing.

* **Branch Hygiene:** Keep `main` as the single source of truth; use short-lived `fix/**` or `feat/**` branches only to trigger CI, merge the same day, and delete the branch.

## Overview of Sequential Fix Tasks

| **Task ID** | **Target Area** | **Bug Observed in Screen Recording (20261023-2004-41.8675705.mp4) / CI** | **Verification Gate** | 
| **Fix 01** | **Local & Project `.glb` Upload (`00:12–00:18`)** | Clicking `↑ GLB` on `/` and selecting `01_tv.glb` fails with *"Open a saved project to upload GLB assets."* | Uploading any `.glb` on `/` works immediately via local `blob:` fallback or auto-created project | 
| **Fix 02** | **Remove Fake 5-Item Scan Overlay & Wire Real `objects.json` (`01:12–01:44`)** | `Detected Scan Objects` lists 5 hardcoded items (`Boucle 3-Seater Sofa` at `-2,0,0`, `Oak Dining Table` at `2,0,0`) that spawn in the wrong room locations | Hardcoded 5-item mock array is removed; real project `objects.json` + 24 `.glb` meshes from `425508aa52ce4cf3a998e9eba0d0055a` load at true scan coordinates | 
| **Fix 03** | **Clamp Splat Mask Above Floor & Sync Deletion (`01:16–03:33`)** | Extracting an item cuts a bright white rectangular hole through the terrazzo floor (`y = 0`), and deleting items in `Scene Hierarchy` leaves orphan wireframe cages in the 3D scene | `SplatExclusionBox` `minY` clamps to `floorY + 0.04m` (preserving floor splats); `deleteNode` removes linked exclusion boxes and wireframes | 
| **Fix 04** | **Render Solid Meshes & Room Shell in `Mesh` View (`01:24–01:48`, `03:29–03:33`)** | Switching to `Mesh` mode shows a blank white void with 5 empty wireframe boxes—no solid `.glb` furniture meshes and no `Wall`/`Slab` room geometry | `Mesh` mode renders actual `.glb` meshes (or solid shaded geometry) plus Pascal `Wall` and `Slab` nodes hydrated from `room_structure.json` | 
| **Fix 05** | **3D Transform Gizmos & CAD Tool Orbit Lock (`00:20–00:56`, `01:44–03:20`)** | Drawing walls/slabs flips the camera under the floor (`00:24`) without committing nodes to `Scene Hierarchy`, and selected furniture has no 3D drag/rotate gizmo | `OrbitControls` left-drag is locked while drawing tools are active; `<TransformControls>` attaches to selected `Item` nodes on the `XZ` floor plane | 
| **Fix 06** | **Ask Panel Chip Execution & HUD Overlap Cleanup (`00:44–03:33`)** | Clicking *"Move the sofa against the long wall"* only fills the text input without running; `Align room scan` overlaps `Splat/Mesh/Both` toggles; Next.js `1 Issue` badge covers the `Feather` slider | Starter chips submit or clearly trigger proposal preview; left inspector has bottom clearance; runtime console error causing `1 Issue` is resolved | 
| **Fix 07** | **Backend Post-Processing Filters (Colab Run Follow-Up)** | Real Colab run (`test scene.ply`) produced low-confidence detections (`0.27–0.51`), objects below the floor (`y ≈ -0.4`), and rug/armchair label mix-ups | Add confidence threshold filter, floor-elevation clamp (`y >= floor_y`), and aspect-ratio/height sanity checks for `rug` vs. `armchair` | 
| **Fix 08** | **UI Phase 3 CI Regressions (`feat/ui-phase-3`, Run `40011149774`)** | `interpretation-review.spec.ts:11` gets `""` instead of `"≈ 6.0 m (±14 cm est.)"`; `architectural-editing.spec.ts:36` & `drawings.spec.ts:10` time out under SwiftShader | All 24 Playwright E2E tests and all 8 CI jobs pass green on `feat/ui-phase-3` | 

## Detailed Step-by-Step Instructions for Each Agent Task

### Fix Task 01: Unblock `.glb` Uploads on Blank Editor (`/`) & Hydrate Saved Colab Projects

**Problem Seen at `00:12–00:18`:** When the user clicks `↑ GLB` in the left panel on `/` (`Untitled Project`) and selects `D:\space-gen\ellips-meshes\test-scene-2026-10-24\01_tv.glb`, the upload is rejected with `"Open a saved project to upload GLB assets."`

1. Inspect `frontend/components/panels/ScenePanel.tsx` (and the GLB upload handler in `frontend/lib/`).

2. When `projectId` is null (unsaved session on `/`):

   * Do **not** block `.glb` uploads with an error message.

   * Either auto-create a project record via `POST /api/projects` before uploading the `.glb`, **or** create a local object URL (`URL.createObjectURL(file)`), measure its bounding box via `THREE.Box3().setFromObject(gltf.scene)`, and immediately call `useScene.getState().createNode()` to spawn the `Item` node at the room center `[0, floorY, 0]`.

3. Ensure that opening an existing backend project (such as `425508aa52ce4cf3a998e9eba0d0055a` via **Import / Scenes**) automatically loads its `room_structure.json` and `objects.json` meshes into `useScene`.

### Fix Task 02: Remove Hardcoded Fake "Detected Scan Objects" & Wire Real Segmented Meshes

**Problem Seen at `01:12–01:44`:** `ScanSegmentationOverlay.tsx` displays 5 hardcoded objects (`Boucle 3-Seater Sofa 94% conf`, `Walnut Coffee Table 91% conf`, `Oak Dining Table 96% conf`, `Dining Chair North 89% conf`, `Dining Chair South 89% conf`) at hardcoded coordinates `(-2, 0, 0)`, `(0, 0, 0)`, `(2, 0, 0)`. Clicking **Extract Mesh** spawns boxes in the middle of empty floor walkways and on top of unrelated furniture.

1. Inspect `frontend/components/viewer/ScanSegmentationOverlay.tsx`, `frontend/lib/pascal/scanConverter.ts`, and `frontend/lib/pascal/seedScannedRoom.ts`.

2. Remove the hardcoded 5-item mock array (`Boucle 3-Seater Sofa`, etc.) from the production viewer flow (keep any required test fixtures strictly isolated to test/mock seeds if E2E tests assert on them—verify against `frontend/e2e/` before removing).

3. Wire the segmentation list to read the actual detected objects from the active project's `objects.json` payload (`/api/projects/{projectId}/objects`), using each object's real 3D bounding box (`center`, `size`/`dimensions`, `rotation`) and real `.glb` asset path (`/api/projects/{projectId}/meshes/{objectId}.glb`).

4. Hide the `Detected Scan Objects` floating card when no un-extracted objects exist for the current scan.

### Fix Task 03: Fix Splat Floor Punch-Through & Orphan Wireframe Cages on Delete

**Problem Seen at `01:16–03:33`:**

* At `01:16`, extracting `Boucle 3-Seater Sofa` creates a bright white rectangular cutout on the terrazzo floor because the `SplatExclusionBox` extends down to `y = 0` and zeroes out the floor splats underneath the furniture.

* At `03:05–03:33`, deleting furniture items via the trash icon in `ScenePanel.tsx` removes them from `Scene Hierarchy`, but their green/yellow OBB wireframe cages remain permanently stuck in the 3D viewport (`03:33`).

1. Open `frontend/lib/splat/splatCropManager.ts` and `frontend/lib/pascal/scanConverter.ts`:

   * When creating a `SplatExclusionBox` for an extracted or replaced furniture item, clamp its bottom vertical bound (`minY` or `center[1] - size[1] / 2`) to `floorElevation + 0.04` (4 cm above the detected floor slab plane). This ensures only the furniture Gaussians above the floor are masked while the floor splats remain visible underneath.

2. Open `frontend/lib/pascal/sceneBridge.ts` / `frontend/lib/store.ts` / `ScenePanel.tsx`:

   * When `deleteNode(nodeId)` is called on an `Item` node (or when the trash icon is clicked in the inspector), also remove any associated `SplatExclusionBox` from `splatCropManager` and clear its extracted state in `ScanSegmentationOverlay` so no orphaned wireframe cages remain in the canvas.

3. Only render OBB wireframe outlines in the 3D viewport when:

   * The corresponding `Item` node is actively selected (`selectedIds.includes(node.id)`), **or**

   * The active tool is `crop-box` or `eraser`, **or**

   * The user is actively hovering the item in the review list.

### Fix Task 04: Render Solid 3D Geometry & Room Structure in `Mesh` View Mode

**Problem Seen at `01:24–01:48` & `03:29–03:33`:** Clicking `Mesh` in the bottom-right view switcher (`Splat | Mesh | Both`) hides the splat and shows only empty wireframe bounding boxes floating in a white void—no solid furniture meshes and no walls or floor slab.

1. Inspect `frontend/components/viewer/SceneViewer.tsx` and the `Item` renderer in `@pascal-app/viewer` / `frontend/lib/pascal/`:

   * Ensure every `Item` node renders its loaded `.glb` mesh (`modelUrl`) with proper lighting (`ambientLight` + `directionalLight` / environment map) in both `Mesh` and `Both` view modes.

   * If an `Item` node has no `modelUrl` (or while a `.glb` is loading), render a clean, solid shaded architectural block with subtle edge lines rather than a hollow diagonal wireframe cage.

2. When a project or scan has `room_structure.json` (or when the user clicks **Review scan / Build editable room**), automatically populate Pascal `Wall` and `Slab` nodes inside the active `Level` so switching to `Mesh` mode displays the complete 3D room shell (walls + floor slab) alongside the furniture meshes.

### Fix Task 05: Lock Orbit Controls During CAD Drawing & Add 3D Transform Gizmos for Selected Items

**Problem Seen at `00:20–00:56` & `01:44–03:20`:**

* Selecting the `Wall`, `Slab`, `Measure`, or `Zone` tool and clicking/dragging on the canvas causes `OrbitControls` to rotate the camera underneath the floor (`00:24`), and drawn walls/slabs do not commit to `Scene Hierarchy`.

* Selecting a furniture item (`Dining Chair South`, `Oak Dining Table`) highlights its wireframe box, but there is no 3D gizmo in the viewport to drag or rotate it across the floor.

1. In `frontend/components/viewer/SceneViewer.tsx`:

   * Set `OrbitControls` `enableRotate={activeTool === 'select' && !isDraggingGizmo}` (or bind camera orbit strictly to right-click / middle-click while `wall`, `slab`, `zone`, `measure`, `crop-box`, or `eraser` tools are active).

   * Verify that a valid `Level` node ID is always set in `useViewer.getState().selection.levelId` on initial load so clicking start and end points with `WallTool` or `SlabTool` commits the new node into `useScene` and displays it in `Scene Hierarchy`.

2. Mount `@react-three/drei`'s `<TransformControls>` on the currently selected `Item` node when `activeTool === 'select'`:

   * Default to `mode="translate"` constrained to the horizontal floor plane (`showX={true} showY={false} showZ={true}`), with a toggle or shortcut (`R`) for `mode="rotate"` (`showX={false} showY={true} showZ={false}`).

   * On `onObjectChange` / `onMouseUp`, sync the updated `[x, y, z]` position and `rotation` back to `useScene.getState().updateNode(selectedId, ...)` and update its `SplatExclusionBox` if moved.

### Fix Task 06: Fix Ask Panel Starter Chips, Console Error (`1 Issue`), and Floating Panel Overlaps

**Problem Seen at `00:44–03:33`:**

* Clicking `"Move the sofa against the long wall"` at `00:44` only copies the string into the bottom text input (`00:48`) without executing.

* The red Next.js `N 1 Issue` dev overlay badge sits on top of the `Feather` slider (`02:25`), and the `Align room scan` popover covers the `Splat | Mesh | Both` buttons (`01:16`).

1. In `frontend/components/panels/ChatPanel.tsx`:

   * When a user clicks a `"Try asking"` starter chip, immediately submit the prompt (or auto-focus and trigger the action proposal flow) so the user sees immediate AI feedback rather than a static text input.

2. In `frontend/components/viewer/SceneViewer.tsx` and `frontend/components/panels/ScenePanel.tsx`:

   * Anchor the `Align room scan` popover above the top toolbar (or dock it with `bottom-28 right-4`) so it never collides with the bottom-right `Splat | Mesh | Both` / `Orbit | Walk` controls.

   * Add bottom padding (`pb-14`) to the left inspector scroll container so the `Feather` and `Mask Size` controls stay clear of the bottom-left status bar.

3. Open browser DevTools console on `http://localhost:3000`, identify the exact warning/error triggering the Next.js `1 Issue` badge, and fix the underlying root cause.

### Fix Task 07: Backend Segmentation Post-Processing (Colab Run Quality Fixes from `HANDOFF.md`)

**Problem Noted in `HANDOFF.md` (`test scene.ply` run):** Low detector confidence (`0.27–0.51`), objects placed below the floor (`y ≈ -0.4`), and label mix-ups (`rug` vs. `armchair`).

1. In `backend/` (segmentation / object extraction pipeline):

   * Filter out detected objects below a configurable minimum confidence threshold (e.g., `confidence < 0.35`).

   * Clamp object bounding boxes and extracted `.glb` mesh minimum `Y` coordinates to the detected room floor plane (`y >= floor_y`) so no furniture spawns at `y ≈ -0.4` underneath the slab.

   * Add a geometric sanity check on labels: if an object labeled `armchair` or `sofa` has height `< 0.18m` and large horizontal footprint, reclassify it as `rug` (and conversely, if an object labeled `rug` has height `> 0.45m`, reclassify by its second-highest furniture class logit).

2. Run `pytest` in `backend/` to verify all backend tests pass.

### Fix Task 08: Resolve UI Phase 3 CI Regressions (`feat/ui-phase-3`, Run `40011149774`)

**Problem Noted in `HANDOFF.md`:** Branch `feat/ui-phase-3` (`a3b2983`) failed CI run `40011149774` under software GL (SwiftShader \~0.5 FPS):

* `interpretation-review.spec.ts:11` expects the wall measurement label `"≈ 6.0 m (±14 cm est.)"` but receives `""`.

* `architectural-editing.spec.ts:36` and `drawings.spec.ts:10` hit the 5-minute timeout.

1. Download and inspect the Playwright report and traces first:

   ```
   "/c/Program Files/GitHub CLI/gh.exe" run download 40011149774 -D /tmp/ci-40011149774
   
   ```

2. Inspect why `interpretation-review.spec.ts:11` gets `""`:

   * Check whether the Phase 3 floating toolbar/panels hid the review trigger inside the **More** menu or prevented the wall dimension label DOM node from mounting/populating text on initial render. Ensure the label text renders deterministically without requiring extra frames under SwiftShader.

3. Inspect the traces for `architectural-editing.spec.ts:36` and `drawings.spec.ts:10`:

   * Check whether the tests are waiting on a toolbar button that moved into **"More"** or **"More tools"** overflow in Phase 3, or if CSS `backdrop-filter: blur(...)` on `.glass` overlays is stalling SwiftShader frame rendering during canvas pointer events.

4. Run the full verification gate locally before pushing:

   ```
   npm --prefix frontend run typecheck
   npm --prefix frontend run lint
   npm --prefix frontend run test
   npm --prefix frontend run test:e2e
   
   ```

5. Push to `feat/ui-phase-3`, verify all 8 CI jobs turn green via `"/c/Program Files/GitHub CLI/gh.exe" run list`, merge to `main`, and delete the temporary branch.