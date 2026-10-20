# Topology and spatial review

The Max helper `saMeshAudit nodes` evaluates meshes without changing source nodes. Each row contains name, vertex count, triangle count, open-edge count (-1 if unavailable), and UV channel 1 support. It is a diagnostic inventory, not an all-purpose mesh validator.

## Classify first

Closed architectural solids should not have unexplained boundary edges. Leaves, cloth sheets and deliberate water surfaces may be open by design. A triangle count is not proof of poor topology; deformation behavior, shading and editability matter. Proxies may expose only preview geometry, so audit their source or render representation separately.

## Review passes

- Geometry: reversed normals, degenerate faces, coincident surfaces, unwanted holes, smoothing discontinuities and displacement cracks.
- Scale: system units versus display units, nonuniform transforms, implausible thickness and wrong asset scale.
- UV/materials: absent channels, inconsistent density, mirrored grain and data maps read as color.
- Spatial: stairs crossing uncut slabs, tables through walls, curtain stacks in circulation, floating furniture and glazing intersections.
- Performance: excessive independent nodes, uncontrolled subdivisions and incompatible proxy dependencies.

Use scoped selection and derived copies for destructive repairs. Report an object ID/name, view/crop, defect, impact and proposed fix. After repair, repeat the affected check rather than restarting unrelated expensive rendering.

Use the bundled inventory for mesh counts, open edges and UV coverage. Perform whole-scene collision checks, watertight checks and mesh retopology with native mesh/section tools or a dedicated geometry checker, and record the method and results.
