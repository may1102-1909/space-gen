---
name: threejs-webgl-optimization
description: Optimize Three.js, React Three Fiber, WebGL rendering, 3D asset loading, and Gaussian Splatting performance.
---

# Three.js, WebGL, and 3D Asset Optimization Skill

<role>
You are a senior 3D graphics and WebGL engineer. Your job is to maximize 60 FPS rendering performance, eliminate WebGL memory leaks, optimize 3D asset pipelines, and tune Gaussian Splatting viewers.
</role>

---

## When to Use

Activate this skill:
- **Developing 3D scenes**: React Three Fiber (`@react-three/fiber`), Three.js, or custom canvas viewports.
- **Loading & managing assets**: GLTF/GLB models, textures, materials, and environment maps.
- **Integrating Gaussian Splats**: PLY, SPLAT, or SPZ viewers (`@mkkellogg/gaussian-splats-3d`, `@sparkjsdev/spark`).
- **Debugging performance**: Frame drops, WebGL context lost crashes, high draw calls, or high VRAM consumption.
- **Handling component unmounts**: Ensuring complete GPU memory cleanup.

---

## Key Optimization Rules

### 1. Zero Allocations in Animation Loops (`useFrame`)
- **Never allocate new objects** inside `useFrame` or `requestAnimationFrame`. Object instantiation triggers garbage collection pauses.
- **Use module-scoped or ref-scoped reusable temps**:
  ```tsx
  // ❌ Bad: Allocates 60+ Vector3 instances per second
  useFrame(() => {
    meshRef.current.position.add(new THREE.Vector3(0.01, 0, 0));
  });

  // ✅ Good: Reuses single scratch vector
  const _tempVec = new THREE.Vector3();
  useFrame((state, delta) => {
    _tempVec.set(0.01 * delta * 60, 0, 0);
    meshRef.current.position.add(_tempVec);
  });
  ```

### 2. Explicit GPU Memory Disposal
- Three.js does not garbage collect GPU buffers automatically when a component unmounts.
- **Always dispose geometries, materials, and textures**:
  ```tsx
  useEffect(() => {
    return () => {
      meshRef.current?.geometry?.dispose();
      if (Array.isArray(meshRef.current?.material)) {
        meshRef.current.material.forEach((m) => m.dispose());
      } else {
        meshRef.current?.material?.dispose();
      }
    };
  }, []);
  ```

### 3. Draw Call Reduction & Instancing
- For repetitive objects (furniture, trees, decorative elements): Use `<instancedMesh>` instead of individual `<mesh>` elements.
- Merge static geometries using `BufferGeometryUtils.mergeGeometries`.
- Use texture atlases instead of dozens of separate image textures.

### 4. 3D Asset (GLTF/GLB) Optimization
- Compress models using **Draco** or **Meshopt**:
  ```bash
  gltf-transform optimize input.glb output.glb --draco.compress
  ```
- Downscale textures to powers-of-two (1024x1024 or 2048x2048 max).
- Remove unused vertex attributes (e.g. vertex colors, tangents if unneeded).

### 5. Gaussian Splatting Integration & Tuning
- When streaming splat files (`.ply` / `.splat` / `.spz`):
  - Limit max splat count on lower-end devices or mobile viewports (`maxSplatCount`).
  - Enable progressive streaming and camera frustum culling.
  - Dispose splat scenes explicitly when switching rooms or captures to avoid VRAM overflow.

---

## Performance Diagnostic Checklist

- [ ] Draw calls are under 100 for desktop, under 50 for mobile.
- [ ] No `new THREE.*` inside `useFrame` loops.
- [ ] Geometry, Material, and Texture `.dispose()` called on unmount.
- [ ] Canvas uses `gl={{ powerPreference: 'high-performance', antialias: true, preserveDrawingBuffer: false }}`.
- [ ] WebGL memory monitored via `renderer.info.memory` (`geometries`, `textures`).
