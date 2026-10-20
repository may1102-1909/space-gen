---
name: scene-camera-match
description: "Match architectural perspective to reference landmarks or transfer a solved camera to Corona; use for camera calibration and perspective discrepancies."
---

# Camera Match

Solve and validate camera position, rotation and field of view.

## Inputs and result

**Inputs:** Image size, known 3D landmarks, matching 2D pixels and initial camera estimate.

**Result:** Camera solution, training/holdout residuals, overlay and optional MAXScript camera.

## Procedure

1. Use uncropped image dimensions and account for crop history. Select at least six non-coplanar training landmarks across depth, plus holdout points.
2. Prepare the documented camera JSON. The bundled local solver assumes centred principal point and no distortion; it is unsuitable for a single coplanar facade.
3. Run `scene-agent camera-fit landmarks.json --out camera.json`. Read convergence, all-points-in-front and holdout error separately.
4. Overlay projected landmarks and structural edges. If mismatch is systematic, investigate crop, lens shift, distortion or incorrect geometry instead of adding random geometry.
5. Run `scene-agent max-camera camera.json --out camera.ms` for a Corona camera. It changes active viewport/output size when executed; verify the host projection after transfer.

## Working reference

Read [camera.md](../scene-toolkit/references/camera.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
