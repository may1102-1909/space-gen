---
name: open-source-asset-pipeline
description: Open-source 3D asset pipelines, Blender-to-web workflows, glTF optimization, design token architecture, and Radix/Shadcn HUD interfaces.
---

# Open-Source Asset and Multi-Media Pipeline Skill

<role>
You are an open-source technical artist and digital product architect. Your job is to integrate open-source asset creation (Blender), glTF optimization, centralized design tokens, and declarative UI systems (Tailwind, Radix/Shadcn, Lucide) across web and 3D game experiences.
</role>

---

## When to Use

Activate this skill:
- **Exporting and optimizing 3D assets from Blender**: Decimation, UV mapping, light baking, and glTF/GLB exports.
- **Automating asset optimization pipelines**: Running `gltf-transform`, Draco compression, texture downsizing, and LOD generation.
- **Architecting design tokens**: Sharing colors, typography, and spacing constants across web dashboards and in-game HUDs.
- **Building declarative spatial game interfaces**: Integrating Radix UI / Shadcn primitives inside or overlaid on 3D viewports.

---

## Technical Workflows

### 1. Blender to WebGL Asset Pipeline

```
[Blender 3D Modeling] 
      │ (Low-poly blockout + UV Unwrap + Ambient Occlusion bake)
      ▼
[.blend Master File] 
      │ (Export glTF 2.0 / .glb: Y-Up, PBR Materials, Apply Modifiers)
      ▼
[CLI glTF Optimization]
      │ (gltf-transform: prune, dedup, draco/meshopt, resample)
      ▼
[Web-Ready .glb Asset in public/models/]
```

#### Blender Export Settings Checklist:
- **Format**: glTF Binary (`.glb`).
- **Transform**: `+Y Up` checked.
- **Geometry**: Apply Modifiers checked, Normals exported, Tangents checked only if normal mapping is used.
- **Materials**: Export PBR materials; keep material count under 3 per prop.
- **Lighting**: Bake static shadows and ambient occlusion into a single unlit emission or base-color map for high-speed rendering on mobile/consumer hardware.

#### Automated Asset Optimization (`gltf-transform`):
```bash
# Compress geometries with Draco and resize oversized textures
npx @gltf-transform/cli optimize input.glb output.glb --draco.compress --texture-compress webp
```

---

### 2. Design Token Architecture (Centralized JSON)

Decouple visual styling into an open-source token dictionary (`tokens/design-tokens.json`):

```json
{
  "color": {
    "brand": { "primary": "#6366f1", "accent": "#06b6d4" },
    "surface": { "base": "#0a0a0a", "panel": "#171717", "overlay": "#262626" },
    "status": { "health": "#22c55e", "mana": "#3b82f6", "danger": "#ef4444" }
  },
  "spacing": { "xs": "4px", "sm": "8px", "md": "16px", "lg": "24px" },
  "radius": { "ui": "12px", "badge": "9999px" }
}
```

Map tokens directly into `tailwind.config.ts`:
```typescript
import tokens from './tokens/design-tokens.json';

export default {
  theme: {
    extend: {
      colors: tokens.color,
      borderRadius: tokens.radius,
      spacing: tokens.spacing,
    },
  },
};
```

---

### 3. Declarative Spatial UI & In-Game HUD (Radix UI + Lucide + R3F)

Overlay web-standard accessible UI components directly onto 3D viewports without blocking WebGL pointer events:

```tsx
import { Crosshair, ShieldAlert, Sparkles } from 'lucide-react';
import * as Slider from '@radix-ui/react-slider';

export const GameHUD = ({ health, stamina }: { health: number; stamina: number }) => (
  <div className="pointer-events-none fixed inset-0 flex flex-col justify-between p-6">
    {/* Top Bar: Status Badges */}
    <header className="flex items-center justify-between pointer-events-auto">
      <div className="flex items-center gap-2 rounded-xl bg-neutral-900/80 px-4 py-2 border border-neutral-800 backdrop-blur-md">
        <Sparkles className="w-5 h-5 text-indigo-400" />
        <span className="font-mono text-sm text-neutral-200">FPS: 60 | DrawCalls: 38</span>
      </div>
    </header>

    {/* Center Reticle */}
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <Crosshair className="w-6 h-6 text-white/50" />
    </div>

    {/* Bottom Bar: Health / Control Sliders */}
    <footer className="pointer-events-auto flex items-center gap-4 bg-neutral-950/90 p-4 rounded-2xl border border-neutral-800">
      <ShieldAlert className="w-5 h-5 text-red-400" />
      <div className="w-48 bg-neutral-800 h-2 rounded-full overflow-hidden">
        <div className="bg-red-500 h-full transition-all" style={{ width: `${health}%` }} />
      </div>
    </footer>
  </div>
);
```

---

## Verification & Asset Auditing Checklist

- [ ] Blender model origin `(0, 0, 0)` is set at the object pivot/base.
- [ ] Model polygon count is budgeted: Props (< 2,500 tris), Characters (< 15,000 tris), Environments (< 50,000 tris).
- [ ] Exported `.glb` passes `gltf-transform inspect model.glb` without validation warnings.
- [ ] HUD elements use `pointer-events-none` on outer wrapper and `pointer-events-auto` on interactive controls.
- [ ] Design tokens drive both web dashboard and 3D overlay color values.
