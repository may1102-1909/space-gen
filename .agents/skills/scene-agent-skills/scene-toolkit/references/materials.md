# Material scale, roughness and displacement

Keep a material record with surface purpose, reference, base color source, roughness source, normal convention, UV/world scale, displacement min/max in millimetres, thin/solid assumption and native decode test. A file existing on disk is not proof a renderer can read it.

## Map roles

| Map | Treatment | Frequent error |
|---|---|---|
| Base color | Color-managed color input, according to source encoding | Double gamma or baked shadows |
| Roughness/metalness | Data/raw input; verify host workflow | Treating roughness as glossiness |
| Normal | Data/raw, correct tangent-space convention | Flipped green channel or color transform |
| Height/displacement | Data/raw plus calibrated neutral and physical amplitude | Using arbitrary bright image as centimetres of relief |
| Opacity | Data/mask with edge filtering | Visible foliage card borders |

For legacy gamma workflows data often uses 1.0 and sRGB color inputs use the appropriate color transform; OCIO pipelines require named input spaces. Do not universally force every map to gamma 2.2. Corona Physical Material helper sets `roughnessMode=0` explicitly.

## Useful physical starting points

- Fine plaster relief: roughly 0.1–0.5 mm; use normal/bump if silhouette is unaffected.
- Concrete surface relief: roughly 0.3–2 mm; formwork seams/tie holes may be geometry at close range.
- Linen weave: submillimetre texture, with folds modeled at a much larger scale.
- Stone joints/plank seams: model or mask using actual module width; avoid oversized texture repetition.
- Water: IOR near 1.333 as a starting physical value, shallow perturbation and real depth geometry. Clear architectural glass often starts around 1.52.

These are authoring ranges, not specifications of every product. Derive values from known samples when possible. `saDisplacement material map -0.2 0.5` converts signed millimetre bounds to current Max units. A neutral midpoint matters: a 0–1 map with zero at black can push every vertex outward unless bounds/offset are chosen deliberately.

Solid glass requires thickness and correct normals. Thin curtains/leaves can be intentional open surfaces; adding a shell and retaining the wrong thin/absorption model may make them too dark. Evaluate transmission, reflections and interior visibility together.

Test a material ball/plane at physical scale, a grazing-angle crop and its real placement. Displacement that improves a flat crop but breaks joints is not ready for delivery.
