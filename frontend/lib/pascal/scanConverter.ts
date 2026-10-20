import { useScene, AnyNode } from '@pascal-app/core';
import { applySceneActions, SceneAction, SplatExclusionBox } from './sceneBridge';
import { SplatCropVolume } from '../splat/splatCropManager';

export interface RawScanObject {
  id: string;
  label: string; // e.g. "chair", "sofa", "table"
  category: 'chair' | 'sofa' | 'table' | 'bed' | 'lamp' | 'decor' | 'storage';
  center: [number, number, number];
  dimensions: [number, number, number]; // [width, height, depth]
  rotation?: [number, number, number];
  confidence: number;
  modelUrl?: string;
}

export interface RawScanManifest {
  scanId: string;
  name?: string;
  scanFileUrl: string;
  boundaryPolygon: [number, number][]; // 2D floor polygon coordinates
  wallHeight: number;
  wallThickness?: number;
  openings?: Array<{
    type: 'door' | 'window';
    wallIndex: number;
    offset: number;
    width: number;
    height: number;
    elevation?: number;
  }>;
  detectedObjects: RawScanObject[];
}

export interface ConversionResult {
  createdNodeIds: string[];
  wallCount: number;
  itemCount: number;
  exclusionBoxCount: number;
}

/**
 * Built-in default preset manifest for the sample room scan.
 */
export const SAMPLE_ROOM_SCAN_MANIFEST: RawScanManifest = {
  scanId: 'scan_preset_studio',
  name: 'Studio Apartment Room Scan',
  scanFileUrl: '/Hurstville_Museum_Gallery.sog',
  wallHeight: 3.0,
  wallThickness: 0.2,
  boundaryPolygon: [
    [-4.0, -3.0],
    [4.0, -3.0],
    [4.0, 3.0],
    [-4.0, 3.0],
  ],
  openings: [
    {
      type: 'door',
      wallIndex: 2, // South wall
      offset: 4.0,
      width: 0.95,
      height: 2.1,
    },
    {
      type: 'window',
      wallIndex: 0, // North wall
      offset: 4.0,
      width: 2.0,
      height: 1.3,
      elevation: 0.85,
    },
  ],
  detectedObjects: [
    {
      id: 'detected_sofa_1',
      label: 'Boucle 3-Seater Sofa',
      category: 'sofa',
      center: [-2.0, 0, 0],
      dimensions: [2.2, 0.85, 0.95],
      rotation: [0, 0, 0],
      confidence: 0.94,
      modelUrl: '/samples/models/sofa.glb',
    },
    {
      id: 'detected_coffee_table_1',
      label: 'Walnut Coffee Table',
      category: 'table',
      center: [-2.0, 0, 1.2],
      dimensions: [1.1, 0.45, 0.6],
      rotation: [0, 0, 0],
      confidence: 0.91,
      modelUrl: '/samples/models/coffee_table.glb',
    },
    {
      id: 'detected_dining_table_1',
      label: 'Oak Dining Table',
      category: 'table',
      center: [2.0, 0, 0],
      dimensions: [1.8, 0.75, 0.9],
      rotation: [0, 0, 0],
      confidence: 0.96,
      modelUrl: '/samples/models/dining_table.glb',
    },
    {
      id: 'detected_chair_1',
      label: 'Dining Chair North',
      category: 'chair',
      center: [2.0, 0, -0.75],
      dimensions: [0.55, 0.85, 0.55],
      rotation: [0, 0, 0],
      confidence: 0.89,
      modelUrl: '/samples/models/chair.glb',
    },
    {
      id: 'detected_chair_2',
      label: 'Dining Chair South',
      category: 'chair',
      center: [2.0, 0, 0.75],
      dimensions: [0.55, 0.85, 0.55],
      rotation: [0, Math.PI, 0],
      confidence: 0.89,
      modelUrl: '/samples/models/chair.glb',
    },
  ],
};

/**
 * Converts raw scan geometry, detected boundaries, and segmented objects
 * into fully editable Pascal BIM nodes (Wall, Slab, Item) while registering
 * SuperSplat exclusion volumes to cleanly erase the raw scan points.
 */
