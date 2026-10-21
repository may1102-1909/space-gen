'use client';

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { OrientedBoundingBox } from '@/lib/contracts';

type Vec3 = [number, number, number];

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Deterministic camera control and projection for Playwright. Mounted only when NEXT_PUBLIC_E2E=1. */
export interface SpacegenE2EHooks {
  setCamera(position: Vec3, target: Vec3): void;
  /** Viewport-space (CSS px) bounding rect of an OBB's 8 corners under the current editor camera. */
  projectObb(obb: OrientedBoundingBox): ScreenRect;
  /** Viewport-space (CSS px) position of a scene point under the current editor camera. */
  projectPoint(point: Vec3): { x: number; y: number };
}

/** Splat-layer diagnostics, registered by SplatBackgroundCanvas when NEXT_PUBLIC_E2E=1. */
export interface SpacegenSplatDiagnostics {
  numSplats(): number;
  editCount(): number;
  /** Scene-frame bounds of splat centers (after scanToScene). */
  bounds(): { min: Vec3; max: Vec3 } | null;
  /** Number of splat centers (scene frame) inside the OBB. */
  countInside(obb: OrientedBoundingBox): number;
}

declare global {
  interface Window {
    __spacegenE2E?: SpacegenE2EHooks;
    __spacegenSplat?: SpacegenSplatDiagnostics;
  }
}

interface ControlsWithTarget {
  target: THREE.Vector3;
  update(): void;
}

export function E2ECameraHooks() {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => state.controls) as unknown as ControlsWithTarget | null;

  useEffect(() => {
    window.__spacegenE2E = {
      setCamera(position, target) {
        camera.position.set(...position);
        if (controls) {
          controls.target.set(...target);
          controls.update();
        } else {
          camera.lookAt(...target);
        }
        camera.updateMatrixWorld();
      },
      projectObb(obb) {
        camera.updateMatrixWorld();
        const rect = gl.domElement.getBoundingClientRect();
        const box = new THREE.Matrix4().compose(
          new THREE.Vector3(...obb.center),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), obb.yaw),
          new THREE.Vector3(...obb.size),
        );
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
          const p = new THREE.Vector3(sx, sy, sz).applyMatrix4(box).project(camera);
          const x = rect.left + ((p.x + 1) / 2) * rect.width;
          const y = rect.top + ((1 - p.y) / 2) * rect.height;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      },
      projectPoint(point) {
        camera.updateMatrixWorld();
        const v = new THREE.Vector3(...point).project(camera);
        const rect = gl.domElement.getBoundingClientRect();
        return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
      },
    };
    return () => {
      delete window.__spacegenE2E;
    };
  }, [camera, controls, gl]);

  return null;
}
