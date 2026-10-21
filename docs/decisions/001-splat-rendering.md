# ADR 001: Gaussian Splat & Pascal 3D Scene Co-Rendering Architecture

- **Status**: Accepted
- **Date**: 2026-10-20 (evidence re-measured 2026-10-21)
- **Prototype Route**: [`/splat-prototype`](http://localhost:3000/splat-prototype)
- **Target Scene**: `public/Hurstville_Museum_Gallery.sog` (161,576 splats, 1,956,196 bytes)
- **Versions**: three r186, `@sparkjsdev/spark` 2.1.0, Pascal `@pascal-app/*` 1.0.4, Chromium via Playwright 1.64.1

## 1. Decision

Use **candidate (c): two stacked canvases**. A classic `THREE.WebGLRenderer` + Spark renders the splat as an unchanged background layer. Pascal's `WebGPURenderer` renders editable nodes in a transparent foreground canvas. The editor camera is copied to the splat camera every frame. Masking is done with Spark `SplatEdit`/`SplatEditSdf` boxes on the splat mesh.

Candidates (a) and (b) were attempted in the browser and drew nothing (section 3). Candidate (d) was not prototyped.

## 2. Candidates

| | (a) Spark on Pascal's `WebGPURenderer` | (b) `WebGPURenderer({ forceWebGL: true })` + Spark | (c) Dual canvas (chosen) | (d) Native WebGPU splat renderer |
| :--- | :--- | :--- | :--- | :--- |
| Attempted | Yes, scripted (section 3) | Yes, scripted (section 3) | Yes, in production editor | No |
| Result | No exception; 0 of 65,536 px drawn; `THREE.NodeBuilder` rejects Spark's materials | Same as (a) | Draws (control: 47,981 of 65,536 px) | Not measured |
| FPS on the 161,576-splat scan | n/a (draws nothing) | n/a (draws nothing) | 60 fps (display-capped) on hardware GPU; 0.8 fps on software GL (section 4) | Not measured |
| Masking | n/a | n/a | Spark `SplatEdit` box SDFs, verified by pixel diffs in e2e | Would need custom WGSL |

## 3. Candidates (a) and (b): what actually happens

`frontend/lib/splat/rendererCandidates.ts` runs each candidate in the page: it creates the renderer, constructs `new SparkRenderer({ renderer })`, loads the scan with `SplatMesh`, renders up to 60 frames, and counts non-transparent pixels read back from the canvas. The same harness then runs a **control** on a classic `THREE.WebGLRenderer`, so an empty result cannot be a harness artifact. `/splat-prototype` shows the result when (a) or (b) is selected, and `frontend/tests/e2e/splat-decision.spec.ts` logs it and asserts the control draws.

Observed on 2026-10-21 (headless Chromium, Windows 11, AMD Radeon integrated GPU via ANGLE D3D11, 256×256 canvas):

```text
(a) webgpu
  navigator.gpu adapter: available
  WebGPURenderer.init() ok (WebGLBackend)
  new SparkRenderer({ renderer }) ok
  SplatMesh loaded (161576 splats)
  renderer.render(scene, camera) x177 returned; pixels drawn: 0 of 65536
  console.error: THREE.NodeBuilder: Material "RawShaderMaterial" is not compatible.
  console.error: THREE.NodeBuilder: Material "ShaderMaterial" is not compatible.

(b) webgpu-force-webgl
  WebGPURenderer.init() ok (WebGLBackend)
  ... x180 returned; pixels drawn: 0 of 65536, same two NodeBuilder errors

control: THREE.WebGLRenderer
  renderer.render(scene, camera) x13 returned; pixels drawn: 47981 of 65536
```

With software GL (SwiftShader, `E2E_SOFTWARE_GL=1`) the outcome was the same: 15 and 21 frames drew 0 px, and the control drew 47,965 px.

What this shows:
- Spark 2.1.0 renders through `RawShaderMaterial`/`ShaderMaterial`. `WebGPURenderer` only compiles node materials, so it logs the errors above and skips those draws. It does not throw, which is why nothing visibly crashes.
- **Not measured**: Spark on the true `WebGPUBackend`. `navigator.gpu.requestAdapter()` returned an adapter, but three logged `WebGPURenderer: WebGPU is not available, running under WebGL2 backend.` and used `WebGLBackend` for (a) too. The NodeBuilder errors come from the node material pipeline that both backends share, so the same result is expected on `WebGPUBackend`. That is an inference, not an observation.
- An earlier version of this ADR quoted a `TypeError: renderer.properties is undefined` crash. That text was a hard-coded simulation in the prototype and was never observed. It has been removed.

## 4. Candidate (c): measured performance

`frontend/tests/e2e/splat-fps.spec.ts` loads the scan, waits 2 s, and counts `requestAnimationFrame` callbacks for 5 s on `/splat-prototype` and in the editor. The results are written to `test-results/screenshots/fps-*.json`. Viewport 1280×720.

| Renderer (WebGL `UNMASKED_RENDERER`) | `/splat-prototype` | Editor (`/`, scan loaded) |
| :--- | :--- | :--- |
| ANGLE D3D11, AMD Radeon (integrated) | 60.0 fps, p95 frame 16.8 ms | 60.1 fps, p95 frame 16.8 ms |
| SwiftShader (software; what CI runners get) | 0.86 fps, p95 1,450 ms | 0.80 fps, p95 1,600 ms |

Limits of these numbers:
- 60 fps is the display/rAF cap. GPU frame time and headroom were **not measured**.
- Only the 161,576-splat scan was measured. Earlier claims of "tested scalable to 2M splats", "~84 MB VRAM" and "sub-millisecond worker sort" were **never measured** and have been removed.
- No mobile or discrete-GPU measurements.

## 5. How (c) is wired

1. `SplatBackgroundCanvas` (WebGL2 + Spark) sits under Pascal's `<Viewer>` (WebGPU, transparent). `ScanCameraBridge` copies the Pascal camera into a ref every frame, and the splat loop reads it. The editor's camera is driven by drei `OrbitControls`.
2. The splat mesh's matrix is the scan node's stored `metadata.scanToScene` (4×4, Y-up, meters, floor y=0). The source splat data is never modified.
3. Mask regions live on the Pascal scan node (`metadata.maskRegions`, contract `MaskRegion`) and persist in the project manifest. Each enabled region becomes one Spark `SplatEdit` with a box `SplatEditSdf`, attached only to `mesh.edits` (see `lib/splat/maskEdits.ts`). Spark evaluates edits after the mesh transform, so OBBs are authored in scene frame.
4. Optional occlusion: a scan proxy mesh with `colorWrite: false, depthWrite: true` in the foreground hides items placed behind scanned walls.

## 6. Evidence

- `npx playwright test splat-decision splat-fps` (requires `npm run build:e2e`) reproduces sections 3–4. Screenshots and JSON go to the gitignored `frontend/test-results/screenshots/`.
- Masking is checked by `splat-masking.spec.ts` and `phase1-editor-loop.spec.ts` with pixel statistics inside the mask's projected screen box (replace changes it, undo restores it exactly).

![Splat Decision Prototype Verification](./splat-prototype-screenshot.png)
