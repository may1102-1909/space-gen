'use client';

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useScene } from '@pascal-app/core';
import { getInterpretationMeta } from '@/lib/pascal/scanConverter';
import { confidenceColor, getDetections } from '@/lib/pascal/interpretationReview';
import { nodeViews, type NodeView } from '@/lib/pascal/nodes';

const unitBox = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

/** Review-mode overlay in the Pascal canvas: wall bands and detection boxes coloured by confidence. */
export function InterpretationOverlay() {
  const nodes = nodeViews(useScene((s) => s.nodes));
  const { walls, detections } = useMemo(() => {
    const all = Object.values(nodes).filter((n): n is NodeView => Boolean(n));
    return {
      walls: all.filter((n) => n.type === 'wall' && getInterpretationMeta(n)?.kind === 'wall'),
      detections: getDetections(nodes),
    };
  }, [nodes]);

  return (
    <group name="interpretation-overlay" renderOrder={10}>
      {walls.map((wall) => {
        const meta = getInterpretationMeta(wall)!;
        const dx = wall.end[0] - wall.start[0];
        const dz = wall.end[1] - wall.start[1];
        const length = Math.hypot(dx, dz);
        const height = wall.height ?? 2.5;
        return (
          <mesh
            key={wall.id}
            position={[(wall.start[0] + wall.end[0]) / 2, height + 0.03, (wall.start[1] + wall.end[1]) / 2]}
            rotation={[0, -Math.atan2(dz, dx), 0]}
          >
            <boxGeometry args={[length, 0.06, (wall.thickness ?? 0.2) + 0.04]} />
            <meshBasicMaterial color={confidenceColor(meta.confidence, meta.status)} transparent opacity={0.85} depthTest={false} />
          </mesh>
        );
      })}
      {detections.map((det) => (
        <lineSegments
          key={det.id}
          geometry={unitBox}
          position={det.obb.center}
          rotation={[0, det.obb.yaw, 0]}
          scale={det.obb.size}
        >
          <lineBasicMaterial color={confidenceColor(det.confidence, det.status)} transparent opacity={det.status === 'rejected' ? 0.3 : 1} depthTest={false} />
        </lineSegments>
      ))}
    </group>
  );
}

export default InterpretationOverlay;
