---
name: scene-model-low
description: "Build or simplify architectural assets for blockout, realtime review or a low-poly deliverable with explicit silhouette and draw-call constraints."
---

# Low Poly Modeling

Use geometry where it changes structure or the target silhouette.

## Inputs and result

**Inputs:** Scale, target frame, platform budget and editable source if available.

**Result:** Low-poly scene/asset, texture plan and silhouette comparison.

## Procedure

1. Read the low quality recipe and establish target image size or realtime platform. Asset triangle ranges are guidance, not a universal scene cap.
2. Block shell and openings first. Preserve doors, stairs and major reveals; bake relief that cannot affect silhouette.
3. Instance repeated elements, share materials and atlas suitable secondary assets. Do not automatically collapse the only editable master.
4. Compare silhouette at final screen coverage, grazing reflections and camera motion if relevant. Check draw calls and texture memory separately from triangles.
5. Deliver the simplified version plus an explicit list of details deferred to the high version.

## Working reference

Read [modeling.md](../scene-toolkit/references/modeling.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
