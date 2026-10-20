import { useScene } from '@pascal-app/core';

export interface SeedRoomOptions {
  forceReset?: boolean;
}

/**
 * Initializes a complete, realistic scanned room hierarchy inside Pascal's useScene
 * when no scene nodes exist or when forceReset is requested.
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
      polygon: {
        type: 'polygon',
        points: [
          [-4.0, -3.0],
          [4.0, -3.0],
          [4.0, 3.0],
          [-4.0, 3.0],
        ],
      },
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
      offset: 4.0,
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
      offset: 4.0,
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
      polygon: {
        type: 'polygon',
        points: [
          [-4.0, -3.0],
          [0.0, -3.0],
          [0.0, 3.0],
          [-4.0, 3.0],
        ],
      },
    },
    'level_main'
  );

  addNode(
    {
      type: 'zone',
      id: 'zone_dining',
      name: 'Dining Area',
      category: 'dining',
      polygon: {
        type: 'polygon',
        points: [
          [0.0, -3.0],
          [4.0, -3.0],
          [4.0, 3.0],
          [0.0, 3.0],
        ],
      },
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
      metadata: {
        exclusionBoxes: [],
      },
    },
    'level_main'
  );

  // 9. Pre-Populated Furniture Item Nodes
  addNode(
    {
      type: 'item',
      id: 'item_sofa_1',
      name: 'Contemporary 3-Seater Sofa',
      category: 'sofa',
      position: [-2.0, 0, 0],
      rotation: [0, 0, 0],
      dimensions: [2.2, 0.85, 0.95],
      modelUrl: '/samples/models/sofa.glb',
    },
    'level_main'
  );

  addNode(
    {
      type: 'item',
      id: 'item_coffee_table_1',
      name: 'Minimalist Coffee Table',
      category: 'table',
      position: [-2.0, 0, 1.2],
      rotation: [0, 0, 0],
      dimensions: [1.1, 0.45, 0.6],
      modelUrl: '/samples/models/coffee_table.glb',
    },
    'level_main'
  );

  addNode(
    {
      type: 'item',
      id: 'item_dining_table_1',
      name: 'Solid Oak Dining Table',
      category: 'table',
      position: [2.0, 0, 0],
      rotation: [0, 0, 0],
      dimensions: [1.8, 0.75, 0.9],
      modelUrl: '/samples/models/dining_table.glb',
    },
    'level_main'
  );

  addNode(
    {
      type: 'item',
      id: 'item_chair_1',
      name: 'Velvet Dining Chair North',
      category: 'chair',
      position: [2.0, 0, -0.75],
      rotation: [0, 0, 0],
      dimensions: [0.55, 0.85, 0.55],
      modelUrl: '/samples/models/chair.glb',
    },
    'level_main'
  );

  addNode(
    {
      type: 'item',
      id: 'item_chair_2',
      name: 'Velvet Dining Chair South',
      category: 'chair',
      position: [2.0, 0, 0.75],
      rotation: [0, Math.PI, 0],
      dimensions: [0.55, 0.85, 0.55],
      modelUrl: '/samples/models/chair.glb',
    },
    'level_main'
  );

  return true;
}
