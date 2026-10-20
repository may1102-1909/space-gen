---
name: scene-plan-to-bim
description: "Convert a dimensioned or traced floor plan into validated structured geometry and an IFC4 model with walls, slabs, doors, windows and openings."
---

# Plan to BIM

Turn plan evidence into semantic, checkable building elements.

## Inputs and result

**Inputs:** Raster/vector plan, known dimension, storey heights and opening schedule.

**Result:** Validated plan JSON, IFC4 and an assumptions/import report.

## Procedure

1. Rectify the plan if necessary and calibrate from a known dimension. OCR/tracing is agent-assisted or manual in this release, not an implemented automatic detector.
2. Write plan JSON against the bundled schema: metres, oriented wall reference lines, elevations, rectangular slabs and opening offsets. Record measured vs assumed scale.
3. Run `scene-agent plan-check plan.json`; correct bounds, duplicate IDs and overlapping openings before export.
4. Run `scene-agent ifc plan.json --out model.ifc`. The exporter generates typed walls/slabs, real void relationships and simplified door/window infills.
5. Verify counts, units, wall volumes and storey placements. Route Archicad import/roundtrip checks to scene-archicad-bridge; do not call this a surveyed or construction-ready design.

## Working reference

Read [bim.md](../scene-toolkit/references/bim.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
