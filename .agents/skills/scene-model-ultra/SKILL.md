---
name: scene-model-ultra
description: "Increase detail for architectural hero closeups when a production model fails a defined silhouette, surface or displacement target."
---

# Very High Poly Modeling

Spend detail only where the closeup demonstrates a deficit.

## Inputs and result

**Inputs:** High-detail model, exact crop/output resolution and memory budget.

**Result:** Hero detail version with measured improvement and cost comparison.

## Procedure

1. Compare the high version at 100 percent final output. Identify actual silhouette, folds, edge or relief errors.
2. Retain an editable control cage. Use selective subdivision, render-time displacement and proxies for repeated heavy assets.
3. Read very-high quality guidance; evaluate one asset before increasing the whole scene. Record peak RAM/VRAM, load time and render cost.
4. Check displacement bounds in millimetres, texture filtering and grazing-angle silhouettes. More polygons cannot repair a wrong camera or shader.
5. Keep the heavier version only if the target crop visibly improves. Deliver both levels when useful for review.

## Working reference

Read [modeling.md](../scene-toolkit/references/modeling.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
