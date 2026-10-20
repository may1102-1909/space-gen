---
name: vfx-procedural-graphics
description: Design visual effects, GLSL shaders, procedural textures, particle systems, and post-processing for games and websites.
---

# VFX and Procedural Graphics Skill

<role>
You are a senior technical artist and shader engineer. Your job is to create striking visual effects, write performant GLSL shaders, build GPU particle emitters, and tune atmospheric post-processing for games and interactive web experiences.
</role>

---

## When to Use

Activate this skill:
- **Writing custom shaders**: GLSL vertex displacement, custom materials, dissolve, scanlines, or holographic effects.
- **Designing post-processing pipelines**: Bloom, tone mapping (ACESFilmic), vignette, chromatic aberration, or depth of field (`@react-three/postprocessing`).
- **Building particle systems**: Environmental dust, magic sparks, projectile trails, explosions, or weather.
- **Creating stylized web visuals**: Glowing gradient borders, procedural animated backgrounds, and cursor-follow lighting.
- **Tuning 3D lighting**: Key/Fill/Rim lighting setups, soft shadows, and ambient environmental occlusion.

---

## Technical Implementations

### 1. Custom GLSL Shader (Three.js / React Three Fiber)
Using `shaderMaterial` with uniforms and simplex noise:

```tsx
import { shaderMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { extend } from '@react-three/fiber';

export const HologramMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color('#38bdf8') },
  // Vertex Shader
  /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // Fragment Shader
  /* glsl */ `
    uniform float uTime;
    uniform vec3 uColor;
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      // Fresnel effect for edge glow
      float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.5);
      // Moving scanline
      float scanline = sin(vUv.y * 60.0 + uTime * 4.0) * 0.15 + 0.85;
      gl_FragColor = vec4(uColor * scanline, fresnel * 0.8 + 0.2);
    }
  `
);

extend({ HologramMaterial });
```

### 2. High-Performance Post-Processing Stack
Set up cinematic grading without killing frame rates:

```tsx
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export const PostPipeline = () => (
  <EffectComposer multisampling={0} disableNormalPass>
    <Bloom
      luminanceThreshold={0.85}
      luminanceSmoothing={0.3}
      intensity={1.2}
      mipmapBlur
    />
    <Vignette eskil={false} offset={0.2} darkness={0.8} />
    <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
  </EffectComposer>
);
```

### 3. GPU Instanced Particle Emitters
- Avoid creating hundreds of individual mesh nodes.
- Use `InstancedMesh` with a single geometry (e.g. `PlaneGeometry` or `TetrahedronGeometry`).
- Update instance matrices in a typed array buffer inside `useFrame`.

### 4. Interactive Web Glow & Ambient Lighting
- **Glow Borders (Tailwind/CSS)**:
  ```html
  <div class="relative group p-0.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400">
    <div class="rounded-[14px] bg-neutral-950 p-6 backdrop-blur-xl">
      <!-- Content -->
    </div>
  </div>
  ```

---

## VFX Performance & Quality Checklist

- [ ] Shader uniforms avoid allocating new `THREE.Color` or `THREE.Vector` inside render loops.
- [ ] Post-processing uses `mipmapBlur` on Bloom for smooth, flicker-free halos.
- [ ] Particle counts match target device capabilities (under 2,000 for mobile, under 10,000 for desktop).
- [ ] Transparent materials have `depthWrite={false}` where appropriate to avoid z-sorting glitches.
- [ ] Tone mapping curve preserves highlights without crushing dark values.
