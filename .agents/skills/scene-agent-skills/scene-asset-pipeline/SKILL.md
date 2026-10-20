---
name: scene-asset-pipeline
description: "Validate architectural textures and asset dependencies, prepare licensed resources and prevent missing or ambiguous file references."
---

# Asset Pipeline

Make asset provenance and decoding reliable.

## Inputs and result

**Inputs:** Asset directory, map roles, licenses and intended renderer.

**Result:** Dependency inventory, decoding results and explicit substitutions.

## Procedure

1. Record source, author/license and redistribution rights before bundling third-party assets. A downloadable asset is not automatically redistributable.
2. Use `scene-agent image-check` to detect false extensions and decoding failures. A successfully decoded image still needs a native renderer load test.
3. Prepare material conversion in a small isolated scene before merging into a large one. Prefer instances/proxies for repeated heavy geometry.
4. Use `scene-agent manifest assets` to identify duplicate basenames and hashes. Relink by unambiguous relative path/content, not first matching filename.
5. Keep original assets and document conversion settings, map gamma/data treatment, proxy requirements and substitutions.

## Working reference

Read [assets.md](../scene-toolkit/references/assets.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
