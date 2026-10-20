# Archicad handoff and verification

Use the official Graphisoft IFC import mechanism with a translator appropriate to the target Archicad version and intended native element mapping. Import geometry through Archicad's IFC commands. The bundled `archicad_inventory.py` script calls `ACConnection.connect()` and `GetElementsByType` to read element counts from the open project.

## Import procedure

1. Keep the generated IFC and its source plan/report together. Open a new Archicad project or a separate test copy of the destination.
2. Open/merge the IFC using the target version's supported IFC translator. Record translator name and options, including model filtering and geometry/type conversion.
3. Inspect SI units, project origin, storey names/elevations and building orientation. Measure a known wall length and one opening.
4. Inspect Wall/Slab/Door/Window classification. A visible imported element may be a Morph or Object instead of an editable native building tool element; report that distinction.
5. Verify real wall voids, door/window association, height/sill and slab elevation. Check sections and plan views, not just 3D shading.
6. Save a new PLN if requested. Export a roundtrip IFC and compare counts, dimensions and opening geometry.

## Python inventory

Install Graphisoft's official `archicad` package in an appropriate environment, start a supported Archicad host and open the test project. Run the bundled [inventory script](../scripts/archicad_inventory.py). Report the actual connection result and returned counts. Check native editability, dimensions and openings using the procedure above.

IFC schema, units and geometry have independent automated checks. Record the native import and PLN roundtrip in the target Archicad installation; see the [published evidence scope](https://github.com/prorenderbureau/scene-agent-skills/blob/main/docs/verification.md). A native creation adapter can use a documented Archicad C++ add-on command surface, with its own versioned contract and regression fixtures.
