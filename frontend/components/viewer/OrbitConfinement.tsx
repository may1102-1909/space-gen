'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useRoomNavigation } from '@/lib/navigation/useRoom';
import { confinePoint, interiorOrbitView, type Vec3 } from '@/lib/navigation/room';

interface OrbitControlsLike {
  target: THREE.Vector3;
  maxDistance: number;
  update(): void;
}

const EPSILON = 1e-4;
const differs = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > EPSILON;

/**
 * Interior scenes: keeps the orbit camera AND its target inside the room volume every frame, so zoom
 * and pan cannot leave. Entering a confined state from outside (e.g. after load) jumps to a good interior
 * viewpoint instead of snapping to the nearest wall. Runs after OrbitControls and before the splat sync.
 */
export function OrbitConfinement({ enabled }: { enabled: boolean }) {
  const { confinement: room } = useRoomNavigation();
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsLike | null;
  const get = useThree((state) => state.get);
  const relocate = useRef(true);
  const active = enabled && room !== null;

  useEffect(() => { relocate.current = true; }, [active, room]);

  useEffect(() => {
    const live = get().controls as unknown as OrbitControlsLike | null;
    if (!live || !room || !enabled) return;
    const previous = live.maxDistance;
    // Longest straight line inside the room bounds the useful zoom.
    const xs = room.outline.map((p) => p[0]);
    const zs = room.outline.map((p) => p[1]);
    live.maxDistance = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), room.ceilingHeight);
    return () => { live.maxDistance = previous; };
  }, [controls, get, room, enabled]);

  useFrame(() => {
    if (!active || !room) return;
    const position: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
    const target: Vec3 = controls ? [controls.target.x, controls.target.y, controls.target.z] : [0, 1, 0];
    const confinedPosition = confinePoint(position, room);
    const confinedTarget = confinePoint(target, room);
    if (relocate.current) {
      relocate.current = false;
      if (differs(confinedPosition, position) || differs(confinedTarget, target)) {
        const view = interiorOrbitView(room);
        camera.position.set(...view.position);
        controls?.target.set(...view.target);
        if (controls) controls.update();
        else camera.lookAt(...view.target);
        return;
      }
    }
    if (!differs(confinedPosition, position) && !differs(confinedTarget, target)) return;
    controls?.target.set(...confinedTarget);
    camera.position.set(...confinedPosition);
    if (controls) controls.update();
    else camera.lookAt(...confinedTarget);
  }, 1);

  return null;
}
