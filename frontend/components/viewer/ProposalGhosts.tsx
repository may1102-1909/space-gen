'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { sceneRegistry } from '@pascal-app/core';
import { installProposalPreviewSync, updatePreviewTransform, useProposalPreviews } from '@/lib/pascal/proposalPreview';

const LIVE_VALIDATE_INTERVAL_S = 0.15;

/**
 * Draws pending-proposal ghost nodes (rendered by Pascal's ItemSystem) with a translucent ghost
 * material, and re-validates a ghost live while the transform gizmo drags it.
 */
export function ProposalGhosts() {
  const previews = useProposalPreviews((s) => s.previews);
  const lastValidate = useRef(0);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.45, depthWrite: false }),
    [],
  );

  useEffect(() => installProposalPreviewSync(), []);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    const validateNow = clock.elapsedTime - lastValidate.current > LIVE_VALIDATE_INTERVAL_S;
    for (const entry of Object.values(previews)) {
      if (entry.status !== 'pending' || !entry.ghostId) continue;
      const object = sceneRegistry.nodes.get(entry.ghostId);
      if (!object) continue;
      // Pascal re-resolves item materials on load and shading changes; keep the ghost look.
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.material !== material) {
          mesh.material = material;
          mesh.castShadow = false;
        }
      });
      const t = entry.proposal.transform;
      if (validateNow && t) {
        // The gizmo moves the registered group during a drag; the node is written on release.
        updatePreviewTransform(entry.proposal.id, {
          position: [object.position.x, Math.max(0, object.position.y), object.position.z],
          rotationY: object.rotation.y,
          scale: t.scale,
        });
      }
    }
    if (validateNow) lastValidate.current = clock.elapsedTime;
  });

  return null;
}
