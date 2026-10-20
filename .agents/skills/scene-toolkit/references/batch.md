# Controlled variants

Before execution, define a finite list of variants with ID, base scene checkpoint, style ID, lighting ID, camera ID, random seed, output dimensions, render limits, output path and status. Prefer descriptive stable IDs such as `hero-blue-hour-v01`.

Do not expand three styles × five lights × six cameras into ninety renders unless that is the intended scope. Preview requested alternatives at reduced resolution, inspect representative outputs, and render finals for selected variants. Keep geometry/camera locked for a material or lighting comparison.

The CLI compiles one recipe at a time; the MCP server exposes preparation tools. Neither is a render-farm scheduler. Native batch execution needs an actual host adapter and job lifecycle handling. A future platform should track queued → running → completed/failed/cancelled with progress timestamps, checkpoint paths and owned process IDs. Cancellation should target the job's own worker, not an unrelated user session.

A successful command response is not proof of an image: verify the output exists, decodes and has expected dimensions. Save actual render settings and timings. Produce a contact sheet only from completed outputs and label failures separately. Never substitute a generated beauty image for a failed native render without saying so.
