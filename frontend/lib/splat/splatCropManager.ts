import { useScene } from '@pascal-app/core';
import { asNodeId, scanMetadata, updateNodeData } from '@/lib/pascal/nodes';

export interface SplatCropVolume {
  id: string;
  type: 'box' | 'sphere';
  center: [number, number, number];
  size: [number, number, number]; // [width, height, depth] for box, [radius, radius, radius] for sphere
  rotation?: [number, number, number]; // [rotX, rotY, rotZ] in radians
  mode: 'exclude' | 'include';
  label?: string;
}

/**
 * SuperSplat-inspired 3D point-in-box test with Euler rotation support.
 * Checks whether a 3D Gaussian splat point (x, y, z) falls inside an exclusion volume.
 */
export function isPointInsideVolume(
  point: [number, number, number],
  volume: SplatCropVolume
): boolean {
  const [px, py, pz] = point;
  const [cx, cy, cz] = volume.center;
  const [w, h, d] = volume.size;

  // Translate to origin
  let dx = px - cx;
  const dy = py - cy;
  let dz = pz - cz;

  // If rotation exists, apply inverse rotation around Y (most common for furniture Yaw)
  if (volume.rotation && volume.rotation[1] !== 0) {
    const angle = -volume.rotation[1];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    dx = rx;
    dz = rz;
  }

  if (volume.type === 'sphere') {
    const radius = w / 2;
    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }

  // Box check (half-extents)
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;

  return Math.abs(dx) <= hx && Math.abs(dy) <= hy && Math.abs(dz) <= hz;
}

/**
 * SuperSplat Buffer Filter:
 * Masks Gaussian splats in memory by setting opacity/scale to 0 for all points
 * falling inside active exclusion volumes.
 * Expects packed float array where stride typically contains position (offsets 0, 1, 2)
 * and opacity/scale attributes.
 */
export function filterSplatPositions(
  positions: Float32Array,
  volumes: SplatCropVolume[],
  stride = 3
): { excludedCount: number; activeMask: Uint8Array } {
  const pointCount = Math.floor(positions.length / stride);
  const activeMask = new Uint8Array(pointCount);
  activeMask.fill(1); // 1 = visible, 0 = masked/erased

  if (!volumes || volumes.length === 0) {
    return { excludedCount: 0, activeMask };
  }

  let excludedCount = 0;

  for (let i = 0; i < pointCount; i++) {
    const idx = i * stride;
    const pt: [number, number, number] = [
      positions[idx],
      positions[idx + 1],
      positions[idx + 2],
    ];

    for (const vol of volumes) {
      if (vol.mode === 'exclude' && isPointInsideVolume(pt, vol)) {
        activeMask[i] = 0;
        excludedCount++;
        break;
      }
    }
  }

  return { excludedCount, activeMask };
}

/**
 * Registers an exclusion volume on a Pascal Scan node's metadata
 * so the Gaussian Splat layer masks out those points in real-time.
 */
export function addExclusionVolumeToScan(
  scanNodeId: string,
  volume: SplatCropVolume
): void {
  const scene = useScene.getState();
  const node = scene.nodes[asNodeId(scanNodeId)];

  if (!node || node.type !== 'scan') {
    console.warn(`[splatCropManager] Node ${scanNodeId} is not a scan node.`);
    return;
  }

  const existing = (scanMetadata(node).exclusionBoxes as unknown as SplatCropVolume[] | undefined) || [];
  const nextBoxes = [...existing.filter((b) => b.id !== volume.id), volume];

  updateNodeData(scanNodeId, {
    metadata: {
      ...scanMetadata(node),
      exclusionBoxes: nextBoxes,
    },
  });
}

/**
 * Removes an exclusion volume from a Scan node.
 */
export function removeExclusionVolumeFromScan(
  scanNodeId: string,
  volumeId: string
): void {
  const scene = useScene.getState();
  const node = scene.nodes[asNodeId(scanNodeId)];

  if (!node || node.type !== 'scan') return;

  const existing = (scanMetadata(node).exclusionBoxes as unknown as SplatCropVolume[] | undefined) || [];
  const nextBoxes = existing.filter((b) => b.id !== volumeId);

  updateNodeData(scanNodeId, {
    metadata: {
      ...scanMetadata(node),
      exclusionBoxes: nextBoxes,
    },
  });
}

/**
 * Clears all exclusion volumes from a Scan node.
 */
export function clearAllExclusionVolumes(scanNodeId: string): void {
  const scene = useScene.getState();
  const node = scene.nodes[asNodeId(scanNodeId)];

  if (!node || node.type !== 'scan') return;

  updateNodeData(scanNodeId, {
    metadata: {
      ...scanMetadata(node),
      exclusionBoxes: [],
    },
  });
}
