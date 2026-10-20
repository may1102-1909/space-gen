import { useScene } from '@pascal-app/core';
import type { Matrix4 } from '@/lib/contracts/primitives';
import { IDENTITY_SCAN_TO_SCENE } from './scanAlignment';

/** Creates or updates the canonical Pascal ScanNode. Matrix metadata is the alignment source of truth. */
export function upsertScanNode(
  url: string,
  options: { id?: string; format?: string; scanToScene?: Matrix4; meshUrl?: string; maskRegions?: any[] } = {},
) {
  if (!url.trim()) throw new Error('A scan URL is required.');
  const scene = useScene.getState();
  const nodes = scene.nodes as Record<string, any>;
  const existing = options.id
    ? nodes[options.id]
    : Object.values(nodes).find((node) => node?.type === 'scan');
  const id = existing?.id || options.id || `scan_${crypto.randomUUID()}`;
  const metadata = {
    ...(existing?.metadata || {}),
    format: options.format || existing?.metadata?.format || formatFromUrl(url),
    scanToScene: options.scanToScene || existing?.metadata?.scanToScene || [...IDENTITY_SCAN_TO_SCENE],
    maskRegions: options.maskRegions || existing?.metadata?.maskRegions || [],
    ...(options.meshUrl ? { meshUrl: options.meshUrl } : {}),
  };
  if (existing) {
    scene.applyNodeChanges({
      update: [{
        id: id as any,
        // Pascal's built-in scan renderer loads assets as glTF; Spark owns this scan layer.
        data: { url, metadata, layers: { ...(existing.layers || {}), model: false } } as any,
      }],
    });
  } else {
    scene.applyNodeChanges({
      create: [{
        node: {
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
        } as any,
      }],
    });
  }
  return id;
}

/** Records a completed alignment as one Pascal scene update, so temporal undo reverts it. */
export function setScanAlignment(scanId: string, scanToScene: Matrix4): void {
  const scene = useScene.getState();
  const scan = (scene.nodes as Record<string, any>)[scanId];
  if (!scan || scan.type !== 'scan') throw new Error(`Scan node not found: ${scanId}`);
  scene.applyNodeChanges({
    update: [{
      id: scanId as any,
      data: { metadata: { ...(scan.metadata || {}), scanToScene: [...scanToScene] } } as any,
    }],
  });
}

function formatFromUrl(url: string): string {
  const extension = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ['sog', 'spz', 'ply', 'splat'].includes(extension || '') ? extension! : 'sog';
}
