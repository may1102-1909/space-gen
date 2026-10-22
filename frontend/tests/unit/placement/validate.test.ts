import { describe, expect, it } from 'vitest';
import type { EditProposal } from '@/lib/contracts';
import { ViolationSchema } from '@/lib/contracts';
import {
  interpretationFromPascalNodes,
  sceneFromDetections,
  sceneFromPascalNodes,
  toProposalValidation,
  validate,
} from '@/lib/placement';
import { addProposal, item, opening, realistic, rectRoom } from './fixtures';

const scene = sceneFromDetections(realistic.interpretation);
const chairDims = { width: 0.45, height: 0.85, depth: 0.5 };

const move = (targetNodeId: string, position: [number, number, number], rotationY = 0): EditProposal => ({
  ...addProposal(position, chairDims, rotationY),
  op: 'move',
  targetNodeId,
  asset: null,
});

describe('validate (realistic_room fixture)', () => {
  it('accepts a chair added in open floor space and returns contract violations', () => {
    const v = validate(addProposal([2, 0, 2], chairDims), scene, realistic.interpretation, { category: 'chair' });
    expect(v).toEqual([]);
  });

  it('flags an addition on top of the coffee table', () => {
    const v = validate(addProposal([4, 0, 3.2], chairDims), scene, realistic.interpretation);
    expect(v.map((x) => x.rule)).toContain('item-overlap');
    expect(v.find((x) => x.rule === 'item-overlap')!.nodeIds).toContain('det_coffee_table');
    v.forEach((x) => expect(ViolationSchema.parse(x)).toEqual(x));
  });

  it('flags moving the sofa into the main door swing', () => {
    const v = validate(move('det_sofa_01', [6, 0, 5.4]), scene, realistic.interpretation);
    expect(v.find((x) => x.rule === 'door-clearance')?.nodeIds).toEqual(['det_sofa_01', 'door_main']);
  });

  it('reports that the as-scanned dining table blocks the balcony door swing', () => {
    const table = scene.items.find((i) => i.id === 'det_dining_table')!;
    const v = validate(
      { ...move('det_dining_table', [6.5, 0, 2], table.obb.yaw), transform: { position: [6.5, 0, 2], rotationY: table.obb.yaw, scale: [1, 1, 1] } },
      scene,
      realistic.interpretation,
    );
    expect(v.map((x) => x.rule)).toEqual(['door-clearance']);
    expect(v[0].nodeIds).toEqual(['det_dining_table', 'door_balcony']);
  });

  it('excludes the moved item from its own obstacles', () => {
    const sofa = scene.items.find((i) => i.id === 'det_sofa_01')!;
    expect(validate(move('det_sofa_01', [4, 0, 4.5]), scene, realistic.interpretation)).toEqual([]);
    expect(sofa.obb.center).toEqual([4, 0.45, 4.5]);
  });

  it('uses replacement dimensions with the target transform', () => {
    const replace: EditProposal = {
      ...addProposal([0, 0, 0], { width: 3.2, height: 0.9, depth: 1.0 }),
      op: 'replace',
      targetNodeId: 'det_sofa_01',
      transform: null,
    };
    expect(validate(replace, scene, realistic.interpretation).map((x) => x.rule)).toContain('item-overlap');
  });

  it('applies transform scale', () => {
    const wide = { ...addProposal([2, 0, 2], chairDims), transform: { position: [2, 0, 2] as [number, number, number], rotationY: 0, scale: [10, 1, 1] as [number, number, number] } };
    expect(validate(wide, scene, realistic.interpretation, { rules: ['inside-room'] }).map((x) => x.rule)).toEqual(['inside-room']);
  });

  it('handles remove, missing targets and incomplete proposals', () => {
    expect(validate({ ...move('det_sofa_01', [0, 0, 0]), op: 'remove', transform: null }, scene, realistic.interpretation)).toEqual([]);
    expect(validate(move('item_nope', [1, 0, 1]), scene, realistic.interpretation)[0].rule).toBe('target-missing');
    expect(validate({ ...addProposal([1, 0, 1], chairDims), transform: null }, scene, realistic.interpretation)[0].rule).toBe(
      'proposal-incomplete',
    );
  });

  it('passes config and rule selection through', () => {
    const room = rectRoom(5, 4, [opening({ id: 'd', wallId: 'wall_s', kind: 'door', offset: 2.5, width: 0.9 })]);
    const p = addProposal([2.5, 0, 3], chairDims);
    expect(validate(p, { items: [] }, room).map((x) => x.rule)).toContain('door-clearance');
    expect(validate(p, { items: [] }, room, { config: { doorSwingFactor: 0.3, doorClearanceMargin: 0 } }).map((x) => x.rule)).not.toContain(
      'door-clearance',
    );
    expect(validate(p, { items: [] }, room, { rules: ['support'] })).toEqual([]);
  });

  it('packs violations into a ProposalValidation', () => {
    expect(toProposalValidation([]).ok).toBe(true);
    expect(toProposalValidation([{ rule: 'walkway', severity: 'warning', detail: '', nodeIds: [] }]).ok).toBe(true);
    expect(toProposalValidation([{ rule: 'support', severity: 'error', detail: '', nodeIds: [] }]).ok).toBe(false);
  });
});

