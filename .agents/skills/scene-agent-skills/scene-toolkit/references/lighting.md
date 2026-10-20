# Reconstruct light and atmosphere

Eight starting recipes live in [lighting.json](../scripts/scene_agent/data/lighting.json): daylight, overcast, golden-hour, blue-hour, night, rain, interior-day and clay-studio. Temperatures and solar angles are art-direction starting points; exact time/geolocation is not inferred from an image alone.

## Establish a stable baseline

Use a neutral material test, correct camera and real openings. Start with environment and dominant direction, then compare shadow direction, softness, sky/facade ratio and reflections. Set exposure once for a comparison sequence. Do not fix every brightness mismatch by editing both exposure and all light intensities simultaneously.

A large emitter yields softer shadows than a small one at the same position. Light unit modes matter: record whether a value represents power, luminance or a renderer-specific default. The bundled `saAreaLight` uses Corona's explicit unit mode 0 and does not claim its intensity argument is lumens. Verify the active UI unit on the target version before adopting a photometric schedule.

Add interior and exterior practicals after environment balance. Warm interiors commonly start in the 2700–3500 K range; retain fixture shapes and avoid clipping the glazing into a flat yellow rectangle. A cool exterior with warm interiors requires both color and intensity separation.

## Atmosphere and vegetation

Depth haze should increase with distance and remain consistent with scene scale. It cannot replace missing midground trees. Keep near foliage detailed and color-varied; distant canopies can use lower detail and lower contrast. Wet surfaces need spatial roughness masks, plausible drainage and correct reflected light placement.

Record environment map/rotation, sun direction, emitter size/unit/intensity/temperature, exposure, white balance and tone operators. Capture a clay preview and final-material preview to separate lighting errors from albedo errors. The toolkit includes recipes and Corona light helpers, not an automatic sky estimator or HDRI licence.
