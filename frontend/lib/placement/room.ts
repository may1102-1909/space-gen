import type { RoomInterpretation } from '@/lib/contracts';
import { add, len, normalize, pointInPolygon, polygonCentroid, rectCorners, scale, sub, yawAlong } from './geometry';
import type { OpeningGeometry, PlacementConfig, RoomGeometry, Vec2, WallGeometry } from './types';

export const DEFAULT_PLACEMENT_CONFIG: PlacementConfig = {
  overlapTolerance: 0.01,
  outlineTolerance: 0.01,
  supportTolerance: 0.02,
  wallAttachTolerance: 0.03,
  doorSwingFactor: 1,
  doorClearanceMargin: 0.1,
  walkwayMin: 0.9,
  abutMax: 0.25,
  lowProfileHeight: 0.05,
  headroom: 2.0,
  frontClearance: {
    default: 0.6,
    chair: 0.45,
    armchair: 0.45,
    sofa: 0.45,
    bed: 0.6,
    desk: 0.75,
    storage: 0.75,
    dresser: 0.9,
    wardrobe: 0.9,
    table: 0,
    rug: 0,
    lamp: 0,
    plant: 0,
  },
  companions: {
    chair: ['table', 'desk', 'chair'],
    armchair: ['table', 'sofa', 'armchair', 'chair'],
    sofa: ['table', 'chair', 'armchair'],
    table: ['chair', 'armchair', 'sofa'],
    desk: ['chair'],
    bed: ['nightstand'],
    nightstand: ['bed'],
  },
  windowZoneDepth: 0.5,
  sillTolerance: 0.02,
  anchorAffinity: {
    chair: ['dining_table', 'table', 'desk'],
    stool: ['counter', 'table'],
    armchair: ['coffee_table', 'table', 'sofa'],
    nightstand: ['bed'],
  },
  anchorMinHeight: { chair: 0.6, stool: 0.85 },
  anchorGap: { default: 0.1, coffee_table: 0.45, sofa: 0.45, bed: 0.05 },
  focalCategories: ['tv', 'tv_console', 'media', 'fireplace'],
  wallStep: 0.2,
  focalRadii: [2.2, 2.8],
};

export function resolveConfig(partial?: Partial<PlacementConfig>): PlacementConfig {
  if (!partial) return DEFAULT_PLACEMENT_CONFIG;
  const d = DEFAULT_PLACEMENT_CONFIG;
  return {
    ...d,
    ...partial,
    frontClearance: { ...d.frontClearance, ...partial.frontClearance },
    companions: { ...d.companions, ...partial.companions },
    anchorAffinity: { ...d.anchorAffinity, ...partial.anchorAffinity },
    anchorMinHeight: { ...d.anchorMinHeight, ...partial.anchorMinHeight },
    anchorGap: { ...d.anchorGap, ...partial.anchorGap },
  };
}

/** True when `category` is `key` or a compound of it ("dining_table" matches "table"). */
export function categoryIs(category: string, key: string): boolean {
  const c = category.toLowerCase();
  return c === key || c.endsWith(`_${key}`) || c.startsWith(`${key}_`);
}

/** Looks up a per-category value, exact match first, then compound match, then `default`. */
export function lookupByCategory<T>(map: Record<string, T>, category: string, fallback: T): T {
  const c = category.toLowerCase();
  if (c in map) return map[c];
  for (const key of Object.keys(map)) {
    if (key !== 'default' && categoryIs(c, key)) return map[key];
  }
  return 'default' in map ? map.default : fallback;
}

const roomCache = new WeakMap<RoomInterpretation, RoomGeometry>();

/**
 * Derives plan geometry from a RoomInterpretation. Wall start/end use [x, y, z];
 * an opening's `offset` is the distance from the wall start to the opening center.
 */
export function buildRoom(interpretation: RoomInterpretation): RoomGeometry {
  const cached = roomCache.get(interpretation);
  if (cached) return cached;

  const outline: Vec2[] =
    interpretation.outline.length >= 3
      ? interpretation.outline.map(([x, z]) => [x, z] as Vec2)
      : interpretation.walls.map((w) => [w.start[0], w.start[2]] as Vec2);
  const centroid = polygonCentroid(outline);
  const { normal, constant } = interpretation.floor;
  const floorY = Math.abs(normal[1]) > 1e-6 ? -constant / normal[1] : 0;

  const walls: WallGeometry[] = [];
  for (const w of interpretation.walls) {
    const a: Vec2 = [w.start[0], w.start[2]];
    const b: Vec2 = [w.end[0], w.end[2]];
    const length = len(sub(b, a));
    if (length < 1e-6) continue;
    const dir = normalize(sub(b, a));
    const mid = scale(add(a, b), 0.5);
    let inward: Vec2 = [-dir[1], dir[0]];
    const probe = add(mid, scale(inward, w.thickness / 2 + 0.05));
    const probeInside =
      outline.length >= 3 ? pointInPolygon(probe, outline) : len(sub(centroid, probe)) < len(sub(centroid, mid));
    if (!probeInside) inward = [-inward[0], -inward[1]];
    walls.push({
      id: w.id,
      a,
      b,
      dir,
      inward,
      length,
      thickness: w.thickness,
      height: w.height,
      footprint: rectCorners(mid, length, w.thickness, yawAlong(dir)),
    });
  }

  const wallById = new Map(walls.map((w) => [w.id, w]));
  const doors: OpeningGeometry[] = [];
  const windows: OpeningGeometry[] = [];
  for (const o of interpretation.openings) {
    const wall = wallById.get(o.wallId);
    if (!wall) continue;
    const t = Math.max(0, Math.min(wall.length, o.offset));
    const onLine = add(wall.a, scale(wall.dir, t));
    const geom: OpeningGeometry = {
      id: o.id,
      wallId: wall.id,
      kind: o.kind,
      center: add(onLine, scale(wall.inward, wall.thickness / 2)),
      dir: wall.dir,
      inward: wall.inward,
      width: o.width,
      height: o.height,
      sill: o.sill,
    };
    if (o.kind === 'door') doors.push(geom);
    else if (o.kind === 'window') windows.push(geom);
  }

  const room: RoomGeometry = {
    outline,
    floorY,
    ceilingHeight: interpretation.ceilingHeight,
    walls,
    doors,
    windows,
    centroid,
  };
  roomCache.set(interpretation, room);
  return room;
}
