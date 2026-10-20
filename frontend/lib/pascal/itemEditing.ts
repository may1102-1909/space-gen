import type { AnyNode } from '@pascal-app/core';
import type { FurnitureItem } from '@/lib/types';
import { api } from '@/lib/api';

export interface ItemAssetInput {
  id?: string;
  name: string;
  category: string;
  src: string;
  dimensions: [number, number, number];
  thumbnail?: string;
  source?: 'library' | 'community' | 'mine';
  offset?: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  parentId?: string | null;
}

export type ItemNode = Extract<AnyNode, { type: 'item' }>;

/** Build a Pascal item node with a stable Y-up, meter-based asset contract adhering to ItemNode schema. */
export function createItemNode(input: ItemAssetInput, id?: string): ItemNode {
  const generatedId = id || `item_${crypto.randomUUID()}`;
  const normalizedId = (generatedId.startsWith('item_') ? generatedId : `item_${generatedId}`) as ItemNode['id'];

  return {
    object: 'node',
    type: 'item',
    id: normalizedId,
    name: input.name,
    parentId: input.parentId ?? null,
    visible: true,
    position: input.position ?? [0, 0, 0],
    rotation: input.rotation ?? [0, 0, 0],
    scale: input.scale ?? [1, 1, 1],
    children: [],
    metadata: {},
    asset: {
      id: input.id || `asset_${normalizedId}`,
      name: input.name,
      category: input.category,
      thumbnail: input.thumbnail || '',
      source: input.source || 'library',
      src: input.src,
      dimensions: input.dimensions,
      offset: input.offset || [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  } as ItemNode;
}

/** Keep selected item pose/yaw and match its X/Z footprint, resting on y=0. */
export function replaceItemAsset<T extends ItemNode>(
  current: T,
  asset: ItemAssetInput,
): T {
  const oldDimensions = current.asset?.dimensions || [1, 1, 1];
  const oldScale = current.scale || [1, 1, 1];
  const oldEffectiveW = oldDimensions[0] * oldScale[0];
  const oldEffectiveH = oldDimensions[1] * oldScale[1];
  const oldEffectiveD = oldDimensions[2] * oldScale[2];

  const [newW, newH, newD] = asset.dimensions;
  const sx = oldEffectiveW > 0 && newW > 0 ? oldEffectiveW / newW : 1;
  const sy = oldEffectiveH > 0 && newH > 0 ? oldEffectiveH / newH : 1;
  const sz = oldEffectiveD > 0 && newD > 0 ? oldEffectiveD / newD : 1;
  const scale: [number, number, number] = [sx, sy, sz];

  return {
    ...current,
    name: asset.name,
    position: [current.position[0], 0, current.position[2]],
    rotation: [0, current.rotation[1], 0],
    scale,
    asset: {
      ...current.asset,
      id: asset.id || `asset_${current.id}`,
      name: asset.name,
      category: asset.category,
      thumbnail: asset.thumbnail || '',
      source: asset.source || 'library',
      src: asset.src,
      dimensions: asset.dimensions,
      offset: asset.offset || [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  } as T;
}

/** Return bottom-center normalized meter-space asset measurements from GLB bounds. */
export function normalizeGlbBounds(
  min: [number, number, number],
  max: [number, number, number],
): { dimensions: [number, number, number]; offset: [number, number, number]; unitScale: number } {
  const rawW = Math.max(max[0] - min[0], 0.001);
  const rawH = Math.max(max[1] - min[1], 0.001);
  const rawD = Math.max(max[2] - min[2], 0.001);
  const rawMax = Math.max(rawW, rawH, rawD);

  let unitScale = 1;
  if (rawMax > 50) {
    // authored in millimeters (e.g. 500-2500 mm)
    unitScale = 0.001;
  } else if (rawMax > 15 && rawMax <= 50) {
    // authored in centimeters or inches
    unitScale = 0.01;
  }

  const dimensions: [number, number, number] = [
    rawW * unitScale,
    rawH * unitScale,
    rawD * unitScale,
  ];

  const offset: [number, number, number] = [
    -(min[0] + max[0]) / 2 || 0,
    -min[1] || 0,
    -(min[2] + max[2]) / 2 || 0,
  ];

  return {
    dimensions,
    offset,
    unitScale,
  };
}

/** Fetch available catalog items by querying both public/catalog manifest and backend catalog. */
export async function fetchCatalogItems(): Promise<FurnitureItem[]> {
  const items: FurnitureItem[] = [];
  const seenIds = new Set<string>();

  // 1. Static public catalog manifest
  try {
    const res = await fetch('/catalog/catalogManifest.json');
    if (res.ok) {
      const manifest = await res.json();
      for (const asset of manifest.assets || []) {
        if (!seenIds.has(asset.id)) {
          seenIds.add(asset.id);
          items.push({
            id: asset.id,
            name: asset.name,
            category: asset.category,
            style: asset.materialType || asset.subType || 'modern',
            dimensions: {
              width_m: asset.dimensions?.[0] ?? 1,
              height_m: asset.dimensions?.[1] ?? 1,
              depth_m: asset.dimensions?.[2] ?? 1,
            },
            color_preview: asset.defaultColorHex || '#888888',
            description: asset.name,
            filename: (asset.modelUrl || '').split('/').pop() || '',
            url: asset.modelUrl,
          });
        }
      }
    }
  } catch {
    // Static catalog fetch ignored if unavailable or in non-browser context
  }

  // 2. Dynamic backend furniture catalog
  try {
    const backendItems = await api.getFurnitureCatalog();
    for (const item of backendItems) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        items.push(item);
      }
    }
  } catch {
    // Backend catalog failure gracefully ignored
  }

  return items;
}
