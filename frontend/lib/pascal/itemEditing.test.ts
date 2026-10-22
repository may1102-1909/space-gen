import { beforeEach, describe, expect, it } from 'vitest';
import { ItemNode, useScene } from '@pascal-app/core';
import {
  createItemNode,
  normalizeGlbBounds,
  replaceItemAsset,
  fetchCatalogItems,
} from './itemEditing';
import { undoSceneAction, redoSceneAction } from './sceneBridge';

describe('Pascal item editing and schema compliance', () => {
  beforeEach(() => {
    useScene.getState().clearScene();
    const temporal = useScene.temporal;
    if (temporal?.getState?.()?.clear) {
      temporal.getState().clear();
    }
  });

  describe('Schema conversion & createItemNode', () => {
    it('creates prefixed item ids and stores model URL and bounds in asset', () => {
      const node = createItemNode(
        {
          id: 'chair',
          name: 'Chair',
          category: 'chair',
          src: '/chair.glb',
          dimensions: [0.5, 0.8, 0.5],
        },
        'chair'
      );
      expect(node.id).toBe('item_chair');
      expect(node.asset.src).toBe('/chair.glb');
      expect(node.asset.dimensions).toEqual([0.5, 0.8, 0.5]);
      expect(node.children).toEqual([]);
      expect(node.position).toEqual([0, 0, 0]);
      expect(node.scale).toEqual([1, 1, 1]);
    });

    it('passes strict validation against Pascal core ItemNode zod schema', () => {
      const node = createItemNode({
        id: 'asset_lounge_chair',
        name: 'Lounge Chair',
        category: 'furniture',
        src: 'https://example.com/models/chair.glb',
        dimensions: [0.8, 0.85, 0.8],
        thumbnail: 'https://example.com/thumb.png',
        source: 'library',
      });

      const parsed = ItemNode.safeParse(node);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.id).toMatch(/^item_/);
        expect(parsed.data.type).toBe('item');
        expect(parsed.data.asset.src).toBe('https://example.com/models/chair.glb');
        expect(parsed.data.asset.dimensions).toEqual([0.8, 0.85, 0.8]);
      }
    });
  });

  describe('Item replacement logic', () => {
    it('keeps replacement yaw and footprint and rests the item at the floor (y=0)', () => {
      const old = createItemNode(
        {
          name: 'Old chair',
          category: 'chair',
          src: '/old.glb',
          dimensions: [0.5, 0.8, 0.5],
        },
        'item_old'
      );
      const positioned = {
        ...old,
        position: [2.5, 0.35, -1.2] as [number, number, number],
        rotation: [0.2, 1.4, 0.3] as [number, number, number],
      };
      const replaced = replaceItemAsset(positioned, {
        name: 'New chair',
        category: 'chair',
        src: '/new.glb',
        dimensions: [1.0, 1.0, 1.0],
      });

      expect(replaced.position).toEqual([2.5, 0, -1.2]);
      expect(replaced.rotation).toEqual([0, 1.4, 0]);
      expect(replaced.scale).toEqual([0.5, 0.8, 0.5]);
      expect(replaced.asset.src).toBe('/new.glb');
      expect(replaced.name).toBe('New chair');
    });

    it('accounts for existing node scale when calculating replacement footprint', () => {
      const old = createItemNode(
        {
          name: 'Scaled Table',
          category: 'table',
          src: '/table.glb',
          dimensions: [1.0, 0.75, 1.0],
        },
        'item_table'
      );
      // Item was scaled by 2x in width and 1.5x in depth
      const scaledOld = {
        ...old,
        position: [1, 0, 1] as [number, number, number],
        rotation: [0, 0.5, 0] as [number, number, number],
        scale: [2.0, 1.0, 1.5] as [number, number, number],
      };

      // Replacement asset is 0.5m x 0.5m x 0.5m
      const replaced = replaceItemAsset(scaledOld, {
        name: 'Replacement Desk',
        category: 'desk',
        src: '/desk.glb',
        dimensions: [0.5, 0.75, 0.5],
      });

      // Target effective width: 1.0 * 2.0 = 2.0m -> sx = 2.0 / 0.5 = 4.0
      // Target effective depth: 1.0 * 1.5 = 1.5m -> sz = 1.5 / 0.5 = 3.0
      expect(replaced.scale).toEqual([4.0, 1.0, 3.0]);
      expect(replaced.position).toEqual([1, 0, 1]);
      expect(replaced.rotation).toEqual([0, 0.5, 0]);
    });
  });

  describe('GLB bounds measurement and normalization', () => {
    it('normalizes GLB bounds in meters to a bottom-center origin', () => {
      const res = normalizeGlbBounds([-1, 0.2, -0.5], [1, 2.2, 0.5]);
      expect(res.dimensions).toEqual([2, 2, 1]);
      expect(res.offset).toEqual([0, -0.2, 0]);
      expect(res.unitScale).toBe(1);
    });

    it('detects and converts millimeter models (max dim > 50) into meters', () => {
      // Model authored in millimeters: 600mm wide, 900mm high, 600mm deep
      const res = normalizeGlbBounds([-300, 50, -300], [300, 950, 300]);
      expect(res.unitScale).toBe(0.001);
      expect(res.dimensions).toEqual([0.6, 0.9, 0.6]);
      expect(res.offset).toEqual([0, -50, 0]);
    });
  });

  describe('Placement, Compound Actions, and Undo/Redo Steps', () => {
    it('records 1 undo step on item placement, and reverts cleanly on undo', () => {
      const scene = useScene.getState();
      const getTemporal = () => useScene.temporal.getState();

      const item = createItemNode({
        id: 'chair_nordic',
        name: 'Nordic Chair',
        category: 'chair',
        src: '/samples/models/chair.glb',
        dimensions: [0.55, 0.85, 0.55],
      });

      // Place item
      scene.applyNodeChanges({ create: [{ node: item as any, parentId: undefined }] });

      expect(useScene.getState().nodes[item.id]).toBeDefined();
      expect(getTemporal().pastStates.length).toBe(1);

      // Undo placement
      undoSceneAction();
      expect(useScene.getState().nodes[item.id]).toBeUndefined();
      expect(getTemporal().pastStates.length).toBe(0);
      expect(getTemporal().futureStates.length).toBe(1);

      // Redo placement
      redoSceneAction();
      expect(useScene.getState().nodes[item.id]).toBeDefined();
      expect(getTemporal().pastStates.length).toBe(1);
    });

    it('records 1 undo step on item replacement, reverting to previous model on undo', () => {
      const scene = useScene.getState();
      const getTemporal = () => useScene.temporal.getState();

      const initialItem = createItemNode(
        {
          id: 'sofa_base',
          name: 'Original Sofa',
          category: 'sofa',
          src: '/samples/models/sofa.glb',
          dimensions: [2.0, 0.8, 0.9],
        },
        'item_sofa'
      );

      scene.applyNodeChanges({ create: [{ node: initialItem as any, parentId: undefined }] });
      expect(getTemporal().pastStates.length).toBe(1);

      // Replace the item
      const current = useScene.getState().nodes[initialItem.id] as any;
      const replaced = replaceItemAsset(current, {
        name: 'Luxury Velvet Sofa',
        category: 'sofa',
        src: '/samples/models/sofa_velvet.glb',
        dimensions: [2.2, 0.85, 0.95],
      });
      scene.updateNode(initialItem.id as any, replaced);

      expect(getTemporal().pastStates.length).toBe(2);
      expect((useScene.getState().nodes[initialItem.id] as any).asset.src).toBe(
        '/samples/models/sofa_velvet.glb'
      );

      // Undo replacement
      undoSceneAction();
      expect((useScene.getState().nodes[initialItem.id] as any).asset.src).toBe(
        '/samples/models/sofa.glb'
      );
      expect((useScene.getState().nodes[initialItem.id] as any).name).toBe('Original Sofa');

      // Redo replacement
      redoSceneAction();
      expect((useScene.getState().nodes[initialItem.id] as any).asset.src).toBe(
        '/samples/models/sofa_velvet.glb'
      );
    });

    it('groups compound multi-node edits into a single atomic undo step', () => {
      const scene = useScene.getState();
      const getTemporal = () => useScene.temporal.getState();

      const item1 = createItemNode({
        name: 'Desk',
        category: 'table',
        src: '/desk.glb',
        dimensions: [1.2, 0.75, 0.6],
      });
      const item2 = createItemNode({
        name: 'Office Chair',
        category: 'chair',
        src: '/chair.glb',
        dimensions: [0.6, 0.9, 0.6],
      });

      // Compound atomic edit: creating two nodes in a single applyNodeChanges call
      scene.applyNodeChanges({
        create: [
          { node: item1 as any, parentId: undefined },
          { node: item2 as any, parentId: undefined },
        ],
      });

      expect(useScene.getState().nodes[item1.id]).toBeDefined();
      expect(useScene.getState().nodes[item2.id]).toBeDefined();
      // Exactly 1 history entry for the entire compound operation
      expect(getTemporal().pastStates.length).toBe(1);

      // Undoing reverts BOTH nodes at once
      undoSceneAction();
      expect(useScene.getState().nodes[item1.id]).toBeUndefined();
      expect(useScene.getState().nodes[item2.id]).toBeUndefined();
      expect(getTemporal().pastStates.length).toBe(0);

      // Redoing restores BOTH nodes at once
      redoSceneAction();
      expect(useScene.getState().nodes[item1.id]).toBeDefined();
      expect(useScene.getState().nodes[item2.id]).toBeDefined();
    });
  });

  describe('Catalog items fetcher', () => {
    it('returns array of catalog items with valid dimensions and urls', async () => {
      // Mock global fetch for catalogManifest.json
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input: any) => {
        if (String(input).includes('/catalog/catalogManifest.json')) {
          return {
            ok: true,
            json: async () => ({
              version: '1.0.0',
              assets: [
                {
                  id: 'chair_mock',
                  name: 'Mock Dining Chair',
                  category: 'chair',
                  dimensions: [0.5, 0.8, 0.5],
                  modelUrl: '/samples/models/chair.glb',
                },
              ],
            }),
          } as any;
        }
        return originalFetch(input);
      };

      try {
        const items = await fetchCatalogItems();
        expect(Array.isArray(items)).toBe(true);
        const mockChair = items.find((i) => i.id === 'chair_mock');
        expect(mockChair).toBeDefined();
        expect(mockChair?.name).toBe('Mock Dining Chair');
        expect(mockChair?.dimensions.width_m).toBe(0.5);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
