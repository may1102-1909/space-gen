import { describe, expect, it } from 'vitest';
import { EditProposalSchema } from '@/lib/contracts';
import {
  frontOf,
  sceneFromDetections,
  solvePlacement,
  symmetryScore,
  toCandidatePlacements,
  toEditProposals,
  parsePlacementCount,
  validate,
  type PlacementAssetSpec,
  type PlacementLayout,
} from '@/lib/placement';
import { item, lRoom, realistic, rectRoom } from './fixtures';

const chair: PlacementAssetSpec = {
  url: '/assets/models/chair.glb',
  name: 'Dining Chair',
  category: 'chair',
  dimensions: { width: 0.45, height: 0.85, depth: 0.5 },
};

const facesPoint = (layout: PlacementLayout, target: [number, number]) =>
  layout.placements.every((p) => {
    const f = frontOf(p.rotationY);
    const to = [target[0] - p.position[0], target[1] - p.position[2]];
    const l = Math.hypot(to[0], to[1]);
    return (f[0] * to[0] + f[1] * to[1]) / l > 0.7;
  });

describe('solvePlacement — around an anchor', () => {
  const room = rectRoom(6, 5);
  const table = item('table_1', 'dining_table', [3, 0, 2.5], [1.8, 0.75, 0.9]);

  it('places 2 chairs on opposite long sides facing the table', () => {
    const [best] = solvePlacement({ asset: chair, count: 2 }, { items: [table] }, room);
    expect(best.strategy).toBe('around-anchor');
    expect(best.anchorId).toBe('table_1');
    expect(best.placements).toHaveLength(2);
    const zs = best.placements.map((p) => p.position[2]).sort();
    expect(zs[0]).toBeCloseTo(2.5 - 0.45 - 0.1 - 0.25);
    expect(zs[1]).toBeCloseTo(2.5 + 0.45 + 0.1 + 0.25);
    expect(facesPoint(best, [3, 2.5])).toBe(true);
    expect(best.symmetry).toBeGreaterThan(0.95);
  });

  it('fills 6 seats symmetrically with no errors and explains why', () => {
    const [best] = solvePlacement({ asset: chair, count: 6 }, { items: [table] }, room);
    expect(best.placements).toHaveLength(6);
    expect(best.placements.flatMap((p) => p.violations).filter((v) => v.severity === 'error')).toEqual([]);
    expect(best.symmetry).toBeGreaterThan(0.95);
    expect(best.reasons[0]).toContain('table_1');
    expect(best.reasons).toContain('All 6 placements are collision-free');
    best.placements.forEach((p) => expect(p.reasons.length).toBeGreaterThan(0));
  });

  it('every returned placement passes validate() against the scene plus its siblings', () => {
    const [best] = solvePlacement({ asset: chair, count: 4 }, { items: [table] }, room);
    best.placements.forEach((p, i) => {
      const siblings = best.placements
        .filter((_, j) => j !== i)
        .map((s, j) => item(`sib${j}`, 'chair', s.position, [0.45, 0.85, 0.5], s.rotationY, { groupId: 'table_1' }));
      const [proposal] = toEditProposals({ ...best, placements: [p] }, chair);
      const errors = validate(proposal, { items: [table, ...siblings] }, room, { category: 'chair' }).filter((v) => v.severity === 'error');
      expect(errors).toEqual([]);
    });
  });

  it('groups dining chairs around the dining table in the realistic room, avoiding the balcony door swing', () => {
    const scene = sceneFromDetections(realistic.interpretation);
    const layouts = solvePlacement({ asset: chair, count: 4 }, scene, realistic.interpretation);
    const best = layouts[0];
    expect(best.anchorId).toBe('det_dining_table');
    expect(best.placements).toHaveLength(4);
    expect(best.placements.flatMap((p) => p.violations).some((v) => v.severity === 'error')).toBe(false);
    // The east long side is inside the balcony door swing, so no seat is placed there.
    expect(best.placements.every((p) => p.position[0] < 7.2)).toBe(true);
    expect(facesPoint(best, [6.5, 2])).toBe(true);
  });

  it('reports partial layouts when not everything fits', () => {
    const tiny = rectRoom(2.2, 2.2);
    const small = item('t', 'table', [1.1, 0, 1.1], [0.6, 0.75, 0.6]);
    const layouts = solvePlacement({ asset: chair, count: 8 }, { items: [small] }, tiny);
    expect(layouts[0].placements.length).toBeLessThan(8);
    expect(layouts[0].reasons.some((r) => /^Only \d of 8 fit/.test(r))).toBe(true);
  });
});

