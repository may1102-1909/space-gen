import { useScene, AnyNodeId } from '@pascal-app/core';
import type { MaskRegion, OrientedBoundingBox } from '@/lib/contracts';
import { ItemNode, ItemAssetInput, replaceItemAsset } from '@/lib/pascal/itemEditing';

/**
 * Computes the Oriented Bounding Box (OBB) in scene space (Y-up, meters, floor at y=0)
 * for an item node.
 */
export function computeObbForItemNode(
  node: ItemNode,
  options: { padding?: number } = {}
): OrientedBoundingBox {
  const dims = node.asset?.dimensions || (node as any).dimensions || [1, 1, 1];
  const scale = node.scale || [1, 1, 1];
  const paddingMultiplier = options.padding ?? 1.0;

  const width = Math.max(0.01, dims[0] * Math.abs(scale[0]) * paddingMultiplier);
  const height = Math.max(0.01, dims[1] * Math.abs(scale[1]) * paddingMultiplier);
  const depth = Math.max(0.01, dims[2] * Math.abs(scale[2]) * paddingMultiplier);

  const posX = node.position?.[0] ?? 0;
  const posY = node.position?.[1] ?? 0;
  const posZ = node.position?.[2] ?? 0;

  // Bottom-center resting on y=posY: center of box is at posY + height / 2
  const centerY = posY + height / 2;
  const yaw = node.rotation ? node.rotation[1] : 0;

  return {
    center: [posX, centerY, posZ],
    size: [width, height, depth],
    yaw,
  };
}

/**
 * Creates a MaskRegion contract object for an existing item node.
 */
export function createMaskRegionForNode(
  node: ItemNode,
  options: {
    id?: string;
    feather?: number;
    ghost?: boolean;
    opacity?: number;
    padding?: number;
  } = {}
): MaskRegion {
  const maskId = options.id || `mask_${node.id}`;
  const obb = computeObbForItemNode(node, { padding: options.padding });

  return {
    id: maskId,
    obb,
    feather: options.feather ?? 0.05,
    enabled: true,
    itemId: node.id,
    detectionId: (node.metadata as any)?.detectionId ?? null,
    ghost: options.ghost ?? false,
    opacity: options.opacity ?? (options.ghost ? 0.25 : 0.0),
  };
}

/**
 * Replaces an existing item asset and atomically registers a SplatEdit mask
 * on the scan node in a single Pascal temporal transaction.
 *
 * This ensures that undoing the action restores the original item AND
 * removes the mask in a single undo step. Without a scan node, the item is
 * replaced and no mask is created.
 */
export function replaceItemWithMask(
  current: ItemNode,
  asset: ItemAssetInput,
  options: {
    scanNodeId?: string;
    feather?: number;
    ghost?: boolean;
  } = {}
): { replacedNode: ItemNode; maskRegion: MaskRegion | null } {
  const scene = useScene.getState();
  const nodes = scene.nodes as Record<string, any>;

  // 1. Create the mask region for the current object before replacement
  const maskRegion = createMaskRegionForNode(current, {
    feather: options.feather,
    ghost: options.ghost,
  });

  // 2. Compute replaced item node
  const replaced = replaceItemAsset(current, asset);
  const updatedItemData: any = {
    ...replaced,
    metadata: {
      ...(current.metadata || {}),
      maskRegionId: maskRegion.id,
    },
  };

  // 3. Find target scan node
  const scanNode = options.scanNodeId
    ? nodes[options.scanNodeId]
    : Object.values(nodes).find((n) => n?.type === 'scan');

  if (scanNode) {
    const existingMasks: MaskRegion[] = scanNode.metadata?.maskRegions || [];
    const nextMasks = [
      ...existingMasks.filter((m) => m.id !== maskRegion.id && m.itemId !== current.id),
      maskRegion,
    ];

    scene.applyNodeChanges({
      update: [
        {
          id: current.id as AnyNodeId,
          data: updatedItemData,
        },
        {
          id: scanNode.id as AnyNodeId,
          data: {
            metadata: {
              ...(scanNode.metadata || {}),
              maskRegions: nextMasks,
            },
          } as any,
        },
      ],
    });
    return { replacedNode: updatedItemData, maskRegion };
  }

  // Without a scan there are no splats to hide: replace the item only, with no mask.
  scene.applyNodeChanges({
    update: [{ id: current.id as AnyNodeId, data: replaced as any }],
  });
  return { replacedNode: replaced, maskRegion: null };
}

