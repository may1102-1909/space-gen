import { describe, expect, it } from 'vitest';
import {
  buildRoom,
  checkDoorClearance,
  checkFrontClearance,
  checkInsideRoom,
  checkItemOverlap,
  checkSupport,
  checkWalkway,
  checkWallOverlap,
  checkWindowSill,
  resolveConfig,
  type PlacementConfig,
  type PlacementItem,
  type RuleContext,
} from '@/lib/placement';
import type { RoomInterpretation } from '@/lib/contracts';
import { item, lRoom, opening, rectRoom } from './fixtures';

const ctx = (interp: RoomInterpretation, obstacles: PlacementItem[] = []): RuleContext => ({
  room: buildRoom(interp),
  obstacles,
});
const cfg = (partial?: Partial<PlacementConfig>) => resolveConfig(partial);
const rules = (vs: { rule: string }[]) => vs.map((v) => v.rule);

describe('checkInsideRoom', () => {
  const room = rectRoom(5, 4);

  it('accepts an item well inside the outline', () => {
    expect(checkInsideRoom(item('a', 'chair', [2.5, 0, 2], [1, 1, 1]), ctx(room), cfg())).toEqual([]);
  });

  it('flags an item that crosses the outline', () => {
    const v = checkInsideRoom(item('a', 'chair', [5.2, 0, 2], [1, 1, 1]), ctx(room), cfg());
    expect(rules(v)).toEqual(['inside-room']);
    expect(v[0].severity).toBe('error');
    expect(v[0].nodeIds).toEqual(['a']);
  });

  it('flags the reflex corner of an L-shaped room cutting into the footprint', () => {
    const v = checkInsideRoom(item('a', 'table', [3, 0, 3], [1, 1, 1]), ctx(lRoom()), cfg());
    expect(rules(v)).toEqual(['inside-room']);
    expect(checkInsideRoom(item('b', 'table', [1.5, 0, 4.5], [1, 1, 1]), ctx(lRoom()), cfg())).toEqual([]);
  });

  it('honours outlineTolerance', () => {
    const poking = item('a', 'chair', [4.55, 0, 2], [1, 1, 1]); // 0.05 m past x = 5
    expect(checkInsideRoom(poking, ctx(room), cfg())).toHaveLength(1);
    expect(checkInsideRoom(poking, ctx(room), cfg({ outlineTolerance: 0.1 }))).toEqual([]);
  });
});

describe('checkItemOverlap', () => {
  const room = rectRoom(10, 10);
  const table = item('table', 'table', [5, 0, 5], [1.6, 0.75, 0.9]);

  it('flags overlapping boxes', () => {
    const v = checkItemOverlap(item('c', 'chair', [5.5, 0, 5.3], [0.5, 0.9, 0.5]), ctx(room, [table]), cfg());
    expect(rules(v)).toEqual(['item-overlap']);
    expect(v[0].nodeIds).toEqual(['c', 'table']);
  });

  it('allows touching boxes and items stacked on top', () => {
    expect(checkItemOverlap(item('c', 'chair', [5, 0, 5.7], [0.5, 0.9, 0.5]), ctx(room, [table]), cfg())).toEqual([]);
    expect(checkItemOverlap(item('vase', 'decor', [5, 0.75, 5], [0.2, 0.3, 0.2]), ctx(room, [table]), cfg())).toEqual([]);
  });

  it('uses oriented boxes, not axis-aligned ones', () => {
    // A 45° rotated square whose AABB would overlap the table corner but whose OBB does not.
    const rotated = item('r', 'plant', [6.05, 0, 5.7], [0.5, 1, 0.5], Math.PI / 4);
    expect(checkItemOverlap(rotated, ctx(room, [table]), cfg())).toEqual([]);
  });

  it('honours overlapTolerance', () => {
    const grazing = item('c', 'chair', [5, 0, 5.68], [0.5, 0.9, 0.5]); // 0.02 m into the table
    expect(checkItemOverlap(grazing, ctx(room, [table]), cfg())).toHaveLength(1);
    expect(checkItemOverlap(grazing, ctx(room, [table]), cfg({ overlapTolerance: 0.05 }))).toEqual([]);
  });
});

describe('checkWallOverlap', () => {
  const room = rectRoom(5, 4);

  it('flags an item cutting into a wall', () => {
    const v = checkWallOverlap(item('a', 'storage', [2.5, 0, 0.3], [1, 1, 0.6]), ctx(room), cfg());
    expect(rules(v)).toEqual(['wall-overlap']);
    expect(v[0].nodeIds).toEqual(['a', 'wall_n']);
  });

  it('accepts an item flush against the wall face', () => {
    expect(checkWallOverlap(item('a', 'storage', [2.5, 0, 0.4], [1, 1, 0.6]), ctx(room), cfg())).toEqual([]);
  });
});

