import { useScene, type AnyNodeId } from '@pascal-app/core';
import type { AssetRef, MaskRegion, SegmentedObject, ShellSurfaceTexture } from '@/lib/contracts';
import { createItemNode, type ItemNode } from '@/lib/pascal/itemEditing';
import { asNodeData, asNodeId, findScanNode, scanMetadata } from '@/lib/pascal/nodes';
import { prefixedId } from '@/lib/pascal/scanConverter';

/**
 * GPU-segmented objects (ADR 002) -> Pascal item nodes plus the MaskRegions that hide their original
 * splats, written as ONE applyNodeChanges so a single undo removes them all.
 *
 * Masks stay where the object was scanned (no `itemId`), so moving or replacing the item never brings
 * the original splats back; the item links to its mask through `metadata.maskRegionId`.
 */

export const SEGMENTED_META_KEY = 'segmentedObject';
/** Splat footprints reach past the mesh; grow the mask a little so no fringe stays visible. */
const MASK_PADDING = 0.04;

const absolute = (url: string, base: string) => new URL(url, base).href;

export function segmentedItemId(object: SegmentedObject): string {
  return prefixedId('item', object.id);
}

export function segmentedItemNode(object: SegmentedObject, parentId: string, apiBase: string): ItemNode {
  const { width, height, depth } = object.meshAsset.dimensions;
  const node = createItemNode(
    {
      id: object.meshAsset.id,
      name: object.meshAsset.name,
      category: object.label,
      src: absolute(object.meshAsset.url, apiBase),
      dimensions: [width, height, depth],
      source: 'mine',
      position: [...object.placement.position],
      rotation: [0, object.placement.rotationY, 0],
      parentId,
    },
    segmentedItemId(object),
  );
  return { ...node, metadata: { maskRegionId: object.maskRegionId, [SEGMENTED_META_KEY]: object } } as ItemNode;
}

export function segmentedMask(object: SegmentedObject): MaskRegion {
  const [w, h, d] = object.obb.size;
  return {
    id: object.maskRegionId || `mask_${object.id}`,
    obb: { ...object.obb, size: [w + MASK_PADDING, h + MASK_PADDING, d + MASK_PADDING] },
    feather: 0.03,
    enabled: true,
  };
}

export function segmentedAssetRefs(objects: SegmentedObject[], apiBase: string): AssetRef[] {
  return objects.map((o) => ({ ...o.meshAsset, url: absolute(o.meshAsset.url, apiBase) }));
}

/**
 * Adds every object as an item under the scan's level and its mask to the scan node, as one undo step.
 * Objects already in the scene (same id) are skipped, so re-applying a conversion is harmless.
 */
export function applySegmentedObjects(
  objects: SegmentedObject[],
  apiBase: string,
  surfaces: ShellSurfaceTexture[] = [],
): string[] {
  const scene = useScene.getState();
  const scan = findScanNode(scene.nodes);
  if (!scan) throw new Error('Import a scan before adding its objects.');
  const levelId = scan.parentId || Object.values(scene.nodes).find((n) => n?.type === 'level')?.id;
  if (!levelId) throw new Error('The scan has no level to hold its objects.');
  const fresh = objects.filter((o) => !scene.nodes[asNodeId(segmentedItemId(o))]);
  if (!fresh.length && !surfaces.length) return [];
  const metadata = scanMetadata(scan);
  const masks = fresh.map(segmentedMask);
  const ids = new Set(masks.map((m) => m.id));
  scene.applyNodeChanges({
    create: fresh.map((o) => ({ node: segmentedItemNode(o, levelId, apiBase), parentId: levelId as AnyNodeId })),
    update: [{
      id: asNodeId(scan.id),
      data: asNodeData({
        metadata: {
          ...metadata,
          maskRegions: [...(metadata.maskRegions || []).filter((m) => !ids.has(m.id)), ...masks],
          // Baked floor/wall textures; "Build editable room" applies the slab one (scanConverter).
          ...(surfaces.length ? { shellTextures: surfaces.map((s) => ({ ...s, textureAsset: absolute(s.textureAsset, apiBase) })) } : {}),
        },
      }),
    }],
  });
  return fresh.map(segmentedItemId);
}
