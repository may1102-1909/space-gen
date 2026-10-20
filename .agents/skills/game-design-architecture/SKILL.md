---
name: game-design-architecture
description: Design interactive game systems, camera controls, player physics, spatial object manipulation, and gameplay state machines.
---

# Game Design and Interactive Systems Skill

<role>
You are a technical gameplay engineer and game systems designer. Your job is to architect engaging mechanics, responsive camera controllers, spatial interaction systems, and robust gameplay state machines for WebGL/3D web games.
</role>

---

## When to Use

Activate this skill:
- **Designing gameplay loops**: Input handling, physics integration, tick rates, and delta-time compensation.
- **Implementing camera systems**: First-person (FPS/PointerLock), third-person follow cameras, or isometric/editor viewports.
- **Building spatial interactions**: Raycast object selection, 3D gizmos, grid snapping, and object placement.
- **Managing game state**: Finite state machines (FSM) for game modes (lobby, active, paused, game over) and player states (idle, moving, jumping).
- **Adding game feel & feedback**: Screen shake, hit stops, positional 3D audio, and score triggers.

---

## Core Systems & Architectures

### 1. Delta-Time & Frame-Rate Independence
Always multiply movement velocities and rotations by `delta` seconds to ensure gameplay speed remains constant regardless of monitor refresh rate (60 Hz vs. 144 Hz vs. variable V-Sync):

```typescript
useFrame((state, delta) => {
  // Cap delta to prevent huge physics jumps on tab unfocus
  const safeDelta = Math.min(delta, 0.1);
  playerVelocity.x += inputAxis.x * acceleration * safeDelta;
  playerPosition.addScaledVector(playerVelocity, safeDelta);
});
```

### 2. Camera Controllers

| Camera Mode | Implementation Pattern | Best For |
| :--- | :--- | :--- |
| **First-Person (FPS)** | `PointerLockControls` with mouse look and WASD vector projection | Walkthroughs, shooters, spatial immersion |
| **Orbit / Inspector** | `OrbitControls` with damping and zoom limits | 3D object viewers, room customizers |
| **Third-Person Follow** | Interpolated lerp (`camera.position.lerp(targetPos, 0.1)`) with lookAt | Action games, character exploration |

### 3. Spatial Interaction & Grid Snapping
For placement, furniture layout, or building games:

```typescript
// Snap coordinate to grid unit (e.g. 0.5m grid)
export function snapToGrid(value: number, gridSize = 0.5): number {
  return Math.round(value / gridSize) * gridSize;
}

// Raycast intersection with custom plane
export function getGroundIntersection(
  raycaster: THREE.Raycaster,
  groundPlane: THREE.Plane
): THREE.Vector3 | null {
  const target = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, target);
}
```

### 4. Gameplay Finite State Machine (FSM)
Keep game modes decoupled from rendering:

```typescript
type GameState = 'MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

interface GameStore {
  state: GameState;
  score: number;
  lives: number;
  transitionTo: (next: GameState) => void;
}
```

### 5. Game Feel & Audio Juice
- **Positional Audio**: Attach `PositionalAudio` to game entities for 3D sound attenuation.
- **Screen Shake**: Apply damped noise offsets to the camera position for impact moments.
- **Feedback Timing**: Trigger visual flash + sound effect on the exact frame of hit or action.

---

## Verification Runbook

- [ ] Gameplay runs identically at 30, 60, and 120 FPS (`delta` multiplied).
- [ ] Pointer lock releases cleanly on `Escape` key.
- [ ] Objects cannot be placed outside boundary limits or through collisions.
- [ ] Audio listener orientation matches camera forward vector.
