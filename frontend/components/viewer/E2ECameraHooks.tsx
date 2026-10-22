'use client';

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { sceneRegistry, useScene, type AnyNodeId } from '@pascal-app/core';
import { usePlacementPreview } from '@/lib/pascal/pascalEditor';
import type { OrientedBoundingBox } from '@/lib/contracts';
import { useProposalPreviews } from '@/lib/pascal/proposalPreview';

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
  /** Current camera position and orbit target. */
  getCamera(): { position: Vec3; target: Vec3 };
  /** Viewport-space (CSS px) position of a scene point under the current editor camera. */
  projectPoint(point: Vec3): { x: number; y: number };
  /** The placement tool's preview: its node type and the type of the scene node it snapped onto (null while it floats). */
  placementPreview(): { type: string; host: string | null } | null;
  /** Pending proposal ghosts: their node id and the proposal's scene-frame base position. */
  proposalGhosts(): Array<{ proposalId: string; ghostId: string; position: Vec3 }>;
  /** World position of the Object3D Pascal rendered for a node, or null when not mounted. */
  renderedNodePosition(nodeId: string): Vec3 | null;
}

/** Splat-layer diagnostics, registered by SplatBackgroundCanvas when NEXT_PUBLIC_E2E=1. */
export interface SpacegenSplatDiagnostics {
  numSplats(): number;
  editCount(): number;
  /** SplatEdits in the scene graph; Spark applies those globally on top of mesh.edits (double masking). */
  globalEditCount(): number;
  /** Box SDFs Spark receives through mesh.edits. */
  edits(): Array<{ opacity: number; halfExtents: Vec3 }>;
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
      getCamera() {
        const t = controls?.target ?? new THREE.Vector3();
        return { position: [camera.position.x, camera.position.y, camera.position.z], target: [t.x, t.y, t.z] };
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
      placementPreview() {
        const { node } = usePlacementPreview.getState();
        if (!node) return null;
        const host = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : undefined;
        return { type: node.type, host: host?.type ?? null };
      },
      proposalGhosts() {
        return Object.values(useProposalPreviews.getState().previews).flatMap((e) =>
          e.status === 'pending' && e.ghostId && e.proposal.transform ? [{ proposalId: e.proposal.id, ghostId: e.ghostId, position: e.proposal.transform.position }] : [],
        );
      },
      renderedNodePosition(nodeId) {
        const object = sceneRegistry.nodes.get(nodeId);
        if (!object) return null;
        object.updateWorldMatrix(true, false);
        const p = object.getWorldPosition(new THREE.Vector3());
        return [p.x, p.y, p.z];
      },
    };
    return () => {
      delete window.__spacegenE2E;
    };
  }, [camera, controls, gl]);

  return null;
}
