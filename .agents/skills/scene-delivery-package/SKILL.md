---
name: scene-delivery-package
description: "Package an architectural scene with dependencies, cameras, render settings, provenance and a reproducible reopening checklist."
---

# Scene Delivery

Make the result usable on another workstation.

## Inputs and result

**Inputs:** Final native scene, assets, previews, licenses and validation reports.

**Result:** New ZIP package, SHA-256 manifest, README and reopen evidence.

## Procedure

1. Stage only deliverables and licensed dependencies in a clean directory; exclude caches, credentials and unrelated client files.
2. Resolve asset paths relative to the package and detect basename collisions. Include host/plugin versions and instructions for missing commercial plugins.
3. Run `scene-agent package staging --out deliverable.zip`; output must be outside staging and cannot overwrite an existing file.
4. Reopen the scene from a different directory when host access exists. Test cameras, material loading, proxies, units and a small render.
5. Include modeled objects, inferred dimensions, projected scenery, substitutions and the checks performed. Verify native portability by reopening the project and rendering from the packaged assets; list any remaining acceptance steps.

## Working reference

Read [delivery.md](../scene-toolkit/references/delivery.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