export function convertScanToEditableNodes(
  manifest: RawScanManifest,
  options?: {
    levelId?: string;
    eraseUnderlyingSplats?: boolean;
    catalogModelFallback?: boolean;
  }
): ConversionResult {
  const scene = useScene.getState();
  const levelId =
    options?.levelId ||
    Object.values(scene.nodes).find((n) => n?.type === 'level')?.id ||
    'level_main';

  const shouldErase = options?.eraseUnderlyingSplats ?? true;
  const actions: SceneAction[] = [];
  const createdNodeIds: string[] = [];

  // 1. Create Floor Slab
  const slabId = `slab_scan_${Date.now()}`;
  actions.push({
    action: 'create_node',
    parentId: levelId,
    node: {
      type: 'slab',
      id: slabId,
      name: `${manifest.name || 'Room'} Floor Slab`,
      thickness: 0.2,
      polygon: manifest.boundaryPolygon,
    } as any,
  });
  createdNodeIds.push(slabId);

  // 2. Create Connected Perimeter Walls
  const poly = manifest.boundaryPolygon;
  const wallIds: string[] = [];

  for (let i = 0; i < poly.length; i++) {
    const start = poly[i];
    const end = poly[(i + 1) % poly.length];
    const wallId = `wall_scan_${i}_${Date.now()}`;
    wallIds.push(wallId);

    actions.push({
      action: 'create_node',
      parentId: levelId,
      node: {
        type: 'wall',
        id: wallId,
        name: `Wall #${i + 1}`,
        start,
        end,
        height: manifest.wallHeight || 3.0,
        thickness: manifest.wallThickness || 0.2,
      } as any,
    });
    createdNodeIds.push(wallId);
  }

  // 3. Attach Door & Window Openings to Walls
  if (manifest.openings) {
    for (const op of manifest.openings) {
      const parentWallId = wallIds[op.wallIndex];
      if (!parentWallId) continue;

      const openingId = `${op.type}_scan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      actions.push({
        action: 'create_node',
        parentId: parentWallId,
        node: {
          type: op.type,
          id: openingId,
          name: `${op.type === 'door' ? 'Door' : 'Window'}`,
          offset: op.offset,
          width: op.width,
          height: op.height,
          ...(op.elevation !== undefined ? { elevation: op.elevation } : {}),
        } as any,
      });
      createdNodeIds.push(openingId);
    }
  }

  // 4. Convert Detected Segmented Objects to Movable Item Nodes + SuperSplat Erasure Boxes
  let exclusionBoxCount = 0;

  for (const obj of manifest.detectedObjects) {
    const itemId = `item_${obj.category}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const modelUrl =
      obj.modelUrl ||
      `/samples/models/${obj.category === 'sofa' ? 'sofa.glb' : obj.category === 'chair' ? 'chair.glb' : 'coffee_table.glb'}`;

    actions.push({
      action: 'create_node',
      parentId: levelId,
      node: {
        type: 'item',
        id: itemId,
        name: obj.label,
        category: obj.category,
        position: obj.center,
        rotation: obj.rotation || [0, 0, 0],
        dimensions: obj.dimensions,
        scale: [1, 1, 1],
        modelUrl,
        asset: {
          id: `asset_${itemId}`,
          category: obj.category,
          name: obj.label,
          thumbnail: '',
          source: 'library',
          src: modelUrl,
          dimensions: obj.dimensions,
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      } as any,
    });
    createdNodeIds.push(itemId);

    // SuperSplat pattern: create an exclusion box matching object bounds
    if (shouldErase) {
      const exclusionBox: SplatExclusionBox = {
        id: `box_erase_${obj.id}`,
        center: obj.center,
        size: [
          obj.dimensions[0] * 1.05, // 5% margin to prevent edge bleeding
          obj.dimensions[1] * 1.05,
          obj.dimensions[2] * 1.05,
        ],
        rotation: obj.rotation,
      };

      actions.push({
        action: 'add_splat_exclusion',
        box: exclusionBox,
      });
      exclusionBoxCount++;
    }
  }

  // Commit all changes in a single atomic Zundo step
  applySceneActions(actions);

  return {
    createdNodeIds,
    wallCount: wallIds.length,
    itemCount: manifest.detectedObjects.length,
    exclusionBoxCount,
  };
}
