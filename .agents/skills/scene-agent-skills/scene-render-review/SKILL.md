---
name: scene-render-review
description: "Compare an architectural render with its references and prioritize camera, geometry, material, lighting and foliage corrections."
---

# Render Review

Use evidence to choose the next useful iteration.

## Inputs and result

**Inputs:** Reference, actual render, camera/scene settings and priority regions.

**Result:** Comparison findings, scorecard, correction list and remaining acceptance steps.

## Procedure

1. Compare the same crop, aspect ratio and display/color transform. Check structural landmarks before judging artistic similarity.
2. Review weighted regions: silhouette/openings, foreground objects, materials, light balance and vegetation. Exclude copied/projected backgrounds from geometry fidelity claims.
3. Inspect at final pixel size and zoomed diagnostic crops. Note clipped lights, denoising smears, floating objects, texture repetition and glass depth.
4. Change the smallest set of causes likely to fix the largest errors; keep before/after settings and checkpoints.
5. Report actual native render evidence and unresolved differences. Do not assign a high numerical accuracy percentage without an explicit reproducible metric.

## Working reference

Read [review.md](../scene-toolkit/references/review.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