/**
 * Updates a specific MaskRegion on the scan node (size, ghost mode, feather, enabled).
 * Changes are recorded by Pascal temporal store.
 */
export function updateMaskRegion(
  scanNodeId: string,
  maskRegionId: string,
  patch: Partial<MaskRegion>
): void {
  const scene = useScene.getState();
  const scan = (scene.nodes as Record<string, any>)[scanNodeId];
  if (!scan || scan.type !== 'scan') return;

  const existing: MaskRegion[] = scan.metadata?.maskRegions || [];
  const nextMasks = existing.map((mask) => {
    if (mask.id !== maskRegionId) return mask;
    return {
      ...mask,
      ...patch,
      obb: patch.obb ? { ...mask.obb, ...patch.obb } : mask.obb,
    };
  });

  scene.applyNodeChanges({
    update: [
      {
        id: scanNodeId as AnyNodeId,
        data: {
          metadata: {
            ...(scan.metadata || {}),
            maskRegions: nextMasks,
          },
        } as any,
      },
    ],
  });
}

/**
 * Toggles ghost mode (semi-transparent 0.25 opacity vs hidden 0.0 opacity) for a mask region.
 */
export function toggleMaskGhostMode(
  scanNodeId: string,
  maskRegionId: string
): boolean {
  const scene = useScene.getState();
  const scan = (scene.nodes as Record<string, any>)[scanNodeId];
  if (!scan || scan.type !== 'scan') return false;

  const existing: MaskRegion[] = scan.metadata?.maskRegions || [];
  const target = existing.find((m) => m.id === maskRegionId);
  if (!target) return false;

  const nextGhost = !target.ghost;
  updateMaskRegion(scanNodeId, maskRegionId, {
    ghost: nextGhost,
    opacity: nextGhost ? 0.25 : 0.0,
  });

  return nextGhost;
}

/**
 * Resizes a mask region's OBB size.
 */
export function resizeMaskRegion(
  scanNodeId: string,
  maskRegionId: string,
  newSize: [number, number, number]
): void {
  const scene = useScene.getState();
  const scan = (scene.nodes as Record<string, any>)[scanNodeId];
  if (!scan || scan.type !== 'scan') return;

  const existing: MaskRegion[] = scan.metadata?.maskRegions || [];
  const target = existing.find((m) => m.id === maskRegionId);
  if (!target) return;

  updateMaskRegion(scanNodeId, maskRegionId, {
    obb: {
      ...target.obb,
      size: [
        Math.max(0.01, newSize[0]),
        Math.max(0.01, newSize[1]),
        Math.max(0.01, newSize[2]),
      ],
    },
  });
}

/**
 * Removes a mask region from the scan node.
 */
export function removeMaskRegion(
  scanNodeId: string,
  maskRegionId: string
): void {
  const scene = useScene.getState();
  const scan = (scene.nodes as Record<string, any>)[scanNodeId];
  if (!scan || scan.type !== 'scan') return;

  const existing: MaskRegion[] = scan.metadata?.maskRegions || [];
  const nextMasks = existing.filter((m) => m.id !== maskRegionId);

  scene.applyNodeChanges({
    update: [
      {
        id: scanNodeId as AnyNodeId,
        data: {
          metadata: {
            ...(scan.metadata || {}),
            maskRegions: nextMasks,
          },
        } as any,
      },
    ],
  });
}
