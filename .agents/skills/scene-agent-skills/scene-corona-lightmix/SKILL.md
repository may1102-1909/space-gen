---
name: scene-corona-lightmix
description: "Create or review organized Corona LightMix groups without deleting existing render elements or silently changing the lighting balance."
---

# Corona LightMix

Separate controllable lighting contributions.

## Inputs and result

**Inputs:** Native scene lights and intended environment/interior/exterior groups.

**Result:** Named LightSelect/LightMix elements and verified group membership.

## Procedure

1. Inspect current render elements and any existing LightMix. Keep unrelated AOVs intact.
2. Partition explicitly selected lights into groups by purpose and optionally storey. Include the environment once.
3. Call `saLightMix #(#("Interior", #(lightA,lightB)), #("Exterior", #(lightC)))` with actual valid nodes. Existing SA groups trigger an error to prevent duplicates.
4. Verify unassigned lights and overlapping membership; document deliberate overlaps. The helper leaves existing intensity/color arrays unchanged.
5. Render a small native test before claiming LightMix is functional. Large corrections are a signal to rebalance physical source intensities.

## Working reference

Read [corona.md](../scene-toolkit/references/corona.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
