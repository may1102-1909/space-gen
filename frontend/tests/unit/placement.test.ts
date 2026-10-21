import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ProjectManifestSchema,
  type EditProposal,
  type RoomInterpretation,
} from '@/lib/contracts';
import type { ItemNode } from '@/lib/pascal/itemEditing';
import {
  validate,
  solvePlacements,
  toProposalValidation,
  type PlacementViolationCode,
  type PlacementRequest,
} from '@/lib/placement';

type V3 = [number, number, number];

function wall(id: string, a: [number, number], b: [number, number], thickness = 0.2) {
  return {
    id,
    start: [a[0], 0, a[1]] as V3,
    end: [b[0], 0, b[1]] as V3,
    height: 2.6,
    thickness,
    confidence: 1,
    provenance: 'auto' as const,
  };
}

function opening(id: string, wallId: string, kind: 'door' | 'window' | 'opening', offset: number, width: number, height: number, sill: number) {
  return { id, wallId, kind, offset, width, height, sill, confidence: 1, provenance: 'auto' as const };
}

function room(outline: Array<[number, number]>, openings: RoomInterpretation['openings'] = []): RoomInterpretation {
  const walls = outline.map((p, i) => wall(`w${i}`, p, outline[(i + 1) % outline.length]));
  return {
    provenance: 'auto',
    floor: { normal: [0, 1, 0], constant: 0, provenance: 'auto' },
    ceilingHeight: 2.6,
    outline,
    walls,
    openings,
    detections: [],
  };
}

/** 6 x 5 m room, x in [-3, 3], z in [-2.5, 2.5]. w0 = north (z=-2.5), w1 = east, w2 = south, w3 = west. */
const RECT: Array<[number, number]> = [[-3, -2.5], [3, -2.5], [3, 2.5], [-3, 2.5]];
const RECT_OPENINGS = [
  opening('door_s', 'w2', 'door', 1.0, 0.9, 2.1, 0), // hinge near wall start
  opening('win_n', 'w0', 'window', 1.0, 2.0, 1.2, 0.9),
];
const rectRoom = () => room(RECT, RECT_OPENINGS);

/** L-shaped room: the x>0, z>0 quadrant is cut away. */
const L_OUTLINE: Array<[number, number]> = [[-3, -2.5], [3, -2.5], [3, 0], [0, 0], [0, 2.5], [-3, 2.5]];
const lRoom = () => room(L_OUTLINE);

let seq = 0;
function item(name: string, category: string, pos: V3, dims: V3, yaw = 0): ItemNode {
  const id = `item_${name.replace(/\s+/g, '_').toLowerCase()}_${seq++}`;
  return {
    id,
    type: 'item',
    name,
    position: pos,
    rotation: [0, yaw, 0],
    scale: [1, 1, 1],
    asset: { id: `a_${id}`, name, category, src: `/models/${category}.glb`, dimensions: dims },
    metadata: {},
  } as unknown as ItemNode;
}

function proposal(category: string, pos: V3, dims: V3, yaw = 0, extra: Partial<EditProposal> = {}): EditProposal {
  return {
    id: 'prop_1',
    op: 'add',
    asset: { source: 'catalog', url: `/models/${category}.glb`, dimensions: { width: dims[0], height: dims[1], depth: dims[2] } },
    transform: { position: pos, rotationY: yaw, scale: [1, 1, 1] },
    rationale: 'test',
    validation: { ok: true, violations: [] },
    status: 'pending',
    ...extra,
  };
}

const codes = (vs: Array<{ code: PlacementViolationCode }>) => vs.map((v) => v.code);

