import { afterEach, describe, expect, it } from 'vitest';
import { useScene } from '@pascal-app/core';
import { ConversionJobStatusSchema, type SegmentedObject } from '@/lib/contracts';
import { replaceScanNode } from '@/lib/pascal/scanNodes';
import { findScanNode, scanMetadata } from '@/lib/pascal/nodes';
import { planInterpretationNodes } from '@/lib/pascal/scanConverter';
import { undoSceneAction } from '@/lib/pascal/sceneBridge';
import { applySegmentedObjects, SEGMENTED_META_KEY } from '@/lib/scan/segmentedObjects';

const API = 'http://api.test';

function object(id: string, label: string, position: [number, number, number], rotationY: number): SegmentedObject {
  return {
    id,
    label,
    confidence: 0.9,
    meshAsset: {
      id: `asset_${id}`,
      name: label,
      source: 'segmented',
      url: `/api/projects/p1/assets/${'a'.repeat(63)}${id.length}.glb`,
      format: 'glb',
      dimensions: { width: 2, height: 0.9, depth: 0.85 },
      categories: [label],
    },
    placement: { position, rotationY },
    obb: { center: [position[0], 0.45, position[2]], size: [2, 0.9, 0.85], yaw: rotationY },
    maskRegionId: `mask_${id}`,
  };
}

const SOFA = object('seg_abc_0', 'sofa', [-1.4, 0, 1.1], 0);
const TABLE = object('seg_abc_1', 'table', [0.6, 0, -0.3], 0.35);
const nodes = () => useScene.getState().nodes as Record<string, any>;

describe('segmented objects -> Pascal items', () => {
  afterEach(() => {
    useScene.getState().clearScene();
    (useScene as any).temporal.getState().clear();
  });

  it('creates one item per object with its GLB, measured size and placement, plus linked masks, in one undo step', () => {
    const scanId = replaceScanNode('http://api.test/scan.ply', 'ply');
    const before = Object.keys(nodes()).length;
    const created = applySegmentedObjects([SOFA, TABLE], API);
    expect(created).toEqual(['item_seg_abc_0', 'item_seg_abc_1']);

    const sofa = nodes()['item_seg_abc_0'];
    expect(sofa).toMatchObject({ type: 'item', position: [-1.4, 0, 1.1], rotation: [0, 0, 0], parentId: nodes()[scanId].parentId });
    expect(sofa.asset).toMatchObject({ src: `${API}${SOFA.meshAsset.url}`, dimensions: [2, 0.9, 0.85], category: 'sofa' });
    expect(nodes()['item_seg_abc_1'].rotation).toEqual([0, 0.35, 0]);
    expect(sofa.metadata[SEGMENTED_META_KEY].id).toBe('seg_abc_0');

    const masks = scanMetadata(findScanNode()).maskRegions!;
    expect(masks.map((m) => m.id)).toEqual(['mask_seg_abc_0', 'mask_seg_abc_1']);
    expect(masks.every((m) => m.enabled)).toBe(true);
    expect(sofa.metadata.maskRegionId).toBe(masks[0].id);
    expect(masks[0].obb.center).toEqual(SOFA.obb.center);
    expect(masks[0].obb.size[0]).toBeGreaterThan(SOFA.obb.size[0]); // padded past the splat fringe

    // Applying again is a no-op rather than duplicating items.
    expect(applySegmentedObjects([SOFA, TABLE], API)).toEqual([]);

    undoSceneAction();
    expect(nodes()['item_seg_abc_0']).toBeUndefined();
    expect(nodes()['item_seg_abc_1']).toBeUndefined();
    expect(scanMetadata(findScanNode()).maskRegions).toEqual([]);
    expect(Object.keys(nodes()).length).toBe(before);
  });

  it('applies a baked floor texture when the room is built, and re-importing removes old objects', () => {
    replaceScanNode('http://api.test/scan.ply', 'ply');
    applySegmentedObjects([SOFA], API, [{ target: 'slab', textureAsset: '/api/projects/p1/assets/f.png', repeat: [0.1, 0.1], coverage: 0.9 }]);
    const plan = planInterpretationNodes(
      { provenance: 'auto', floor: { normal: [0, 1, 0], constant: 0, provenance: 'auto' }, ceilingHeight: 2.6, outline: [[0, 0], [4, 0], [4, 3]], walls: [], openings: [], detections: [] },
      nodes(),
    );
    const slab = plan.creates.find((c) => (c.node as any).type === 'slab')!.node as any;
    expect(slab.material.texture).toEqual({ url: `${API}/api/projects/p1/assets/f.png`, repeat: [0.1, 0.1] });

    replaceScanNode('http://api.test/other.ply', 'ply');
    expect(nodes()['item_seg_abc_0']).toBeUndefined();
  });

  it('parses a backend conversion status carrying objects', () => {
    const parsed = ConversionJobStatusSchema.parse({
      jobId: 'j', projectId: 'p1', scanAssetId: 's.ply', pointsAssetId: 's.ply', status: 'completed', stage: 'ready',
      stages: [{ name: 'objects', status: 'completed', detail: '2 objects separated', error: null }],
      objectsCount: 2, objects: [SOFA, TABLE], surfaces: [],
    });
    expect(parsed.objects).toHaveLength(2);
  });
});
