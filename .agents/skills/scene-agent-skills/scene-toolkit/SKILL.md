---
name: scene-toolkit
description: "Route an architectural image, render or plan task to a concrete scene workflow; use when the request spans reference analysis, modeling, rendering or BIM."
---

# Scene Toolkit

Choose the deliverable and discover actual host capabilities.

## Inputs and result

**Inputs:** Input references, requested deliverable, available host and known scale.

**Result:** A scoped execution brief, tool availability table and next executable action.

## Procedure

1. Identify whether the user wants an image variant, editable 3D scene, BIM model or a combination. Preserve that output choice throughout the task.
2. Read only the workflow sections needed. For a multi-stage reconstruction route to reference analysis, camera match, modeling, materials, lighting and render review. For a plan route to plan-to-bim, then archicad-bridge.
3. Check available tools/plugins and their actual versions. Use the Python CLI for local file preparation; it does not itself control 3ds Max, Archicad or an image model.
4. Record measured / inferred / assumed / unresolved decisions. Produce a blockout before expensive furniture or vegetation. Keep checkpoints and compare the render to the source.
5. Choose a fitting skill or run `scene-agent --help`. If the Python package is not installed, add this skill's `scripts` directory to PYTHONPATH and run `python -m scene_agent --help` after installing dependencies; prefer the documented repository installation.

## Working reference

Read [workflow.md](references/workflow.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
