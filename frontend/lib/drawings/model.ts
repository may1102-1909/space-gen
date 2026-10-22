import { calculateLevelMiters, DEFAULT_WALL_HEIGHT, getWallPlanFootprint, getWallThickness, type WallNode } from '@pascal-app/core';
import { planFootprintCorners } from '@pascal-app/core/plan-footprint';
import type { ScaleSource } from '@/lib/contracts/scan';
import { scaleSourceOf } from '@/lib/measurement/accuracy';

/**
 * Read-only drawing model built from Pascal nodes (level frame: x right, z toward plan-south,
 * meters). Plans and elevations render from this, never from the scan interpretation, so they
 * always show the edited scene.
 */

export type Vec2 = [number, number];

export interface DrawingOpening {
  id: string;
  wallId: string;
  kind: 'door' | 'window' | 'opening';
  name: string;
  /** Wall start -> opening centre, along the wall (the OpeningInterpretation.offset convention). */
  center: number;
  width: number;
  sill: number;
  height: number;
  /** Which wall end the door hinge sits on. */
  hinge: 'start' | 'end';
}

export interface DrawingWall {
  id: string;
  name: string;
  start: Vec2;
  end: Vec2;
  length: number;
  thickness: number;
  height: number;
  /** Unit vector start -> end. */
  dir: Vec2;
  /** Unit normal pointing into the room. */
  inward: Vec2;
  /** Mitred plan outline (Pascal's own wall footprint). */
  footprint: Vec2[];
  /** Interior face extent along the wall, measured from `start` (corner to corner inside). */
  faceStart: number;
  faceEnd: number;
  openings: DrawingOpening[];
}

export interface DrawingRoom {
  id: string;
  name: string;
  polygon: Vec2[];
  area: number;
  centroid: Vec2;
  ceilingHeight?: number;
}

export interface DrawingItem {
  id: string;
  name: string;
  corners: Vec2[];
}

export interface DrawingModel {
  levelId: string | null;
  levelName: string;
  walls: DrawingWall[];
  rooms: DrawingRoom[];
  items: DrawingItem[];
  scaleSource: ScaleSource;
  /** Plan extent of everything drawn (wall outlines, rooms, items). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Room ceiling height, falling back to level height, then the tallest wall. */
  ceilingHeight: number;
}

type Rec = Record<string, unknown> & { id: string; type: string };
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const vec2 = (v: unknown): Vec2 | null => (Array.isArray(v) && v.length >= 2 ? [num(v[0], 0), num(v[1], 0)] : null);
const visible = (n: Rec) => n.visible !== false;

