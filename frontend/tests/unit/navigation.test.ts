import { describe, expect, it } from 'vitest';
import { clampToPolygon, closestPointOnPolygon, pointInPolygon, type Pt } from '@/lib/navigation/polygon';
import {
  EYE_HEIGHT,
  computeSpawn,
  confinePoint,
  detectSceneKind,
  extractRoomVolume,
  interiorOrbitView,
  isInsideRoom,
  planCollider,
  resolveSceneKind,
  type NavNode,
} from '@/lib/navigation/room';
import { useNavigation, viewModeLayers } from '@/lib/navigation/navigationStore';

const RECT: Pt[] = [[0, 0], [8, 0], [8, 6], [0, 6]];
// L shape: 8x6 with the north-east 4x3 corner removed.
const L_SHAPE: Pt[] = [[0, 0], [4, 0], [4, 3], [8, 3], [8, 6], [0, 6]];

const wall = (start: Pt, end: Pt, height = 2.8): NavNode => ({ type: 'wall', start, end, height });
const loopWalls = (poly: Pt[]): Record<string, NavNode> =>
  Object.fromEntries(poly.map((p, i) => [`w${i}`, wall(p, poly[(i + 1) % poly.length])]));

describe('polygon clamp', () => {
  it('keeps interior points and projects outside points inside with a margin', () => {
    expect(clampToPolygon([4, 3], RECT, 0.25)).toEqual([4, 3]);
    const out = clampToPolygon([20, 3], RECT, 0.25);
    expect(out[0]).toBeCloseTo(7.75);
    expect(out[1]).toBeCloseTo(3);
    const corner = clampToPolygon([-5, -5], RECT, 0.25);
    expect(pointInPolygon(corner, RECT)).toBe(true);
  });

  it('handles an L-shaped room: points in the notch land inside the L, away from walls', () => {
    for (const p of [[6, 1], [10, 1], [7.5, 2.9], [4.1, 0.1], [-3, 8]] as Pt[]) {
      const q = clampToPolygon(p, L_SHAPE, 0.25);
      expect(pointInPolygon(q, L_SHAPE)).toBe(true);
      expect(closestPointOnPolygon(q, L_SHAPE).distance).toBeGreaterThanOrEqual(0.25 - 1e-3);
    }
    expect(clampToPolygon([2, 4], L_SHAPE, 0.25)).toEqual([2, 4]);
  });
});

describe('scene kind', () => {
  it('is interior for a closed wall loop of at least three walls, exterior otherwise', () => {
    expect(detectSceneKind(loopWalls(RECT))).toBe('interior');
    expect(detectSceneKind(loopWalls(L_SHAPE))).toBe('interior');
    expect(detectSceneKind({})).toBe('exterior');
    const open = loopWalls(RECT);
    delete open.w3;
    expect(detectSceneKind(open)).toBe('exterior');
    expect(detectSceneKind({ a: wall([0, 0], [1, 0]), b: wall([1, 0], [1, 1]) })).toBe('exterior');
  });

  it('reads ceiling height from the zone, then walls, ignores rejected walls', () => {
    expect(extractRoomVolume({ ...loopWalls(RECT), z: { type: 'zone', ceilingHeight: 3.1 } })?.ceilingHeight).toBe(3.1);
    expect(extractRoomVolume(loopWalls(RECT))?.ceilingHeight).toBe(2.8);
    const rejected = loopWalls(RECT);
    rejected.w0 = { ...rejected.w0, visible: false };
    expect(extractRoomVolume(rejected)).toBeNull();
  });

  it('manual override wins over detection', () => {
    expect(resolveSceneKind(null, 'interior')).toBe('interior');
    expect(resolveSceneKind('exterior', 'interior')).toBe('exterior');
    expect(resolveSceneKind('interior', 'exterior')).toBe('interior');
  });
});

describe('confinement and spawn', () => {
  const room = extractRoomVolume(loopWalls(L_SHAPE))!;

  it('confines positions to the room volume (outline margin, floor and ceiling limits)', () => {
    const p = confinePoint([50, 40, -30], room);
    expect(isInsideRoom(p, room)).toBe(true);
    expect(p[1]).toBeCloseTo(2.8 - 0.15);
    expect(confinePoint([2, -4, 2], room)[1]).toBeCloseTo(0.3);
  });

  it('interior orbit view and walk spawn sit inside the room at eye height', () => {
    const view = interiorOrbitView(room);
    expect(isInsideRoom(view.position, room)).toBe(true);
    const spawn = computeSpawn(room, [0, 1, 0]);
    expect(spawn.position[1]).toBeCloseTo(EYE_HEIGHT);
    expect(pointInPolygon([spawn.position[0], spawn.position[2]], room.outline)).toBe(true);
  });

  it('spawns on the orbit target (floor projection) when there is no room', () => {
    const spawn = computeSpawn(null, [3, 1, -2], [3, 5, 4]);
    expect(spawn.position).toEqual([3, EYE_HEIGHT, -2]);
    expect(spawn.yaw).toBeCloseTo(0); // looking from +z toward -z
  });
});

describe('collider plan', () => {
  it('uses the parametric scene when walls exist, else a floor at y=0 plus the hint', () => {
    expect(planCollider(loopWalls(RECT))).toEqual({ source: 'scene', showHint: false });
    expect(planCollider({})).toEqual({ source: 'floor-only', showHint: true });
    expect(planCollider({ w: { type: 'wall', visible: false } })).toEqual({ source: 'floor-only', showHint: true });
  });
});

describe('view mode state', () => {
  it('maps modes to layers and defaults to both / orbit', () => {
    expect(viewModeLayers('splat')).toEqual({ splat: true, pascal: false });
    expect(viewModeLayers('mesh')).toEqual({ splat: false, pascal: true });
    expect(viewModeLayers('both')).toEqual({ splat: true, pascal: true });
    const s = useNavigation.getState();
    expect([s.viewMode, s.navMode, s.sceneKindOverride]).toEqual(['both', 'orbit', null]);
    s.setViewMode('mesh');
    s.setNavMode('walk');
    expect(useNavigation.getState()).toMatchObject({ viewMode: 'mesh', navMode: 'walk' });
    s.setViewMode('both');
    s.setNavMode('orbit');
  });
});
