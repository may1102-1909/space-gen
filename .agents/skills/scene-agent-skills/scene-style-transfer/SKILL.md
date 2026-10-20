---
name: scene-style-transfer
description: "Restyle an architectural image or existing scene using one of 16 render, design and presentation recipes while preserving requested geometry."
---

# Render Style Transfer

Apply art direction without silently redesigning the building.

## Inputs and result

**Inputs:** Reference image/scene, desired style, geometry locks and output mode.

**Result:** A style recipe, rendered/image variants and a geometry consistency review when execution tools are available.

## Procedure

1. Run `scene-agent styles`; choose a requested style or the closest clearly stated base. Do not force a library style when the user describes a different one.
2. Create `scene-agent recipe STYLE --quality high --out recipe.json`. Recipes are planning data; they do not generate imagery.
3. For an image deliverable use an available image-editing tool with the reference and structural constraints. For editable 3D use the host material/light workflow and preserve the model.
4. Change palette, roughness, lighting and grading in controlled variants. Treat added arches, window changes or structural changes as redesign requiring task scope.
5. Compare silhouette and aperture landmarks. Watercolor is a derived illustration workflow; technical axonometric requires actual orthographic projection.

## Working reference

Read [styles.md](../scene-toolkit/references/styles.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
