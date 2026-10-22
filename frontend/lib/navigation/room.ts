import { pointInPolygon, polygonArea, polygonCentroid, clampToPolygon, type Pt } from './polygon';

export type SceneKind = 'interior' | 'exterior';

/** The navigable room: floor outline in the scene's (x, z) plane, floor at y = 0. */
export interface RoomVolume {
  outline: Pt[];
  ceilingHeight: number;
}

/** Orbit confinement from the product spec. */
export const WALL_MARGIN = 0.25;
export const MIN_Y = 0.3;
export const CEILING_MARGIN = 0.15;
export const EYE_HEIGHT = 1.6;
const ENDPOINT_TOLERANCE = 0.15;
const DEFAULT_CEILING = 2.5;

/** The slice of a Pascal node this module reads. */
export interface NavNode {
  type: string;
  start?: Pt;
  end?: Pt;
  height?: number;
  visible?: boolean;
  ceilingHeight?: number;
}
type NodeMapLike = Record<string, NavNode | undefined>;

/** Orders wall segments into closed loops (each joint shared by exactly two walls). */
function traceLoops(segments: Array<[Pt, Pt]>): Pt[][] {
  const key = (p: Pt) => `${Math.round(p[0] / ENDPOINT_TOLERANCE)}:${Math.round(p[1] / ENDPOINT_TOLERANCE)}`;
  const joints = new Map<string, Pt>();
  const edges: Array<[string, string]> = segments.map(([a, b]) => {
    const ka = key(a), kb = key(b);
    if (!joints.has(ka)) joints.set(ka, a);
    if (!joints.has(kb)) joints.set(kb, b);
    return [ka, kb];
  });
  const adjacent = new Map<string, number[]>();
  edges.forEach(([a, b], i) => {
    adjacent.set(a, [...(adjacent.get(a) ?? []), i]);
    adjacent.set(b, [...(adjacent.get(b) ?? []), i]);
  });
  const used = new Set<number>();
  const loops: Pt[][] = [];
  edges.forEach((_, start) => {
    if (used.has(start)) return;
    const loop: Pt[] = [];
    const startKey = edges[start][0];
    let current = startKey;
    let edge = start;
    const visited: number[] = [];
    for (;;) {
      visited.push(edge);
      const [a, b] = edges[edge];
      loop.push(joints.get(current)!);
      current = a === current ? b : a;
      if (current === startKey) break;
      const options = (adjacent.get(current) ?? []).filter((e) => !visited.includes(e));
      if (options.length === 0) { loop.length = 0; break; }
      edge = options[0];
    }
    visited.forEach((e) => used.add(e));
    if (loop.length >= 3) loops.push(loop);
  });
  return loops;
}

/**
 * The room volume implied by the Pascal scene: the largest closed loop of at least three walls,
 * with a ceiling height from the room zone, the walls or the level. Null when nothing encloses.
 */
export function extractRoomVolume(nodes: NodeMapLike): RoomVolume | null {
  const all = Object.values(nodes).filter((n): n is NavNode => Boolean(n));
  const walls = all.filter((n) => n.type === 'wall' && n.visible !== false && n.start && n.end);
  if (walls.length < 3) return null;
  const loops = traceLoops(walls.map((w) => [w.start!, w.end!] as [Pt, Pt]));
  if (!loops.length) return null;
  const outline = loops.sort((a, b) => polygonArea(b) - polygonArea(a))[0];
  const zone = all.find((n) => n.type === 'zone' && typeof n.ceilingHeight === 'number');
  const heights = walls.map((w) => w.height).filter((h): h is number => typeof h === 'number' && h > 0);
  const level = all.find((n) => n.type === 'level' && typeof n.height === 'number');
  const ceilingHeight = zone?.ceilingHeight ?? (heights.length ? Math.max(...heights) : level?.height ?? 0);
  return { outline, ceilingHeight: ceilingHeight > 0 ? ceilingHeight : DEFAULT_CEILING };
}

/**
 * The nodes this module reads, as a string: a zustand selector returning it re-renders only when walls,
 * zones or levels change, not on every ephemeral node (placement previews, drags) the scene store sees.
 */
export function navSignature(nodes: NodeMapLike): string {
  const slim = Object.values(nodes).flatMap((n) =>
    n && (n.type === 'wall' || n.type === 'zone' || n.type === 'level')
      ? [{ type: n.type, start: n.start, end: n.end, height: n.height, visible: n.visible, ceilingHeight: n.ceilingHeight }]
      : [],
  );
  return JSON.stringify(slim);
}

