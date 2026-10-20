# Plan JSON → IFC4

The supported input is a calibrated structured plan, not arbitrary raw CAD/PDF/raster geometry. Agent/manual tracing is upstream. Use [plan.schema.json](../scripts/scene_agent/data/plan.schema.json). Version 1.0 supports straight oriented walls, rectangular slabs, rectangular door/window openings and multiple storeys. Curved walls, roofs, stairs, MEP, complex slab polygons and automatic room extraction are outside this exporter's current scope.

## Coordinates and scale

All lengths are metres. World XY is the plan and Z is up. Storey elevation is finished slab top; slabs extend downward by thickness and walls upward by height. A wall starts at `start`, ends at `end`, and its thickness extends **left** of that direction. Opening `offset` is measured along the segment from start; `sill` is above storey elevation. Do not mix centreline geometry with this one-sided contract.

For a rectified plan, `scene-agent scale --a 10 20 --b 210 20 --metres 8` gives 0.04 m/pixel. That scale is invalid for an unrectified oblique photograph. Preserve original coordinates, rectification transform and dimension evidence. Plan intersections need a chosen junction strategy; the demo uses overlapping reference-line corners and does not claim automatic junction cleanup.

```sh
scene-agent plan-check plan.json
scene-agent ifc plan.json --out building.ifc
scene-agent max-plan plan.json --out blockout.ms
```

## Semantic export

IFC4 output includes Project → Site → Building → Storey hierarchy, SI metre units, typed walls/slabs/doors/windows, actual `IfcOpeningElement` voids and filling relationships. Door/window geometry is simplified infill, not detailed parametric joinery. Stable element GlobalIds derive from project ID and element ID. Keep these IDs stable across revisions; relationship IDs may differ.

Provenance property sets preserve source ID and scale evidence. Schema validity does not establish architectural correctness. Check counts, dimensions, world placements, opening volumes and intersections, then use Archicad import/roundtrip checks. The IFC exporter is tested with IfcOpenShell 0.8.5; native Archicad translation needs host verification.