describe('checkDoorClearance', () => {
  // Door centered at x = 2.5 on the south wall (interior face z = 3.9), swinging into the room.
  const room = rectRoom(5, 4, [opening({ id: 'door_1', wallId: 'wall_s', kind: 'door', offset: 2.5, width: 0.9 })]);

  it('flags items inside the swing radius', () => {
    const v = checkDoorClearance(item('a', 'chair', [2.5, 0, 3], [0.5, 0.9, 0.5]), ctx(room), cfg());
    expect(rules(v)).toEqual(['door-clearance']);
    expect(v[0].nodeIds).toEqual(['a', 'door_1']);
  });

  it('accepts items beyond the swing radius', () => {
    expect(checkDoorClearance(item('a', 'chair', [2.5, 0, 2.5], [0.5, 0.9, 0.5]), ctx(room), cfg())).toEqual([]);
    expect(checkDoorClearance(item('b', 'chair', [4.4, 0, 3.5], [0.5, 0.9, 0.5]), ctx(room), cfg())).toEqual([]);
  });

  it('honours doorSwingFactor and margin', () => {
    const near = item('a', 'chair', [2.5, 0, 3], [0.5, 0.9, 0.5]);
    expect(checkDoorClearance(near, ctx(room), cfg({ doorSwingFactor: 0.5, doorClearanceMargin: 0 }))).toEqual([]);
  });

  it('keeps floor-level open passages clear but not high openings', () => {
    const arch = opening({ id: 'arch', wallId: 'wall_s', kind: 'opening', offset: 2.5, width: 0.9, height: 2.1, sill: 0 });
    const hatch = opening({ id: 'hatch', wallId: 'wall_s', kind: 'opening', offset: 2.5, width: 0.9, height: 0.6, sill: 1.0 });
    const chair = item('a', 'chair', [2.5, 0, 3], [0.5, 0.9, 0.5]);
    expect(rules(checkDoorClearance(chair, ctx(rectRoom(5, 4, [arch])), cfg()))).toEqual(['door-clearance']);
    expect(checkDoorClearance(chair, ctx(rectRoom(5, 4, [hatch])), cfg())).toEqual([]);
  });
});

describe('checkWalkway', () => {
  const room = rectRoom(10, 10);
  const shelf = item('shelf', 'storage', [5, 0, 5], [1, 1.8, 0.4]);
  const at = (gap: number, category = 'sofa') => item('s', category, [5, 0, 5 + 0.2 + gap + 0.45], [2, 0.9, 0.9]);

  it('flags a passage narrower than walkwayMin', () => {
    const v = checkWalkway(at(0.5), ctx(room, [shelf]), cfg());
    expect(rules(v)).toEqual(['walkway']);
    expect(v[0].severity).toBe('warning');
  });

  it('accepts wide passages and intentional adjacency', () => {
    expect(checkWalkway(at(1.0), ctx(room, [shelf]), cfg())).toEqual([]);
    expect(checkWalkway(at(0.1), ctx(room, [shelf]), cfg())).toEqual([]);
  });

  it('ignores companions such as a chair at its table', () => {
    const table = item('t', 'dining_table', [5, 0, 5], [1.6, 0.75, 0.4]);
    expect(checkWalkway(at(0.5, 'chair'), ctx(room, [table]), cfg())).toEqual([]);
  });

  it('flags narrow gaps to walls and honours walkwayMin', () => {
    const nearWall = item('s', 'sofa', [5, 0, 0.1 + 0.5 + 0.45], [2, 0.9, 0.9]);
    expect(rules(checkWalkway(nearWall, ctx(room), cfg()))).toEqual(['walkway']);
    expect(checkWalkway(nearWall, ctx(room), cfg({ walkwayMin: 0.4 }))).toEqual([]);
  });
});

describe('checkFrontClearance', () => {
  const room = rectRoom(10, 10);
  const shelf = item('shelf', 'storage', [5, 0, 5.45 + 0.2 + 0.2], [1, 1.8, 0.4]); // 0.2 m in front of the sofa

  it('flags a blocked front zone', () => {
    const v = checkFrontClearance(item('s', 'sofa', [5, 0, 5], [2, 0.9, 0.9]), ctx(room, [shelf]), cfg());
    expect(rules(v)).toEqual(['front-clearance']);
    expect(v[0].nodeIds).toEqual(['s', 'shelf']);
  });

  it('only looks in front (yaw-aware)', () => {
    expect(checkFrontClearance(item('s', 'sofa', [5, 0, 5], [2, 0.9, 0.9], Math.PI), ctx(room, [shelf]), cfg())).toEqual([]);
  });

  it('flags an item facing a wall', () => {
    const v = checkFrontClearance(item('d', 'desk', [5, 0, 0.5], [1.2, 0.75, 0.6], Math.PI), ctx(room), cfg());
    expect(v[0].detail).toContain('wall wall_n');
  });

  it('uses per-category depths', () => {
    const sofa = item('s', 'sofa', [5, 0, 5], [2, 0.9, 0.9]);
    expect(checkFrontClearance(sofa, ctx(room, [shelf]), cfg({ frontClearance: { sofa: 0.1 } }))).toEqual([]);
    expect(checkFrontClearance(item('t', 'table', [5, 0, 5], [2, 0.75, 0.9]), ctx(room, [shelf]), cfg())).toEqual([]);
  });
});