describe('placement validator rules (rectangular fixture room)', () => {
  const interp = rectRoom();
  const sofa = item('Sofa', 'sofa', [0, 0, 0], [2, 0.8, 0.9]);
  const table = item('Round Table', 'table', [0, 0, 0], [1.2, 0.75, 0.8]);

  it('accepts a clear placement with no violations', () => {
    expect(validate(proposal('chair', [-1.5, 0, -1], [0.5, 0.9, 0.5]), [sofa], interp, { category: 'chair' })).toEqual([]);
  });

  it('OUTSIDE_ROOM: flags an item beyond the outline', () => {
    const v = validate(proposal('chair', [3.6, 0, 0], [0.5, 0.9, 0.5]), [], interp, { category: 'chair' });
    expect(codes(v)).toContain('OUTSIDE_ROOM');
    expect(v.find((x) => x.code === 'OUTSIDE_ROOM')?.severity).toBe('error');
  });

  it('OVERLAP_WALL: flags penetration into a wall slab but not touching it', () => {
    const into = validate(proposal('chair', [2.74, 0, 0], [0.5, 0.9, 0.5]), [], interp, { category: 'chair' });
    expect(codes(into)).toContain('OVERLAP_WALL');
    expect(codes(into)).not.toContain('OUTSIDE_ROOM');
    const flush = validate(proposal('chair', [2.65, 0, 0], [0.5, 0.9, 0.5]), [], interp, { category: 'chair' });
    expect(codes(flush)).not.toContain('OVERLAP_WALL');
  });

  it('OVERLAP_ITEM: flags OBB overlap, honours the tolerance and rotation', () => {
    const overlap = validate(proposal('chair', [0.2, 0, 0], [0.5, 0.9, 0.5]), [sofa], interp, { category: 'chair' });
    expect(codes(overlap)).toContain('OVERLAP_ITEM');
    // 1 cm penetration is inside the 2 cm tolerance.
    const grazing = validate(proposal('chair', [1.26, 0, 0], [0.5, 0.9, 0.5]), [sofa], interp, { category: 'chair' });
    expect(codes(grazing)).not.toContain('OVERLAP_ITEM');
    // A box rotated 45 degrees whose AABB overlaps but whose OBB corner misses the sofa.
    const rotated = validate(proposal('stool', [1.62, 0, 0.84], [0.5, 0.5, 0.5], Math.PI / 4), [sofa], interp, { category: 'stool' });
    expect(codes(rotated)).not.toContain('OVERLAP_ITEM');
  });

  it('OVERLAP_ITEM: items at different heights do not collide', () => {
    const lamp = proposal('lamp', [0, 1.5, 0], [0.3, 0.3, 0.3]);
    const v = validate(lamp, [sofa], interp, { category: 'lamp' });
    expect(codes(v)).not.toContain('OVERLAP_ITEM');
  });

  it('DOOR_SWING: flags items inside the door sweep, not outside it', () => {
    // door_s hinges at x = 2 (w2 runs from x = 3 towards -3) and sweeps towards -x into the room.
    const inSwing = validate(proposal('chair', [1.6, 0, 1.9], [0.4, 0.8, 0.4]), [], interp, { category: 'chair' });
    expect(codes(inSwing)).toContain('DOOR_SWING');
    const away = validate(proposal('chair', [-1.5, 0, 1.9], [0.4, 0.8, 0.4]), [], interp, { category: 'chair' });
    expect(codes(away)).not.toContain('DOOR_SWING');
  });

  it('DOOR_SWING: doorHinge option selects which leaf is swept', () => {
    // Inside the start-hinge quarter disc but outside the end-hinge one, and vice versa.
    const nearStartHinge = proposal('chair', [1.9, 0, 1.55], [0.2, 0.8, 0.2]);
    const nearEndHinge = proposal('chair', [1.2, 0, 1.55], [0.2, 0.8, 0.2]);
    const has = (p: EditProposal, doorHinge: 'start' | 'end' | 'both') =>
      codes(validate(p, [], interp, { category: 'chair', doorHinge })).includes('DOOR_SWING');
    expect(has(nearStartHinge, 'start')).toBe(true);
    expect(has(nearStartHinge, 'end')).toBe(false);
    expect(has(nearEndHinge, 'end')).toBe(true);
    expect(has(nearStartHinge, 'both') && has(nearEndHinge, 'both')).toBe(true);
  });

  it('WINDOW_SILL: tall items block the window zone, low items do not', () => {
    const tall = validate(proposal('wardrobe', [-1, 0, -2.2], [0.8, 2, 0.4]), [], interp, { category: 'wardrobe' });
    expect(codes(tall)).toContain('WINDOW_SILL');
    const low = validate(proposal('cabinet', [-1, 0, -2.2], [0.8, 0.5, 0.4]), [], interp, { category: 'cabinet' });
    expect(codes(low)).not.toContain('WINDOW_SILL');
    const elsewhere = validate(proposal('wardrobe', [2, 0, -2.2], [0.8, 2, 0.4]), [], interp, { category: 'wardrobe' });
    expect(codes(elsewhere)).not.toContain('WINDOW_SILL');
  });

  it('NOT_SUPPORTED: floating, below floor, wall-mounted and stacked cases', () => {
    const floating = validate(proposal('shelf', [0, 1.2, 1], [0.6, 0.3, 0.3]), [], interp, { category: 'shelf' });
    expect(floating.find((v) => v.code === 'NOT_SUPPORTED')?.details.reason).toBe('floating');
    const below = validate(proposal('shelf', [0, -0.5, 1], [0.6, 0.3, 0.3]), [], interp, { category: 'shelf' });
    expect(below.find((v) => v.code === 'NOT_SUPPORTED')?.details.reason).toBe('below_floor');
    // Attached to the east wall face (x = 2.9).
    const mounted = validate(proposal('shelf', [2.75, 1.2, 0], [0.3, 0.3, 0.6]), [], interp, { category: 'shelf' });
    expect(codes(mounted)).not.toContain('NOT_SUPPORTED');
    // Resting on the table top (0.75 m).
    const stacked = validate(proposal('lamp', [0, 0.75, 0], [0.3, 0.4, 0.3]), [table], interp, { category: 'lamp' });
    expect(codes(stacked)).not.toContain('NOT_SUPPORTED');
  });

  it('WALKWAY: warns when the corridor between furniture is under the minimum and honours the option', () => {
    const p = proposal('bookcase', [0, 0, 1.1], [1, 1.8, 0.4]);
    const v = validate(p, [table], interp, { category: 'bookcase' });
    const w = v.find((x) => x.code === 'WALKWAY');
    expect(w?.severity).toBe('warning');
    expect(w?.details.gap).toBeCloseTo(0.5, 2);
    expect(codes(validate(p, [table], interp, { category: 'bookcase', walkwayMin: 0.4 }))).not.toContain('WALKWAY');
    // A wider gap (0.95 m to both table and east wall) passes the default 0.9 m rule.
    const wide = validate(proposal('bookcase', [1.75, 0, 0], [1, 1.8, 0.4], Math.PI / 2), [table], interp, { category: 'bookcase' });
    expect(codes(wide)).not.toContain('WALKWAY');
  });

  it('FRONT_CLEARANCE: warns when the front faces a wall or another item', () => {
    const facingWall = validate(proposal('bookcase', [-1, 0, 2.0], [1, 1.8, 0.4], 0), [], interp, { category: 'bookcase' });
    expect(facingWall.find((v) => v.code === 'FRONT_CLEARANCE')?.severity).toBe('warning');
    const facingRoom = validate(proposal('bookcase', [-1, 0, 2.0], [1, 1.8, 0.4], Math.PI), [], interp, { category: 'bookcase' });
    expect(codes(facingRoom)).not.toContain('FRONT_CLEARANCE');
    // Blocking the front of an existing wardrobe (faces +z from z = -1).
    const wardrobe = item('Wardrobe', 'wardrobe', [1.5, 0, -1.4], [1, 2, 0.6]);
    const blocking = validate(proposal('table', [1.5, 0, -0.6], [0.6, 0.7, 0.4]), [wardrobe], interp, { category: 'table' });
    expect(blocking.some((v) => v.code === 'FRONT_CLEARANCE' && v.nodeIds.includes(wardrobe.id))).toBe(true);
  });

  it('open "opening" kinds reserve a walkway-wide strip', () => {
    const withOpening = room(RECT, [opening('arch', 'w1', 'opening', 1.0, 1.2, 2.1, 0)]);
    const v = validate(proposal('chair', [2.3, 0, -1.0], [0.4, 0.8, 0.4]), [], withOpening, { category: 'chair' });
    expect(codes(v)).toContain('DOOR_SWING');
  });

  it('move proposals ignore the target node itself; remove has no violations', () => {
    const chair = item('Chair', 'chair', [-1.5, 0, -1], [0.5, 0.9, 0.5]);
    const move = proposal('chair', [-1.4, 0, -1], [0.5, 0.9, 0.5], 0, { op: 'move', targetNodeId: chair.id, asset: null });
    expect(codes(validate(move, [chair], interp))).not.toContain('OVERLAP_ITEM');
    const remove = proposal('chair', [9, 0, 9], [0.5, 0.9, 0.5], 0, { op: 'remove', targetNodeId: chair.id, asset: null, transform: null });
    expect(validate(remove, [chair], interp)).toEqual([]);
  });

  it('maps violations onto the ProposalValidation contract', () => {
    const bad = validate(proposal('chair', [0.2, 0, 0], [0.5, 0.9, 0.5]), [sofa], interp, { category: 'chair' });
    const mapped = toProposalValidation(bad);
    expect(mapped.ok).toBe(false);
    expect(mapped.violations.some((v) => v.rule === 'OVERLAP_ITEM' && v.severity === 'error')).toBe(true);
    const warningOnly = toProposalValidation(
      validate(proposal('bookcase', [0, 0, 1.1], [1, 1.8, 0.4]), [table], interp, { category: 'bookcase' })
    );
    expect(warningOnly.ok).toBe(true);
    expect(warningOnly.violations.length).toBeGreaterThan(0);
  });

  it('treats non-rejected detections as obstacles and ignores rejected ones', () => {
    const withDetections: RoomInterpretation = {
      ...interp,
      detections: [
        { id: 'det_a', category: 'sofa', label: 'Scanned sofa', obb: { center: [0, 0.4, 0], size: [2, 0.8, 0.9], yaw: 0 }, confidence: 0.9, status: 'auto', provenance: 'auto' },
        { id: 'det_b', category: 'sofa', label: 'Bad sofa', obb: { center: [-2, 0.4, -1], size: [2, 0.8, 0.9], yaw: 0 }, confidence: 0.4, status: 'rejected', provenance: 'auto' },
      ],
    };
    const onDetection = validate(proposal('chair', [0.2, 0, 0], [0.5, 0.9, 0.5]), [], withDetections, { category: 'chair' });
    expect(onDetection.some((v) => v.code === 'OVERLAP_ITEM' && v.nodeIds.includes('det_a'))).toBe(true);
    const onRejected = validate(proposal('chair', [-2, 0, -1], [0.5, 0.9, 0.5]), [], withDetections, { category: 'chair' });
    expect(onRejected.some((v) => v.nodeIds.includes('det_b'))).toBe(false);
  });
});

