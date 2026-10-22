'use client';

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { registerCameraReader } from '@/lib/presentation/cameraReader';

interface ControlsWithTarget {
  target: THREE.Vector3;
}

/** Lets the Share dialog read the editor camera (position, orbit target, fov). */
export function CameraReaderRegistrar() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as unknown as ControlsWithTarget | null;

  useEffect(
    () =>
      registerCameraReader(() => {
        const t = controls?.target ?? new THREE.Vector3(0, 1, 0);
        return { position: [camera.position.x, camera.position.y, camera.position.z], target: [t.x, t.y, t.z], fov: camera.fov };
      }),
    [camera, controls],
  );
  return null;
}
