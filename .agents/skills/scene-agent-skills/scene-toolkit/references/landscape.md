# Exterior realism without uncontrolled scatter

Model terrain/building contact, plinth, terrace, pool edges and level changes before vegetation. Match the hero camera so planting is distributed for the actual view rather than guessed afterward.

## Three vegetation bands

1. Foreground: recognizable species, branching, leaf thickness/transmission and varied age/orientation. Use detailed licensed assets or deliberately modeled plants.
2. Midground: instances/proxies with multiple source variants, scale/rotation variation and nonuniform spacing. Avoid a visible grid or repeated identical crowns.
3. Background: lower-detail geometry or a documented photographic/projection layer for fixed views. Label the latter as 2D and do not count it as reconstructed forest.

For grass, use ground color variation plus geometry where blades resolve. Choose density, clump width, height and species from the reference; random noise alone is not botanical structure. Mask terrace borders, tree trunks, paths and wet areas. Check edges and grazing angles at final resolution. A hundred thousand independent nodes can load and save worse than grouped/instanced/proxy equivalents even at the same triangle count.

## Water

Model basin, actual water depth, coping and underwater fixtures. Use a consistent normal/displacement scale and plausible absorption. The camera, reflection direction and emitters must explain highlights. A blue glossy plane is not a complete pool model. Test noise/caustics as separate quality concerns; excessive ripple can erase architectural reflections.

## Performance proof

Measure scene open/save time, active instance count, material count, memory and representative render time. Convert one vegetation asset in isolation before propagating it. Preserve the editable source while using render proxies. Review near leaves, background canopy silhouette and building occlusion separately.
