# Detail levels and topology

Read [quality.json](../scripts/scene_agent/data/quality.json). **Low**, **high** and **very-high** describe asset detail intent, not render sampling. The CLI Corona `preview/review/final` modes affect renderer limits separately.

## Screen-space budgeting

Start from final image size and visible asset coverage. A 0.5 m chair leg occupying 12 pixels needs a believable silhouette; a 1500-pixel closeup needs joints, bevels and wood direction. Estimate projected feature size as `focal_pixels × feature_metres / distance_metres`, then inspect the actual camera crop. Suggested silhouette errors: low ≤2 px, high ≤0.75 px, very-high ≤0.3 px. These are review targets, not solver guarantees.

| Mode | Typical hero asset range | Typical secondary range | Detail strategy |
|---|---:|---:|---|
| Low | 500–20,000 triangles | 100–5,000 | Silhouette + baked relief; instancing and draw-call control |
| High | 20,000–250,000 | 1,000–50,000 | Physical bevels, readable seams, selective subdivision |
| Very-high | 100,000–1,500,000 | 5,000–150,000 | Hero closeups; displacement/proxies; editable control cages |

Ranges overlap deliberately. A simple wall should not gain 100,000 polygons to satisfy a label. Foliage may have many thin elements yet little screen impact. Measure RAM/VRAM, load time, draw calls and texture footprint in addition to triangle counts.

## Construction sequence

Build shell and real apertures, then reveals/frame sections, then furniture and fittings. Test floor contacts, stair holes, door swings and clearances before fine detail. Hard architecture benefits from controlled planar panels and consistent smoothing; soft upholstery benefits from deformation-friendly quads and supporting loops. Triangles in a stable, non-deforming area are not automatically bad topology.

Use physical edge radii: an interior painted join can start around 0.5–2 mm; a stone edge may need 2–5 mm depending on the reference. These are authoring guesses, not manufacturing rules. A metre-scale concrete crater is a mapping/displacement error, not a request for subdivision.

The `max-plan` exporter is a blockout adapter: independent closed wall cells around openings and rectangular slabs. It is not a joined all-quad production wall mesh, furniture generator or universal retopology engine. Merge/weld appropriate cells in a derived production model and recheck openings.
