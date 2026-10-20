---
name: scene-lighting-atmosphere
description: "Reconstruct architectural daylight, dusk, night or interior illumination and atmospheric depth from a reference."
---

# Lighting and Atmosphere

Make lighting sources explain the image.

## Inputs and result

**Inputs:** Reference, camera, neutral material test and environment assets if available.

**Result:** Light rig, exposure notes, atmosphere settings and comparison render.

## Procedure

1. Determine sun direction from shadow/reflection evidence and infer sky softness. Avoid using color temperature alone to classify a scene.
2. Read one of the eight lighting recipes. Establish environment and key direction in a clay preview before adding practical lights.
3. Set an exposure baseline and keep it stable while comparing light ratios. Group environment, interior, exterior and decorative sources separately.
4. Add haze only at plausible scene scale; keep foreground visibility and depth layers. Verify reflections, transparent glass and fixture highlights together.
5. Record source sizes, units, temperatures, exposure and tone mapping. Compare against the hero reference and a neutral crop.

## Working reference

Read [lighting.md](../scene-toolkit/references/lighting.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
