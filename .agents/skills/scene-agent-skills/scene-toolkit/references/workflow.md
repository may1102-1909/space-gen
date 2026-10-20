# Architectural workflow contract

## Choose the actual product

| Requested output | Working path | Evidence of completion |
|---|---|---|
| Restyled image | Reference + geometry locks → available image editing tool → comparison | Actual image file and structural comparison |
| Editable 3D | Reference → blockout → camera → production geometry → materials/light → native render | Native scene reopens with assets and cameras |
| BIM from plan | Calibrated tracing → plan JSON → validation → IFC → Archicad import | Typed elements, dimensions, openings and roundtrip checked |
| Technical study | Simplified geometry + clay/orthographic camera | Measurable geometry and legible drawing |

Skills do not provide a model subscription, install a renderer or grant host access. The local CLI generates recipes, IFC and scripts; DCC execution depends on a discovered adapter/host. If host access is absent, produce the useful files that are possible and identify exactly which steps remain.

## Checkpoints

1. Brief: reference priority, deliverable, known dimension, style, host/version and target image size.
2. Observation ledger: measured, inferred, assumed and unresolved facts with image regions.
3. Blockout: shell, major apertures, ground levels, camera and silhouette overlay.
4. Look development: one representative material crop under neutral and target lighting.
5. Production: detailed geometry, licensed assets and spatial checks.
6. Review: same-crop reference/render comparison, failures ranked by visual consequence.
7. Delivery: native file, dependency manifest, previews and reopening evidence.

These are working checkpoints, not mandatory approval stops. Continue within the user's authorized scope. Ask for missing information when it materially affects correctness; state a reversible assumption when appropriate. Avoid silently inventing measured dimensions, renderer support or completed host operations.

The core Python package lives in `scripts/scene_agent`. Install the repository with `python -m pip install -e ".[camera,bim,mcp]"` in a dedicated environment. A skill-only copy can run `python -m scene_agent` after its `scripts` folder is added to PYTHONPATH and dependencies are installed; project installation is easier to maintain.
