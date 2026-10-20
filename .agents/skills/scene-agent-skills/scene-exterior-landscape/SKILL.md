---
name: scene-exterior-landscape
description: "Build architectural exteriors with realistic grass, trees, terrain and water while retaining camera accuracy and manageable scene performance."
---

# Exterior and Landscape

Use layered, varied vegetation and coherent building-ground relationships.

## Inputs and result

**Inputs:** Building blockout, camera, site scale, vegetation references and asset rights.

**Result:** Exterior scene, vegetation strategy, water/terrain details and performance notes.

## Procedure

1. Lock building proportions and camera before scattering. Model contact with terrain, terrace/pool edges and drainage-relevant level changes.
2. Separate foreground hero plants, midground instances/proxies and distant vegetation. Use species-appropriate variation, leaf transmission and believable branching.
3. Scatter grass in density/height patches with randomized orientation and natural boundary masks. Evaluate blade detail by pixel footprint, not instance count.
4. Keep any image background or camera projection documented as 2D scenery. It does not satisfy a request for editable trees or unseen mountain geometry.
5. Measure load time and memory; verify horizon, tree/building overlap, water depth/reflection and nighttime green values in the hero render.

## Working reference

Read [landscape.md](../scene-toolkit/references/landscape.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
