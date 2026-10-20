---
name: scene-batch-variants
description: "Plan and execute controlled architectural style, lighting or camera variants with shared geometry and comparable render settings."
---

# Batch Scene Variants

Produce comparable alternatives and avoid uncontrolled combinatorial rendering.

## Inputs and result

**Inputs:** Base scene, selected variations, camera locks and compute/output limits.

**Result:** Variant manifest, images/scenes, contact sheet and change log.

## Procedure

1. Define a finite matrix of requested styles, lights and cameras; create stable variant IDs and output paths.
2. Freeze geometry, camera and random seeds when comparing style/light only. Change one category at a time where possible.
3. Prepare recipes with the CLI, then use an actual host/image tool to execute. Submit farm jobs through the user's render-farm scheduler when farm execution is required.
4. Render small previews first, inspect representative results and run final outputs only for intended variants. Save per-variant settings and failures.
5. Compare the contact sheet, label image-only variants and package successful outputs with a manifest.

## Working reference

Read [batch.md](../scene-toolkit/references/batch.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
