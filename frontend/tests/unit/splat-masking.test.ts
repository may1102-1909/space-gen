import { describe, it, expect, beforeEach } from 'vitest';
import { useScene } from '@pascal-app/core';
import { MaskRegionSchema, ProjectManifestSchema } from '@/lib/contracts';
import { createItemNode } from '@/lib/pascal/itemEditing';
import {
  computeObbForItemNode,
  createMaskRegionForNode,
  replaceItemWithMask,
  toggleMaskGhostMode,
  resizeMaskRegion,
  updateMaskRegion,
  removeMaskRegion,
} from '@/lib/splat/splatMasking';

describe('T08: Splat Masking & Replacement Integration Unit Tests', () => {
  beforeEach(() => {
    useScene.getState().clearScene();
    const temporal = useScene.temporal;
    if (temporal && typeof temporal.getState === 'function') {
      temporal.getState().clear();
    }
  });

  it('computes correct 3D OBB in scene frame (Y-up, floor at y=0) for an item', () => {
    const chair = createItemNode(
      {
        name: 'Dining Chair',
        category: 'chair',
        src: '/samples/models/chair.glb',
        dimensions: [0.6, 0.9, 0.6],
        position: [2.0, 0, -1.0],
        rotation: [0, 0.5, 0],
        scale: [1, 1, 1],
      },
      'item_chair_test'
    );

    const obb = computeObbForItemNode(chair);
    expect(obb.center[0]).toBe(2.0);
    // Floor is at y=0, height is 0.9m, center is at y = 0.45m
    expect(obb.center[1]).toBeCloseTo(0.45);
    expect(obb.center[2]).toBe(-1.0);
    expect(obb.size).toEqual([0.6, 0.9, 0.6]);
    expect(obb.yaw).toBe(0.5);
  });

  it('creates a contract-valid MaskRegion linked to an item and detection', () => {
    const chair = {
      ...createItemNode({
        name: 'Scanned Chair',
        category: 'chair',
        src: '/samples/models/chair.glb',
        dimensions: [0.55, 0.85, 0.55],
        position: [1.5, 0, 2.0],
      }),
      metadata: { detectionId: 'det_chair_01' },
    };

    const mask = createMaskRegionForNode(chair, { feather: 0.05 });
    const parsed = MaskRegionSchema.parse(mask);

    expect(parsed.id).toBe(`mask_${chair.id}`);
    expect(parsed.itemId).toBe(chair.id);
    expect(parsed.detectionId).toBe('det_chair_01');
    expect(parsed.feather).toBe(0.05);
    expect(parsed.enabled).toBe(true);
    expect(parsed.ghost).toBe(false);
    expect(parsed.opacity).toBe(0.0);
    expect(parsed.obb.size).toEqual([0.55, 0.85, 0.55]);
  });

  it('automatically creates a mask on replacement and supports 1-step temporal undo/redo', () => {
    const scene = useScene.getState();

    // 1. Seed scan node and item node
    scene.applyNodeChanges({
      create: [
        {
          node: {
            id: 'scan_room_test' as any,
            type: 'scan',
            name: 'Scan',
            url: '/scan.sog',
            visible: true,
            opacity: 100,
            metadata: { maskRegions: [] },
          } as any,
        },
        {
          node: createItemNode(
            {
              name: 'Original Chair',
              category: 'chair',
              src: '/samples/models/chair_orig.glb',
              dimensions: [0.55, 0.85, 0.55],
              position: [2.0, 0, -0.75],
            },
            'item_chair_1'
          ) as any,
        },
      ],
    });

    const temporal = useScene.temporal;
    if (temporal && typeof temporal.getState === 'function') {
      temporal.getState().clear();
    }

    const currentChair = (useScene.getState().nodes as any)['item_chair_1'];
    expect(currentChair.name).toBe('Original Chair');

    // 2. Replace chair with new catalog chair
    const { replacedNode, maskRegion } = replaceItemWithMask(
      currentChair,
      {
        name: 'Modern Accent Chair',
        category: 'chair',
        src: '/catalog/models/chair_modern.glb',
        dimensions: [0.65, 0.9, 0.65],
      },
      { scanNodeId: 'scan_room_test', feather: 0.05 }
    );

    // Verify item updated
    const updatedScene = useScene.getState();
    const updatedChair = (updatedScene.nodes as any)['item_chair_1'];
    expect(updatedChair.name).toBe('Modern Accent Chair');
    expect(updatedChair.metadata?.maskRegionId).toBe(maskRegion.id);

    // Verify scan node has mask region
    const scanNode = (updatedScene.nodes as any)['scan_room_test'];
    expect(scanNode.metadata.maskRegions).toHaveLength(1);
    expect(scanNode.metadata.maskRegions[0].id).toBe(maskRegion.id);
    expect(scanNode.metadata.maskRegions[0].itemId).toBe('item_chair_1');
    expect(scanNode.metadata.maskRegions[0].opacity).toBe(0.0);

    // 3. Undo: both item replacement and mask creation must revert in ONE step
    if (temporal && typeof temporal.getState === 'function') {
      temporal.getState().undo();

      const undoneScene = useScene.getState();
      const undoneChair = (undoneScene.nodes as any)['item_chair_1'];
      expect(undoneChair.name).toBe('Original Chair');
      expect(undoneChair.metadata?.maskRegionId).toBeUndefined();

      const undoneScan = (undoneScene.nodes as any)['scan_room_test'];
      expect(undoneScan.metadata.maskRegions).toHaveLength(0);

      // 4. Redo: both item replacement and mask creation must be restored
      temporal.getState().redo();

      const redoneScene = useScene.getState();
      const redoneChair = (redoneScene.nodes as any)['item_chair_1'];
      expect(redoneChair.name).toBe('Modern Accent Chair');

      const redoneScan = (redoneScene.nodes as any)['scan_room_test'];
      expect(redoneScan.metadata.maskRegions).toHaveLength(1);
      expect(redoneScan.metadata.maskRegions[0].id).toBe(maskRegion.id);
    }
  });

  it('toggles ghost mode between masked (0% opacity) and ghost (25% opacity)', () => {
    const scene = useScene.getState();
    scene.applyNodeChanges({
      create: [
        {
          node: {
            id: 'scan_node' as any,
            type: 'scan',
            name: 'Scan',
            url: '/scan.sog',
            visible: true,
            opacity: 100,
            metadata: {
              maskRegions: [
                {
                  id: 'mask_chair_1',
                  obb: { center: [1, 0.4, 1], size: [0.8, 0.8, 0.8], yaw: 0 },
                  feather: 0.05,
                  enabled: true,
                  ghost: false,
                  opacity: 0.0,
                },
              ],
            },
          } as any,
        },
      ],
    });

    // 1. Toggle ghost mode on
    const isGhost = toggleMaskGhostMode('scan_node', 'mask_chair_1');
    expect(isGhost).toBe(true);

    let scan = (useScene.getState().nodes as any)['scan_node'];
    expect(scan.metadata.maskRegions[0].ghost).toBe(true);
    expect(scan.metadata.maskRegions[0].opacity).toBe(0.25);

    // 2. Toggle ghost mode off
    const isGhostOff = toggleMaskGhostMode('scan_node', 'mask_chair_1');
    expect(isGhostOff).toBe(false);

    scan = (useScene.getState().nodes as any)['scan_node'];
    expect(scan.metadata.maskRegions[0].ghost).toBe(false);
    expect(scan.metadata.maskRegions[0].opacity).toBe(0.0);
  });

  it('resizes mask region and updates feather falloff', () => {
    const scene = useScene.getState();
    scene.applyNodeChanges({
      create: [
        {
          node: {
            id: 'scan_node' as any,
            type: 'scan',
            name: 'Scan',
            url: '/scan.sog',
            visible: true,
            opacity: 100,
            metadata: {
              maskRegions: [
                {
                  id: 'mask_test',
                  obb: { center: [0, 0.5, 0], size: [1.0, 1.0, 1.0], yaw: 0 },
                  feather: 0.05,
                  enabled: true,
                },
              ],
            },
          } as any,
        },
      ],
    });

    // Resize
    resizeMaskRegion('scan_node', 'mask_test', [1.5, 1.2, 1.4]);
    let scan = (useScene.getState().nodes as any)['scan_node'];
    expect(scan.metadata.maskRegions[0].obb.size).toEqual([1.5, 1.2, 1.4]);

    // Update feather falloff
    updateMaskRegion('scan_node', 'mask_test', { feather: 0.1 });
    scan = (useScene.getState().nodes as any)['scan_node'];
    expect(scan.metadata.maskRegions[0].feather).toBe(0.1);

    // Remove mask
    removeMaskRegion('scan_node', 'mask_test');
    scan = (useScene.getState().nodes as any)['scan_node'];
    expect(scan.metadata.maskRegions).toHaveLength(0);
  });
});
