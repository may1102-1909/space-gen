# Corona quick commands

Canonical definitions: [corona_tools.ms](../scripts/scene_agent/templates/corona_tools.ms). Loading this file only defines helpers. Generated `scene-agent corona` scripts additionally apply the requested quality preset on an already active Corona renderer.

```maxscript
fileIn @"C:\your-repo\skills\scene-toolkit\scripts\scene_agent\templates\corona_tools.ms"
saUseCorona() -- explicit renderer switch, only if needed
saQuality #preview
saQuality #review
saQuality #final
m = saPhysical "Stone" (color 175 170 160) roughness:0.65
g = saGlass "Window glass"
-- Light positions/targets are in current scene system units; sizes below are metres.
key = saAreaLight "Key" [400,-200,700] [400,250,0] 6 4 intensity:3 kelvin:4500
saLightMix #(#("Interior", #(key)))
saMeshAudit (selection as array)
```

| Preset | Pass cap | Noise target | Screen displacement size |
|---|---:|---:|---:|
| preview | 16 | 8% | 4 px |
| review | 64 | 4% | 2 px |
| final | 160 | 2% | 1 px |

Time limit is set to zero while a finite pass cap remains. These are starting settings. Either applicable stopping condition may end a render; the preset is not proof that the requested noise was reached. Output dimensions, camera, denoising and color management remain separate decisions. Tight displacement can consume substantial memory; test a crop first.

## Property compatibility

The helpers probe required properties before applying quality/material settings and fail with an explicit error when unsupported. Actual host verification is reported in the repository's verification document. Do not infer support for other Corona releases from matching class names alone. Keep new adapters version-tested and report partial changes if a host exception occurs.

## LightMix

`saLightMix` adds an environment selection, named LightSelect groups and a LightMix element. It preserves existing AOVs and leaves intensity/color arrays untouched. It refuses to duplicate existing `SA |` groups. The caller supplies valid scene nodes; check membership, unassigned lights and unintended overlapping groups. It is not a replacement for physically sensible source intensities. Save a checkpoint and render a small AOV test before production.

## Rendering and existing scenes

The helpers do not reset, save or launch a render. The user/agent runs native rendering through an available host connection. Saving a new scene and changing a renderer are concrete operations; preserve the user's current work and existing authority. The repository's native smoke test is for an isolated fresh batch process only.