describe('solvePlacement — along walls and facing a focal point', () => {
  it('backs storage against the longest free wall, centered and symmetric', () => {
    const shelf: PlacementAssetSpec = { url: '/shelf.glb', name: 'Shelf', category: 'storage', dimensions: { width: 0.8, height: 1.8, depth: 0.35 } };
    const layouts = solvePlacement({ asset: shelf, count: 3 }, { items: [] }, rectRoom(6, 4));
    const best = layouts[0];
    expect(best.strategy).toBe('along-wall');
    expect(['along-wall:wall_n', 'along-wall:wall_s']).toContain(best.id);
    expect(best.placements).toHaveLength(3);
    expect(best.symmetry).toBeGreaterThan(0.95);
    for (const p of best.placements) {
      const distToWall = best.id.endsWith('wall_n') ? p.position[2] : 4 - p.position[2];
      expect(distToWall).toBeCloseTo(0.1 + 0.175 + 0.02);
    }
  });

  it('arranges armchairs facing a TV when there is no anchor', () => {
    const tv = item('tv', 'tv_console', [3, 0, 0.35], [1.8, 0.5, 0.4]);
    const armchair: PlacementAssetSpec = { url: '/a.glb', name: 'Armchair', category: 'armchair', dimensions: { width: 0.8, height: 0.8, depth: 0.8 } };
    const layouts = solvePlacement({ asset: armchair, count: 2, topK: 10 }, { items: [tv] }, rectRoom(6, 5));
    const focal = layouts.find((l) => l.strategy === 'facing-focal');
    expect(focal).toBeDefined();
    expect(focal!.placements).toHaveLength(2);
    expect(facesPoint(focal!, [3, 0.35])).toBe(true);
    expect(focal!.symmetry).toBeGreaterThan(0.95);
    expect(focal!.reasons[0]).toContain('"tv"');
  });

  it('honours topK and sorts by score', () => {
    const layouts = solvePlacement({ asset: chair, count: 2, topK: 2 }, { items: [] }, rectRoom(6, 5));
    expect(layouts).toHaveLength(2);
    expect(layouts[0].score).toBeGreaterThanOrEqual(layouts[1].score);
  });
});

describe('solver outputs', () => {
  const room = rectRoom(6, 5);
  const table = item('table_1', 'dining_table', [3, 0, 2.5], [1.8, 0.75, 0.9]);
  const [best] = solvePlacement({ asset: chair, count: 2 }, { items: [table] }, room);

  it('emits schema-valid pending add EditProposals', () => {
    const proposals = toEditProposals(best, chair);
    expect(proposals).toHaveLength(2);
    for (const p of proposals) {
      expect(EditProposalSchema.parse(p)).toEqual(p);
      expect(p).toMatchObject({ op: 'add', status: 'pending', validation: { ok: true } });
      expect(p.rationale.length).toBeGreaterThan(10);
    }
  });

  it('emits CandidatePlacements for the preview HUD', () => {
    const candidates = toCandidatePlacements(best, chair);
    expect(candidates.map((c) => c.name)).toEqual(['Dining Chair #1', 'Dining Chair #2']);
    expect(candidates[0]).toMatchObject({ category: 'chair', modelUrl: chair.url, dimensions: [0.45, 0.85, 0.5], status: 'pending' });
    expect(candidates[0].rotation[1]).toBe(best.placements[0].rotationY);
  });

  it('scores symmetry', () => {
    const axis = [{ origin: [0, 0] as [number, number], dir: [0, 1] as [number, number] }];
    expect(symmetryScore([[-1, 0], [1, 0]], axis)).toBeCloseTo(1);
    expect(symmetryScore([[-1, 0], [2, 0]], axis)).toBeLessThan(0.1);
  });

  it('parses counts from prompts', () => {
    expect(parsePlacementCount('place 4 chairs around the table')).toBe(4);
    expect(parsePlacementCount('add three stools')).toBe(3);
    expect(parsePlacementCount('arrange chairs')).toBe(2);
    expect(parsePlacementCount('place 40 chairs')).toBe(12);
  });
});

describe('solvePlacement — non-rectangular rooms and determinism', () => {
  const stool: PlacementAssetSpec = { url: '/s.glb', name: 'Stool', category: 'stool', dimensions: { width: 0.4, height: 0.6, depth: 0.4 } };

  it('keeps every placement of every layout inside an L-shaped room', () => {
    const room = lRoom();
    const layouts = solvePlacement({ asset: stool, count: 3, topK: 5 }, { items: [] }, room);
    expect(layouts.length).toBeGreaterThan(0);
    for (const layout of layouts) {
      for (const p of layout.placements) {
        // The [3,6] x [3,6] quadrant is cut away.
        expect(p.position[0] < 3 || p.position[2] < 3).toBe(true);
        expect(p.violations.filter((v) => v.severity === 'error')).toEqual([]);
      }
    }
  });

  it('is deterministic', () => {
    const room = rectRoom(6, 5);
    const scene = { items: [item('table_1', 'dining_table', [3, 0, 2.5], [1.8, 0.75, 0.9])] };
    expect(solvePlacement({ asset: chair, count: 4 }, scene, room)).toEqual(solvePlacement({ asset: chair, count: 4 }, scene, room));
  });
});
