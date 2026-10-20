---
name: scene-archicad-bridge
description: "Bring a validated IFC reconstruction into Archicad and inspect element inventory using the documented Python connection when available."
---

# Archicad Bridge

Complete a verifiable IFC-to-Archicad handoff.

## Inputs and result

**Inputs:** Validated IFC, Archicad installation/version, translator settings and connection availability.

**Result:** Imported project, native element classification report and roundtrip comparison when host access exists.

## Procedure

1. Discover the installed Archicad version and an actual connection or UI surface. The bundled Python bridge is read-only inventory, not a native wall-creation API.
2. Import/open the IFC with an appropriate IFC translator. Check element type mapping, units, storeys, coordinates, materials and opening geometry before saving a new PLN.
3. Run the read-only inventory script only when the official archicad Python package and an open host connection are available.
4. Compare imported wall/door/window counts to the IFC report. An IFC object becoming a Morph is not equivalent to a fully editable native Wall.
5. Export a roundtrip IFC and compare dimensions/openings. When handing off to an Archicad operator, deliver IFC plus import steps and identify the native acceptance steps still to be performed. Report the actual completed steps and their files.

## Working reference

Read [archicad.md](../scene-toolkit/references/archicad.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
