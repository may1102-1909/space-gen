# A usable scene handoff

Stage `scene/`, `assets/`, `renders/` and `reports/` with a README describing software versions, units, cameras, render settings, project origin, asset licences and project requirements. Keep native sources plus requested exchange formats. Include a low-resolution preview so recipients can identify the scene without opening heavy software.

The packager creates a ZIP with a SHA-256 manifest and protects existing files and the source directory. Before packaging, create the native scene, relink its file references in the host, confirm asset licences and check the required renderer plugins.

## Reopening proof

Copy/extract into a different directory, open the native file, enumerate missing assets, inspect proxies/materials and run a small camera render. Compare it to the delivered preview. Record the tested host, date, output size and any dependencies requiring attention. If reopening is still pending, state that step and who will perform it; base portability claims on the actual results.

## Delivery statement

Use four short lists: delivered files; checks performed and results; inferred dimensions and substitutions; remaining acceptance steps. Distinguish projected background scenery from editable geometry. Preserve uncertainty about dimensions inferred from pictures. For each remaining step, specify the input, target application and expected result.

For free public distribution, publish only original code/examples and redistributable dependencies. Commercial renderer licences, model subscriptions and third-party assets remain separate. This project is an independent community toolkit, not an endorsement or product of Autodesk, Chaos, Graphisoft, OpenAI or Anthropic.