describe('checkSupport', () => {
  const room = rectRoom(5, 4);

  it('accepts floor-resting items and items resting on another item', () => {
    const table = item('t', 'table', [2.5, 0, 2], [1.2, 0.75, 0.8]);
    expect(checkSupport(item('a', 'chair', [1, 0, 1], [0.5, 0.9, 0.5]), ctx(room), cfg())).toEqual([]);
    expect(checkSupport(item('lamp', 'lamp', [2.5, 0.75, 2], [0.2, 0.4, 0.2]), ctx(room, [table]), cfg())).toEqual([]);
  });

  it('flags floating and sunken items', () => {
    expect(checkSupport(item('a', 'chair', [1, 0.3, 1], [0.5, 0.9, 0.5]), ctx(room), cfg())[0].detail).toContain('floats');
    expect(checkSupport(item('a', 'chair', [1, -0.1, 1], [0.5, 0.9, 0.5]), ctx(room), cfg())[0].detail).toContain('sinks');
  });

  it('accepts wall-mounted items flush against a wall facing the room', () => {
    const shelf = item('w', 'shelf', [2.5, 1.2, 0.25], [1, 0.3, 0.3], 0, { attachTo: 'wall' });
    expect(checkSupport(shelf, ctx(room), cfg())).toEqual([]);
  });

  it('flags wall-mounted items away from or facing into the wall', () => {
    const away = item('w', 'shelf', [2.5, 1.2, 0.5], [1, 0.3, 0.3], 0, { attachTo: 'wall' });
    const backwards = item('w', 'shelf', [2.5, 1.2, 0.25], [1, 0.3, 0.3], Math.PI, { attachTo: 'wall' });
    expect(rules(checkSupport(away, ctx(room), cfg()))).toEqual(['support']);
    expect(rules(checkSupport(backwards, ctx(room), cfg()))).toEqual(['support']);
    expect(checkSupport(away, ctx(room), cfg({ wallAttachTolerance: 0.3 }))).toEqual([]);
  });

  it('checks ceiling-attached items against the ceiling height', () => {
    expect(checkSupport(item('l', 'lamp', [2, 2.4, 2], [0.5, 0.3, 0.5], 0, { attachTo: 'ceiling' }), ctx(room), cfg())).toEqual([]);
    expect(checkSupport(item('l', 'lamp', [2, 2.0, 2], [0.5, 0.3, 0.5], 0, { attachTo: 'ceiling' }), ctx(room), cfg())).toHaveLength(1);
  });
});

describe('checkWindowSill', () => {
  // Window centered at x = 2.5 on the north wall (interior face z = 0.1), sill 0.9 m.
  const room = rectRoom(5, 4, [opening({ id: 'win_1', wallId: 'wall_n', kind: 'window', offset: 2.5, width: 1.2 })]);

  it('flags tall items in front of a window', () => {
    const v = checkWindowSill(item('wardrobe', 'wardrobe', [2.5, 0, 0.45], [1, 2, 0.6]), ctx(room), cfg());
    expect(rules(v)).toEqual(['window-sill']);
    expect(v[0].nodeIds).toEqual(['wardrobe', 'win_1']);
  });

  it('accepts items below the sill or beside the window', () => {
    expect(checkWindowSill(item('cab', 'storage', [2.5, 0, 0.45], [1, 0.8, 0.6]), ctx(room), cfg())).toEqual([]);
    expect(checkWindowSill(item('wardrobe', 'wardrobe', [4.3, 0, 0.45], [1, 2, 0.6]), ctx(room), cfg())).toEqual([]);
  });

  it('honours windowZoneDepth', () => {
    const tall = item('lamp', 'lamp', [2.5, 0, 0.6], [0.3, 1.6, 0.3]); // spans z 0.45..0.75
    expect(checkWindowSill(tall, ctx(room), cfg())).toHaveLength(1);
    expect(checkWindowSill(tall, ctx(room), cfg({ windowZoneDepth: 0.3 }))).toEqual([]);
  });
});
