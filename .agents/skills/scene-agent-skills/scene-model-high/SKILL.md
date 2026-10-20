---
name: scene-model-high
description: "Build production architectural geometry and furniture with physical bevels, clean normals, controlled subdivision and suitable UV density."
---

# High Poly Modeling

Prepare a production model whose detail survives a measured render crop.

## Inputs and result

**Inputs:** Approved blockout, camera, physical scale and material plan.

**Result:** Editable production geometry, UVs and topology/crop review.

## Procedure

1. Use high quality guidance after the blockout camera is stable. Match dimensions and openings before microdetail.
2. Choose connected topology for deforming/soft objects and controlled hard-surface panels for architecture. Quads are useful where subdivision needs them, not a universal metric.
3. Use real edge bevel sizes, explicit smoothing and adequate UV density. Subdivision must not shrink openings or soften structural corners.
4. Model cushions, seams, joinery and visible thickness selectively. Check supporting geometry from secondary views, not only the hero frame.
5. Audit open edges with intentional thin surfaces distinguished; verify material crops and save a new checkpoint.

## Working reference

Read [modeling.md](../scene-toolkit/references/modeling.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