describe('placement validator on an L-shaped room', () => {
  const interp = lRoom();

  it('rejects an item in the cut-away quadrant even though it is inside the bounding box', () => {
    const v = validate(proposal('chair', [2, 0, 1.5], [0.5, 0.9, 0.5]), [], interp, { category: 'chair' });
    expect(codes(v)).toContain('OUTSIDE_ROOM');
  });

  it('rejects an item straddling the reflex corner', () => {
    const v = validate(proposal('table', [-0.3, 0, 0.3], [1, 0.75, 1]), [], interp, { category: 'table' });
    expect(codes(v)).toContain('OUTSIDE_ROOM');
  });

  it('accepts items in both legs of the L', () => {
    expect(codes(validate(proposal('chair', [2, 0, -1.2], [0.5, 0.9, 0.5]), [], interp, { category: 'chair' }))).not.toContain('OUTSIDE_ROOM');
    expect(codes(validate(proposal('chair', [-1.5, 0, 1.5], [0.5, 0.9, 0.5]), [], interp, { category: 'chair' }))).not.toContain('OUTSIDE_ROOM');
  });

  it('inward wall normals follow the outline so inner walls block from the right side', () => {
    // The notch wall w3 runs along x = 0 for z in [0, 2.5]; an item touching its inner face is fine, one in it is not.
    const ok = validate(proposal('chair', [-0.4, 0, 1.5], [0.5, 0.9, 0.5]), [], interp, { category: 'chair' });
    expect(codes(ok)).not.toContain('OVERLAP_WALL');
    const bad = validate(proposal('chair', [-0.15, 0, 1.5], [0.5, 0.9, 0.5]), [], interp, { category: 'chair' });
    expect(codes(bad)).toContain('OVERLAP_WALL');
  });

  it('solver keeps every placement inside the L', () => {
    const sofa = item('Sofa', 'sofa', [-1.5, 0, -2.0], [2, 0.8, 0.9]);
    const layouts = solvePlacements(
      { asset: { url: '/models/chair.glb', name: 'Chair', category: 'chair', dimensions: [0.5, 0.9, 0.5] }, count: 3, topK: 3 },
      [sofa],
      interp
    );
    expect(layouts.length).toBeGreaterThan(0);
    for (const layout of layouts) {
      for (const p of layout.placements) {
        const v = validate(proposal('chair', p.position, [0.5, 0.9, 0.5], p.rotationY), [sofa], interp, { category: 'chair' });
        expect(v.filter((x) => x.severity === 'error' && x.nodeIds.length && x.code !== 'OVERLAP_ITEM')).toEqual([]);
        expect(p.position[0] < 0 || p.position[2] < 0).toBe(true);
      }
    }
  });
});