export function detectSceneKind(nodes: NodeMapLike): SceneKind {
  return extractRoomVolume(nodes) ? 'interior' : 'exterior';
}

/** Manual override wins; otherwise interior exactly when a room was built. */
export function resolveSceneKind(override: SceneKind | null | undefined, detected: SceneKind): SceneKind {
  return override ?? detected;
}

export type Vec3 = [number, number, number];

/** Keeps a camera position (or orbit target) inside the room volume. */
export function confinePoint(p: Vec3, room: RoomVolume, margin = WALL_MARGIN): Vec3 {
  const [x, z] = clampToPolygon([p[0], p[2]], room.outline, margin);
  const maxY = Math.max(MIN_Y, room.ceilingHeight - CEILING_MARGIN);
  return [x, Math.min(maxY, Math.max(MIN_Y, p[1])), z];
}

export function isInsideRoom(p: Vec3, room: RoomVolume): boolean {
  return p[1] >= MIN_Y - 1e-6 && p[1] <= room.ceilingHeight - CEILING_MARGIN + 1e-6 && pointInPolygon([p[0], p[2]], room.outline);
}

export interface OrbitView {
  position: Vec3;
  target: Vec3;
}

/** A good interior viewpoint: stand near the corner farthest from the centre, look at the centre. */
export function interiorOrbitView(room: RoomVolume): OrbitView {
  const [cx, cz] = polygonCentroid(room.outline);
  const centre = clampToPolygon([cx, cz], room.outline, WALL_MARGIN);
  let far = room.outline[0];
  for (const v of room.outline) {
    if (Math.hypot(v[0] - centre[0], v[1] - centre[1]) > Math.hypot(far[0] - centre[0], far[1] - centre[1])) far = v;
  }
  const d = Math.hypot(far[0] - centre[0], far[1] - centre[1]) || 1;
  const inset = Math.min(0.9, d * 0.2);
  const spot = clampToPolygon(
    [far[0] + ((centre[0] - far[0]) / d) * inset, far[1] + ((centre[1] - far[1]) / d) * inset],
    room.outline,
    WALL_MARGIN,
  );
  const eye = Math.min(1.8, room.ceilingHeight - 0.4);
  return { position: [spot[0], eye, spot[1]], target: [centre[0], Math.min(1, room.ceilingHeight / 2), centre[1]] };
}

export interface WalkSpawn {
  /** Eye position (scene frame). */
  position: Vec3;
  /** Yaw in radians; forward is (-sin yaw, 0, -cos yaw), matching Pascal's first-person controller. */
  yaw: number;
}

const yawToward = (from: Pt, to: Pt) => Math.atan2(-(to[0] - from[0]), -(to[1] - from[1]));

/**
 * Where Walk starts: the room centroid when a room exists (facing the middle of its longest wall),
 * otherwise the orbit target projected to the floor, at ~1.6 m eye height.
 */
export function computeSpawn(room: RoomVolume | null, orbitTarget: Vec3, orbitPosition?: Vec3): WalkSpawn {
  if (room) {
    const [cx, cz] = polygonCentroid(room.outline);
    const here = clampToPolygon([cx, cz], room.outline, WALL_MARGIN + 0.3);
    let longest: [Pt, Pt] = [room.outline[0], room.outline[1]];
    let max = -1;
    room.outline.forEach((a, i) => {
      const b = room.outline[(i + 1) % room.outline.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > max) { max = len; longest = [a, b]; }
    });
    const mid: Pt = [(longest[0][0] + longest[1][0]) / 2, (longest[0][1] + longest[1][1]) / 2];
    return { position: [here[0], Math.min(EYE_HEIGHT, room.ceilingHeight - 0.3), here[1]], yaw: yawToward(here, mid) };
  }
  const here: Pt = [orbitTarget[0], orbitTarget[2]];
  const from: Pt = orbitPosition ? [orbitPosition[0], orbitPosition[2]] : here;
  const same = from[0] === here[0] && from[1] === here[1];
  return { position: [here[0], EYE_HEIGHT, here[1]], yaw: same ? 0 : yawToward(from, here) };
}

/** What the collider is built from: the parametric scene when walls exist, else only a floor at y = 0. */
export function planCollider(nodes: NodeMapLike): { source: 'scene' | 'floor-only'; showHint: boolean } {
  const hasWalls = Object.values(nodes).some((n) => n?.type === 'wall' && n.visible !== false);
  return hasWalls ? { source: 'scene', showHint: false } : { source: 'floor-only', showHint: true };
}

export const NO_WALLS_HINT = 'Build the editable room (Review scan) to enable wall collisions';
