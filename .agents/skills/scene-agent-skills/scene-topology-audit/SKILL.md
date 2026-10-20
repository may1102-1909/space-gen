---
name: scene-topology-audit
description: "Inspect architectural mesh topology, UVs, scale, openings and spatial relationships before rendering or delivery."
---

# Topology and Spatial Audit

Find structural defects that a pretty hero render can hide.

## Inputs and result

**Inputs:** Native scene or exported meshes and intended thin/solid classifications.

**Result:** Prioritized findings with object names, evidence and fixes.

## Procedure

1. Use `saMeshAudit` on selected geometry or a scoped object set; it reports vertices, triangles, open edges and UV support from evaluated meshes.
2. Classify intentional thin cloth/leaves separately from solids. Open-edge count is not a universal pass/fail rule.
3. Check normals, coincident surfaces, non-manifold joints, displacement cracks and transform scale using host tools appropriate to the model.
4. Inspect stairs through slabs, furniture through glazing, curtain walkways and floating objects in orthographic views. The bundled audit does not automatically certify collisions.
5. Fix highest-impact defects, recheck affected objects and keep unresolved findings in the delivery report.

## Working reference

Read [audit.md](../scene-toolkit/references/audit.md) for the relevant contract, commands and failure cases. The shared core belongs beside this skill; install the full bundle. Use available tools, preserve user scope and distinguish executed results from preparation-only outputs.
