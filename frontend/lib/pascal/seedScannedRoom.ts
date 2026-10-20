import { useScene } from '@pascal-app/core';

export interface SeedRoomOptions {
  forceReset?: boolean;
}

/**
 * Initializes a complete, realistic scanned room hierarchy inside Pascal's useScene
 * adhering to official Pascal node schemas (prefixed ids, item.asset.src, dimensions).
 *
 * Hierarchy:
 * Site (site_default)
 *  └── Building (bld_default)
 *       └── Level (level_main)
 *            ├── Slab (slab_main) - 8m x 6m perimeter
 *            ├── Walls (North, East, South, West)
 *            │    ├── Window (window_north)
 *            │    └── Door (door_south)
 *            ├── Zones (Living Area, Dining Area)
 *            ├── Scan (scan_room_1) - Gaussian Splat overlay
 *            └── Items (Sofa, Coffee Table, Dining Table, Chairs)
 */
export function seedScannedRoom(options?: SeedRoomOptions): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const scene = useScene.getState();
  const existingNodeCount = Object.keys(scene.nodes).length;

  if (existingNodeCount > 0 && !options?.forceReset) {
    return false; // Scene already seeded or loaded from IndexedDB
  }

  if (options?.forceReset) {
    scene.clearScene();
  }

  // Helper to safely invoke createNode with partial initial props
  const addNode = (node: Record<string, any>, parentId?: string) => {
    (scene.createNode as any)(node, parentId);
  };

  // 1. Root Site Node
  addNode({
    type: 'site',
    id: 'site_default',
    name: 'SpaceGen Spatial Project',
  });

  // 2. Building Node
  addNode(
    {
      type: 'building',
      id: 'bld_default',
      name: 'Main Studio',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
    'site_default'
  );

  // 3. Level Node (Main Living Floor)
  addNode(
    {
      type: 'level',
      id: 'level_main',
      name: 'Ground Floor',
      elevation: 0,
      height: 3.0,
    },
    'bld_default'
  );

  // 4. Main Floor Slab (-4 to +4 X, -3 to +3 Z)
  addNode(
    {
      type: 'slab',
      id: 'slab_main',
      name: 'Hardwood Floor Slab',
      thickness: 0.2,
      polygon: [
        [-4.0, -3.0],
        [4.0, -3.0],
        [4.0, 3.0],
        [-4.0, 3.0],
      ],
    },
    'level_main'
  );

  // 5. Four Connected Perimeter Walls
  addNode(
    {
      type: 'wall',
      id: 'wall_north',
      name: 'North Wall',
      start: [-4.0, 3.0],
      end: [4.0, 3.0],
      height: 3.0,
      thickness: 0.2,
    },
    'level_main'
  );

  addNode(
    {
      type: 'wall',
      id: 'wall_east',
      name: 'East Wall',
      start: [4.0, 3.0],
      end: [4.0, -3.0],
      height: 3.0,
      thickness: 0.2,
    },
    'level_main'
  );

  addNode(
    {
      type: 'wall',
      id: 'wall_south',
      name: 'South Wall',
      start: [4.0, -3.0],
      end: [-4.0, -3.0],
      height: 3.0,
      thickness: 0.2,
    },
    'level_main'
  );

  addNode(
    {
      type: 'wall',
      id: 'wall_west',
      name: 'West Wall',
      start: [-4.0, -3.0],
      end: [-4.0, 3.0],
      height: 3.0,
      thickness: 0.2,
    },
    'level_main'
  );

  // 6. Child Door & Window Openings on Walls
  addNode(
    {
      type: 'door',
      id: 'door_south',
      name: 'Entrance Door',
      position: [4.0, 0, 0],
      rotation: [0, 0, 0],
      width: 0.95,
      height: 2.1,
    },
    'wall_south'
  );

  addNode(
    {
      type: 'window',
      id: 'window_north',
      name: 'Panorama Window',
      position: [4.0, 0.8, 0],
      rotation: [0, 0, 0],
      width: 2.2,
      height: 1.4,
      elevation: 0.8,
    },
    'wall_north'
  );

  // 7. Functional Room Zones
  addNode(
    {
      type: 'zone',
      id: 'zone_living',
      name: 'Living Area',
      category: 'living',
      polygon: [
        [-4.0, -3.0],
        [0.0, -3.0],
        [0.0, 3.0],
        [-4.0, 3.0],
      ],
    },
    'level_main'
  );

  addNode(
    {
      type: 'zone',
      id: 'zone_dining',
      name: 'Dining Area',
      category: 'dining',
      polygon: [
        [0.0, -3.0],
        [4.0, -3.0],
        [4.0, 3.0],
        [0.0, 3.0],
      ],
    },
    'level_main'
  );

  // 8. Gaussian Splat Scan Node (Overlay)
  addNode(
    {
      type: 'scan',
      id: 'scan_room_1',
      name: 'Gaussian Splat Room Scan',
      url: '/Hurstville_Museum_Gallery.sog',
      visible: true,
      opacity: 100,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      layers: {},
      metadata: {
        exclusionBoxes: [],
      },
    },
    'level_main'
  );

  // 9. Pre-Populated Furniture Item Nodes with Pascal item.asset.src schema
  const createItemPayload = (
    id: string,
    name: string,
    category: string,
    position: [number, number, number],
    rotation: [number, number, number],
    dimensions: [number, number, number],
    src: string
  ) => ({
    type: 'item',
    id,
    name,
    category,
    position,
    rotation,
    scale: [1, 1, 1],
    dimensions,
    modelUrl: src,
    asset: {
      id: `asset_${id}`,
      category,
      name,
      thumbnail: '',
      source: 'library',
      src,
      dimensions,
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  });

  addNode(
    createItemPayload(
      'item_sofa_1',
      'Contemporary 3-Seater Sofa',
      'sofa',
      [-2.0, 0, 0],
      [0, 0, 0],
      [2.2, 0.85, 0.95],
      '/samples/models/sofa.glb'
    ),
    'level_main'
  );

  addNode(
    createItemPayload(
      'item_coffee_table_1',
      'Minimalist Coffee Table',
      'table',
      [-2.0, 0, 1.2],
      [0, 0, 0],
      [1.1, 0.45, 0.6],
      '/samples/models/coffee_table.glb'
    ),
    'level_main'
  );

  addNode(
    createItemPayload(
      'item_dining_table_1',
      'Solid Oak Dining Table',
      'table',
      [2.0, 0, 0],
      [0, 0, 0],
      [1.8, 0.75, 0.9],
      '/samples/models/dining_table.glb'
    ),
    'level_main'
  );

  addNode(
    createItemPayload(
      'item_chair_1',
      'Velvet Dining Chair North',
      'chair',
      [2.0, 0, -0.75],
      [0, 0, 0],
      [0.55, 0.85, 0.55],
      '/samples/models/chair.glb'
    ),
    'level_main'
  );

  addNode(
    createItemPayload(
      'item_chair_2',
      'Velvet Dining Chair South',
      'chair',
      [2.0, 0, 0.75],
      [0, Math.PI, 0],
      [0.55, 0.85, 0.55],
      '/samples/models/chair.glb'
    ),
    'level_main'
  );

  return true;
}