export function polygonArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const f = x1 * z2 - x2 * z1;
    a += f; cx += (x1 + x2) * f; cz += (z1 + z2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function pointInPolygon([x, z]: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function levelOf(id: string | null | undefined, nodes: Record<string, Rec | undefined>): Rec | undefined {
  let node = id ? nodes[id] : undefined;
  for (let i = 0; node && i < 32; i++) {
    if (node.type === 'level') return node;
    node = typeof node.parentId === 'string' ? nodes[node.parentId] : undefined;
  }
  return undefined;
}

/**
 * Builds the drawing model for one level (default: the first level that has walls).
 * `nodes` is `useScene.getState().nodes`.
 */
export function extractDrawingModel(rawNodes: object, options: { levelId?: string } = {}): DrawingModel {
  const nodes = rawNodes as Record<string, Rec | undefined>;
  const all = Object.values(nodes).filter((n): n is Rec => Boolean(n));
  const wallNodes = all.filter((n) => n.type === 'wall' && visible(n) && vec2(n.start) && vec2(n.end));
  const levelId =
    options.levelId ?? levelOf(wallNodes[0]?.id, nodes)?.id ?? all.find((n) => n.type === 'level')?.id ?? null;
  const onLevel = (n: Rec) => (levelId ? levelOf(n.id, nodes)?.id === levelId : true);
  const level = levelId ? nodes[levelId] : undefined;

  const levelWalls = wallNodes.filter(onLevel);
  const rooms: DrawingRoom[] = all
    .filter((n) => n.type === 'zone' && visible(n) && onLevel(n) && Array.isArray(n.polygon) && n.polygon.length >= 3)
    .map((n) => {
      const polygon = (n.polygon as unknown[]).map((p) => vec2(p)!);
      return {
        id: n.id,
        name: typeof n.name === 'string' && n.name ? n.name : 'Room',
        polygon,
        area: polygonArea(polygon),
        centroid: polygonCentroid(polygon),
        ceilingHeight: typeof n.ceilingHeight === 'number' ? n.ceilingHeight : undefined,
      };
    });
  const slabPolys = all
    .filter((n) => n.type === 'slab' && visible(n) && onLevel(n) && Array.isArray(n.polygon))
    .map((n) => (n.polygon as unknown[]).map((p) => vec2(p)!));
  const roomPolys = rooms.length ? rooms.map((r) => r.polygon) : slabPolys;

  const endpoints = levelWalls.flatMap((w) => [vec2(w.start)!, vec2(w.end)!]);
  const wallCentroid: Vec2 = endpoints.length
    ? [endpoints.reduce((s, p) => s + p[0], 0) / endpoints.length, endpoints.reduce((s, p) => s + p[1], 0) / endpoints.length]
    : [0, 0];

  const miters = calculateLevelMiters(levelWalls as unknown as WallNode[]);
  const openingsByWall = new Map<string, Rec[]>();
  for (const n of all) {
    if ((n.type !== 'door' && n.type !== 'window') || !visible(n)) continue;
    const host = typeof n.wallId === 'string' ? n.wallId : typeof n.parentId === 'string' ? n.parentId : '';
    if (!openingsByWall.has(host)) openingsByWall.set(host, []);
    openingsByWall.get(host)!.push(n);
  }

  const walls: DrawingWall[] = levelWalls.map((n) => {
    const start = vec2(n.start)!;
    const end = vec2(n.end)!;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const dir: Vec2 = length > 1e-9 ? [(end[0] - start[0]) / length, (end[1] - start[1]) / length] : [1, 0];
    const thickness = getWallThickness(n as unknown as WallNode);
    const mid: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const left: Vec2 = [-dir[1], dir[0]];
    const probe: Vec2 = [mid[0] + left[0] * (thickness / 2 + 0.05), mid[1] + left[1] * (thickness / 2 + 0.05)];
    const leftIsInside = roomPolys.length
      ? roomPolys.some((poly) => pointInPolygon(probe, poly))
      : (wallCentroid[0] - mid[0]) * left[0] + (wallCentroid[1] - mid[1]) * left[1] >= 0;
    const inward: Vec2 = leftIsInside ? left : [-left[0], -left[1]];
    const footprint = getWallPlanFootprint(n as unknown as WallNode, miters).map((p) => [p.x, p.y] as Vec2);
    const along = (p: Vec2) => (p[0] - start[0]) * dir[0] + (p[1] - start[1]) * dir[1];
    const across = (p: Vec2) => (p[0] - start[0]) * inward[0] + (p[1] - start[1]) * inward[1];
    const face = footprint.filter((p) => across(p) > 1e-6).map(along);
    const openings = (openingsByWall.get(n.id) || []).map((o): DrawingOpening => {
      const width = num(o.width, o.type === 'window' ? 1.5 : 0.9);
      const height = num(o.height, o.type === 'window' ? 1.5 : 2.1);
      const pos = Array.isArray(o.position) ? o.position : [];
      const kind = o.openingKind === 'opening' ? 'opening' : o.type === 'window' ? 'window' : 'door';
      return {
        id: o.id,
        wallId: n.id,
        kind,
        name: typeof o.name === 'string' && o.name ? o.name : kind,
        center: num(pos[0], width / 2),
        width,
        sill: Math.max(0, num(pos[1], height / 2) - height / 2),
        height,
        // shortcut: Pascal's hingesSide is read as left = wall start; confirm against its door renderer if swings look mirrored.
        hinge: o.hingesSide === 'right' ? 'end' : 'start',
      };
    }).sort((a, b) => a.center - b.center);
    return {
      id: n.id,
      name: typeof n.name === 'string' && n.name ? n.name : n.id,
      start,
      end,
      length,
      thickness,
      height: num(n.height, num(level?.height, DEFAULT_WALL_HEIGHT)),
      dir,
      inward,
      footprint,
      faceStart: face.length ? Math.min(...face) : 0,
      faceEnd: face.length ? Math.max(...face) : length,
      openings,
    };
  });

  const items: DrawingItem[] = all
    .filter((n) => n.type === 'item' && visible(n) && onLevel(n) && nodes[String(n.parentId)]?.type !== 'wall')
    .map((n) => {
      const asset = (n.asset || {}) as { dimensions?: number[] };
      const dims = asset.dimensions || [1, 1, 1];
      const scale = Array.isArray(n.scale) ? (n.scale as number[]) : [1, 1, 1];
      const pos = (Array.isArray(n.position) ? n.position : [0, 0, 0]) as [number, number, number];
      const rot = Array.isArray(n.rotation) ? num(n.rotation[1], 0) : 0;
      const size: [number, number, number] = [dims[0] * num(scale[0], 1), dims[1] * num(scale[1], 1), dims[2] * num(scale[2], 1)];
      return { id: n.id, name: typeof n.name === 'string' ? n.name : 'Item', corners: planFootprintCorners(pos, size, rot) as Vec2[] };
    });

  const pts = [...walls.flatMap((w) => w.footprint), ...rooms.flatMap((r) => r.polygon), ...items.flatMap((i) => i.corners)];
  const bounds = pts.length
    ? {
        minX: Math.min(...pts.map((p) => p[0])),
        maxX: Math.max(...pts.map((p) => p[0])),
        minZ: Math.min(...pts.map((p) => p[1])),
        maxZ: Math.max(...pts.map((p) => p[1])),
      }
    : { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };

  const scan = all.find((n) => n.type === 'scan') as { metadata?: { scaleSource?: unknown } } | undefined;
  const ceilingHeight =
    rooms.find((r) => r.ceilingHeight)?.ceilingHeight ??
    (typeof level?.height === 'number' ? level.height : undefined) ??
    Math.max(DEFAULT_WALL_HEIGHT, ...walls.map((w) => w.height));

  return {
    levelId,
    levelName: typeof level?.name === 'string' && level.name ? level.name : 'Level',
    walls,
    rooms,
    items,
    scaleSource: scaleSourceOf(scan),
    bounds,
    ceilingHeight,
  };
}