describe('placement solver', () => {
  const interp = rectRoom();
  const table = item('Dining Table', 'dining_table', [0, 0, 0], [1.8, 0.75, 0.9]);
  const chairReq = (count: number, topK = 3): PlacementRequest => ({
    asset: { url: '/models/chair.glb', name: 'Chair', category: 'chair', dimensions: [0.5, 0.9, 0.5] },
    count,
    topK,
  });

  it('returns up to top-k ranked layouts with reasons and score breakdowns', () => {
    const layouts = solvePlacements(chairReq(4, 3), [table], interp);
    expect(layouts.length).toBeGreaterThan(0);
    expect(layouts.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < layouts.length; i++) {
      expect(layouts[i - 1].placements.length).toBeGreaterThanOrEqual(layouts[i].placements.length);
    }
    for (const layout of layouts) {
      expect(layout.reasons.length).toBeGreaterThan(0);
      expect(layout.placements).toHaveLength(4);
      for (const p of layout.placements) {
        expect(p.reasons.length).toBeGreaterThan(0);
        expect(p.score).toBeGreaterThan(0);
        for (const k of ['validity', 'clearance', 'anchor', 'alignment', 'symmetry'] as const) {
          expect(p.breakdown[k]).toBeGreaterThanOrEqual(0);
          expect(p.breakdown[k]).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('chairs go around the table, face it, and pass validation', () => {
    const [best] = solvePlacements(chairReq(2), [table], interp);
    expect(best.placements.map((p) => p.strategy)).toEqual(['anchor', 'anchor']);
    expect(best.placements.every((p) => p.anchorId === table.id)).toBe(true);
    // Prefers the long sides (north/south), mirrored, facing the table.
    expect(best.placements.map((p) => p.side).sort()).toEqual(['north', 'south']);
    for (const p of best.placements) {
      const toTable = Math.atan2(-p.position[0], -p.position[2]);
      expect(Math.cos(p.rotationY - toTable)).toBeGreaterThan(0.99);
      const errors = validate(proposal('chair', p.position, [0.5, 0.9, 0.5], p.rotationY), [table], interp, { category: 'chair' }).filter((v) => v.severity === 'error');
      expect(errors).toEqual([]);
    }
    expect(best.placements[0].position[2]).toBeCloseTo(-best.placements[1].position[2], 2);
  });

  it('placed instances never overlap each other', () => {
    const [best] = solvePlacements(chairReq(6), [table], interp);
    const ps = best.placements;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const d = Math.hypot(ps[i].position[0] - ps[j].position[0], ps[i].position[2] - ps[j].position[2]);
        expect(d).toBeGreaterThan(0.45);
      }
    }
  });

  it('wall-loving assets are placed against walls with an explanatory reason', () => {
    const [best] = solvePlacements(
      { asset: { url: '/models/bookcase.glb', name: 'Bookcase', category: 'bookcase', dimensions: [1, 1.8, 0.4] }, count: 1, topK: 2 },
      [],
      interp
    );
    const p = best.placements[0];
    expect(p.strategy).toBe('wall');
    expect(p.reasons.join(' ')).toContain('wall');
    expect(Math.max(Math.abs(p.position[0]) - 3, Math.abs(p.position[2]) - 2.5)).toBeGreaterThan(-0.6);
  });

  it('respects explicit focal points for free-standing assets', () => {
    const [best] = solvePlacements(
      { asset: { url: '/models/plant.glb', name: 'Armchair', category: 'armchair', dimensions: [0.8, 0.9, 0.8] }, count: 1, anchorCategories: ['nothing_matches'], focalPoints: [[2, -1]], topK: 1 },
      [],
      interp
    );
    const p = best.placements[0];
    const want = Math.atan2(2 - p.position[0], -1 - p.position[2]);
    expect(Math.cos(p.rotationY - want)).toBeGreaterThan(0.99);
  });

  it('returns nothing when the asset cannot fit', () => {
    const layouts = solvePlacements(
      { asset: { url: '/models/sofa.glb', name: 'Huge', category: 'sofa', dimensions: [9, 1, 9] }, count: 1 },
      [],
      interp
    );
    expect(layouts).toEqual([]);
  });

  it('is deterministic', () => {
    const a = solvePlacements(chairReq(3), [table], interp);
    const b = solvePlacements(chairReq(3), [table], interp);
    expect(b).toEqual(a);
  });
});

describe('realistic_room fixture', () => {
  it('validates and solves against the canonical contract fixture', () => {
    const manifest = ProjectManifestSchema.parse(
      JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/realistic_room.json'), 'utf-8'))
    );
    const { interpretation } = manifest;
    const layouts = solvePlacements(
      { asset: { url: '/models/stool.glb', name: 'Stool', category: 'stool', dimensions: [0.35, 0.5, 0.35] }, count: 1, topK: 2 },
      [],
      interpretation
    );
    expect(Array.isArray(layouts)).toBe(true);
    if (layouts.length) {
      const p = layouts[0].placements[0];
      const v = validate(proposal('stool', p.position, [0.35, 0.5, 0.35], p.rotationY), [], interpretation, { category: 'stool' });
      expect(v.filter((x) => x.severity === 'error')).toEqual([]);
    }
  });
});

describe('placement performance', () => {
  const big: Array<[number, number]> = [[-6, -5], [6, -5], [6, 5], [-6, 5]];
  const interp = room(big, [opening('door_s', 'w2', 'door', 2, 0.9, 2.1, 0), opening('win_n', 'w0', 'window', 3, 2, 1.2, 0.9)]);
  const scene: ItemNode[] = [];
  for (let i = 0; i < 30; i++) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    scene.push(item(`Box ${i}`, i % 3 === 0 ? 'table' : i % 3 === 1 ? 'chair' : 'cabinet', [-4.5 + col * 1.8, 0, -3.6 + row * 1.8], [0.7, 0.8, 0.7], (i % 4) * (Math.PI / 8)));
  }

  const median = (fn: () => void, runs = 9) => {
    fn(); // warm-up (JIT + room cache)
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      fn();
      times.push(performance.now() - t0);
    }
    return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
  };

  it('validate() with 30 items takes < 50 ms (median)', () => {
    const p = proposal('chair', [0.9, 0, 0.9], [0.5, 0.9, 0.5], 0.3);
    const ms = median(() => validate(p, scene, interp, { category: 'chair' }));
    console.info(`[perf] validate, 30 items: median ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(50);
  });

  it('solvePlacements() with 30 items takes < 50 ms (median)', () => {
    const req: PlacementRequest = { asset: { url: '/models/chair.glb', name: 'Chair', category: 'chair', dimensions: [0.5, 0.9, 0.5] }, count: 2, topK: 3 };
    let result = solvePlacements(req, scene, interp);
    const ms = median(() => {
      result = solvePlacements(req, scene, interp);
    });
    console.info(`[perf] solvePlacements, 30 items: median ${ms.toFixed(2)} ms (${result.length} layouts)`);
    expect(result.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });
});