describe('Pascal scene adapter', () => {
  const resolveDimensions = (src: string) => {
    const a = realistic.assets.find((x) => x.url === src);
    return a ? ([a.dimensions.width, a.dimensions.height, a.dimensions.depth] as [number, number, number]) : undefined;
  };

  it('derives placement items from the fixture Pascal snapshot', () => {
    const { items } = sceneFromPascalNodes(realistic.sceneSnapshot, { resolveDimensions });
    expect(items.map((i) => i.id).sort()).toEqual([
      'item_chair_left',
      'item_chair_right',
      'item_coffee_table',
      'item_dining_table',
      'item_sofa_01',
      'item_tv_console',
    ]);
    const sofa = items.find((i) => i.id === 'item_sofa_01')!;
    expect(sofa.category).toBe('sofa');
    expect(sofa.obb).toEqual({ center: [4, 0.45, 4.5], size: [2.2, 0.9, 0.95], yaw: 0 });
    expect(items.find((i) => i.id === 'item_dining_table')!.category).toBe('dining_table');
  });

  it('prefers asset.dimensions and applies node scale', () => {
    const { items } = sceneFromPascalNodes({
      item_a: { id: 'item_a', type: 'item', name: 'A', position: [1, 0, 1], rotation: [0, 0.5, 0], scale: [2, 1, 1], asset: { src: '/x.glb', category: 'Desk', dimensions: [1, 0.75, 0.6] } },
    });
    expect(items[0]).toMatchObject({ category: 'desk', obb: { center: [1, 0.375, 1], size: [2, 0.75, 0.6], yaw: 0.5 } });
  });

  it('places wall-hosted items flush against their wall', () => {
    const nodes = {
      wall_a: { id: 'wall_a', type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.2, height: 2.7 },
      item_s: { id: 'item_s', type: 'item', parentId: 'wall_a', wallId: 'wall_a', position: [2, 1.2, 0], asset: { src: '/shelf.glb', attachTo: 'wall', dimensions: [1, 0.3, 0.3] } },
    };
    const [shelf] = sceneFromPascalNodes(nodes).items;
    expect(shelf.attachTo).toBe('wall');
    expect(shelf.obb.center[0]).toBeCloseTo(2);
    expect(shelf.obb.center[2]).toBeCloseTo(0.25);
    expect(shelf.obb.yaw).toBeCloseTo(0);
  });

  it('builds a RoomInterpretation from Pascal walls, openings and slab', () => {
    const nodes = {
      level_1: { id: 'level_1', type: 'level', height: 2.6 },
      slab_1: { id: 'slab_1', type: 'slab', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] },
      wall_a: { id: 'wall_a', type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.15 },
      door_1: { id: 'door_1', type: 'door', parentId: 'wall_a', offset: 1, width: 0.8, height: 2 },
      window_1: { id: 'window_1', type: 'window', wallId: 'wall_a', position: [3, 1.5, 0], width: 1, height: 1 },
    };
    const interp = interpretationFromPascalNodes(nodes);
    expect(interp.ceilingHeight).toBe(2.6);
    expect(interp.outline).toEqual([[0, 0], [4, 0], [4, 3], [0, 3]]);
    expect(interp.walls[0]).toMatchObject({ id: 'wall_a', start: [0, 0, 0], end: [4, 0, 0], thickness: 0.15, height: 2.6 });
    expect(interp.openings).toEqual([
      expect.objectContaining({ id: 'door_1', kind: 'door', offset: 1, width: 0.8, sill: 0 }),
      expect.objectContaining({ id: 'window_1', kind: 'window', offset: 3, sill: 1 }),
    ]);
    const v = validate(addProposal([1, 0, 0.5], chairDims), { items: [] }, interp);
    expect(v.map((x) => x.rule)).toContain('door-clearance');
  });

  it('turns detections into items and skips rejected ones', () => {
    const interp = { ...realistic.interpretation, detections: realistic.interpretation.detections.map((d, i) => (i === 0 ? { ...d, status: 'rejected' as const } : d)) };
    expect(sceneFromDetections(interp).items).toHaveLength(realistic.interpretation.detections.length - 1);
    expect(item('x', 'chair', [0, 0, 0], [1, 1, 1]).obb.center[1]).toBe(0.5);
  });
});
