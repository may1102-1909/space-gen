# Render comparison and stopping rules

Compare reference and actual native render at the same crop/aspect ratio and known display transform. A screenshot of a viewport is not a final renderer output. A generated image is not proof of an editable model.

## Suggested rubric

| Region/category | Weight | Evidence |
|---|---:|---|
| Camera and building silhouette | 30 | Projected landmarks, edge overlay, perspective |
| Apertures and structural geometry | 25 | Window/door/slab comparison plus secondary views |
| Materials and physical scale | 20 | 100% crops, UV modules, relief, glass |
| Lighting and atmosphere | 15 | Shadow direction, source visibility, exposure ratios |
| Furniture/vegetation/detail | 10 | Silhouettes, contacts, natural variation |

These are suggested reviewer weights, not an automated quality score. Score each category only with stated criteria and evidence. Do not derive an overall percentage from intuition. Exclude copied/projection backgrounds from 3D reconstruction accuracy; they can be assessed as composition separately.

Rank corrections by impact and cause. Fix camera before redetailing every wall. Fix material scale before adding displacement subdivisions. Fix light balance before excessive denoising. Keep one-variable comparisons when diagnosing uncertainty.

Stop an iteration when the targeted defect is resolved or additional cost no longer improves the target crop. Record unresolved errors and whether they stem from missing reference data, host access, asset mismatch or implementation limitations. A final pass cap is not convergence evidence; include actual stopping condition and visible remaining noise when available.

Use the release's evaluation fixtures for regression, then add private project-specific references locally. Never publish a client's images merely to demonstrate the toolkit.
