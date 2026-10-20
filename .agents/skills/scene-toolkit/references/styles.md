# Apply a style without losing structure

The catalogue is [styles.json](../scripts/scene_agent/data/styles.json). It contains 16 entries: six lighting looks, seven design directions and three presentation modes. Each has a palette, roughness range, relief range in millimetres, light/camera/post guidance, failure cases and an image prompt starter.

```sh
scene-agent styles
scene-agent style japandi
scene-agent recipe blue-hour --quality high --deliverable editable-3d --out blue-hour.json
```

The recipe is an inspectable brief. It does not modify a scene. For image editing, pass the original image plus geometry/crop constraints to a tool the host actually provides. For 3D, use the recipe to choose materials and lights in the native scene, then render. Never label an image-only variant as a 3D reconstruction.

## Variant control

Freeze footprint, window/door positions, floor levels, camera and output crop. Change materials, planting species, furniture finishes and lighting only within scope. Additions such as Mediterranean arches, loft columns or a new pool change architecture and require a redesign request. Preserve seeds when comparing vegetation looks.

Material ranges are broad starting points. Clear glass, polished metal and cloth require their own shaders even when a style's general roughness range is matte. Do not apply a single roughness or displacement value to the entire scene.

Watercolor is a presentation treatment applied to a structural base through illustration/image tools or a separately implemented compositor. It has no hidden Corona watercolor switch. Technical axonometric uses an orthographic camera; increasing a perspective lens length is only an approximation.

Compare one neutral base, one requested style and one correction. Record differences and structural drift before generating dozens of variants.
