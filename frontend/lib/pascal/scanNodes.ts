import { useScene } from '@pascal-app/core';
import type { MaskRegion } from '@/lib/contracts';
import type { Matrix4 } from '@/lib/contracts/primitives';
import { IDENTITY_SCAN_TO_SCENE } from './scanAlignment';
import { asNode, asNodeData, asNodeId, findScanNode, scanMetadata, type ScanNode } from './nodes';

/** Creates or updates the canonical Pascal ScanNode. Matrix metadata is the alignment source of truth. */
export function upsertScanNode(
  url: string,
  options: { id?: string; format?: string; scanToScene?: Matrix4; meshUrl?: string; maskRegions?: MaskRegion[] } = {},
) {
  if (!url.trim()) throw new Error('A scan URL is required.');
  const scene = useScene.getState();
  const byId = options.id ? scene.nodes[asNodeId(options.id)] : undefined;
  const existing: ScanNode | undefined = options.id ? (byId?.type === 'scan' ? byId : undefined) : findScanNode(scene.nodes);
  const id = existing?.id || options.id || `scan_${crypto.randomUUID()}`;
  const previous = scanMetadata(existing);
  const metadata = {
    ...previous,
    format: options.format || previous.format || formatFromUrl(url),
    scanToScene: options.scanToScene || previous.scanToScene || [...IDENTITY_SCAN_TO_SCENE],
    maskRegions: options.maskRegions || previous.maskRegions || [],
    ...(options.meshUrl ? { meshUrl: options.meshUrl } : {}),
  };
  if (existing) {
    const layers = (existing as unknown as { layers?: Record<string, unknown> }).layers || {};
    scene.applyNodeChanges({
      update: [{
        id: asNodeId(id),
        // Pascal's built-in scan renderer loads assets as glTF; Spark owns this scan layer.
        data: asNodeData({ url, metadata, layers: { ...layers, model: false } }),
      }],
    });
  } else {
    scene.applyNodeChanges({
      create: [{
        node: asNode({
          id,
          type: 'scan',
          name: 'Room scan',
          url,
          visible: true,
          opacity: 100,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: 1,
          // Keep the ScanNode canonical while preventing Pascal's glTF loader from parsing .sog.
          layers: { model: false },
          metadata,
        }),
      }],
    });
  }
  return id;
}

/** Records a completed alignment as one Pascal scene update, so temporal undo reverts it. */
export function setScanAlignment(scanId: string, scanToScene: Matrix4): void {
  const scene = useScene.getState();
  const scan = scene.nodes[asNodeId(scanId)];
  if (!scan || scan.type !== 'scan') throw new Error(`Scan node not found: ${scanId}`);
  scene.applyNodeChanges({
    update: [{
      id: asNodeId(scanId),
      data: asNodeData({ metadata: { ...scanMetadata(scan), scanToScene: [...scanToScene] } }),
    }],
  });
}

function formatFromUrl(url: string): string {
  const extension = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ['sog', 'spz', 'ply', 'splat'].includes(extension || '') ? extension! : 'sog';
}
