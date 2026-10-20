---
name: scene-corona-materials
description: "Create or correct Corona Physical Materials, texture scale, roughness, glass and displacement in architectural scenes."
---

# Corona Materials

Build physically scaled, inspectable materials.

## Inputs and result

**Inputs:** Surface references, real scale, maps, host and lighting test.

**Result:** Material library, map roles and scale/relief evidence.

## Procedure

1. Classify texture maps by role and verify their actual encoding. Color and data maps need the appropriate color-management treatment.
2. Use `saPhysical`, `saGlass` and `saDisplacement` where suitable. Material helpers create materials but do not auto-assign them to every object.
3. Choose measured surface scale: plank width, stone course, fabric weave or concrete panel size. Roughness and normal/displacement serve different purposes.
4. For thick glass model thickness and refraction; for intentional thin sheets choose a compatible thin-surface strategy. Avoid double absorption from both shell geometry and thin assumptions.
5. Inspect material at normal and grazing angles under a neutral rig and final light. Report any substituted maps or missing assets.

## Working reference

Read [materials.md](../scene-toolkit/references/materials.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
