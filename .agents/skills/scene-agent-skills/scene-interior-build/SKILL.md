---
name: scene-interior-build
description: "Reconstruct an architectural interior from images or plans, including furniture, glazing, circulation, materials and visible lighting."
---

# Interior Reconstruction

Build a coherent room beyond the hero image.

## Inputs and result

**Inputs:** References, plan if present, known dimensions and hero view.

**Result:** Editable interior with furniture, spatial checks and rendered evidence.

## Procedure

1. Resolve room shell, apertures and ceiling heights before furniture. Route perspective questions to camera matching.
2. Create furniture from dimensions or licensed assets; preserve frame, cushion, seam and textile distinctions. Avoid claiming a generic sofa is an exact product match.
3. Check door swings, walkways, curtain clearances, stair openings and floor contact in plan and secondary views.
4. Assign physically scaled materials and reproduce visible light source placement. Glass needs both interior visibility and credible reflections.
5. Compare hero view and at least one secondary spatial view; report unobserved rooms as inferred rather than reconstructed facts.

## Working reference

Read [interior.md](../scene-toolkit/references/interior.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
