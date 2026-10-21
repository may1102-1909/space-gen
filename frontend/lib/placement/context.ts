import type { AnyNode } from '@pascal-app/core';
import type { RoomInterpretation } from '@/lib/contracts';
import type { ItemNode } from '@/lib/pascal/itemEditing';
import { computeObbForItemNode } from '@/lib/splat/splatMasking';
import {
  type Obb2,
  type Poly,
  type Vec2,
  makeObb2,
  pointInPolygon,
  polygonCentroid,
  sectorPolygon,
} from './geometry';
import { DEFAULT_PLACEMENT_OPTIONS, type PlacementOptions } from './types';

export interface Obstacle {
  id: string;
  name: string;
  category: string;
  /** Bottom (y of floor contact) and height, meters. */
  y: number;
  h: number;
  obb: Obb2;
  source: 'item' | 'detection' | 'extra';
}

export interface Subject {
  id: string;
  category: string;
  /** Bottom-centre position and yaw; dims are already scaled [w, h, d]. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  dims: [number, number, number];
}

export interface WallModel {
  id: string;
  start: Vec2;
  end: Vec2;
  dir: Vec2;
  /** Unit normal pointing into the room. */
  normal: Vec2;
  length: number;
  thickness: number;
  rect: Poly;
  obb: Obb2;
}

export interface OpeningModel {
  id: string;
  kind: 'door' | 'window' | 'opening';
  wallId: string;
  /** Keep-out polygons on the floor plane (door swing discs / window zone / doorway rectangle). */
  zones: Poly[];
  /** Vertical extent of the opening, meters above floor. */
  yLo: number;
  yHi: number;
}

export interface RoomModel {
  outline: Poly | null;
  walls: WallModel[];
  openings: OpeningModel[];
  centroid: Vec2;
}

export type SceneInput = ReadonlyArray<ItemNode> | Readonly<Record<string, AnyNode | undefined>>;

export interface PlacementContext {
  options: PlacementOptions;
  room: RoomModel;
  obstacles: Obstacle[];
}

export function normalizeCategory(raw: string | undefined | null): string {
  return (raw ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
}

const CATEGORY_KEYWORDS = [
  'dining_table', 'coffee_table', 'side_table', 'tv_stand', 'armchair', 'sofa', 'couch', 'chair', 'stool', 'bench',
  'table', 'desk', 'bed', 'wardrobe', 'bookcase', 'shelf', 'cabinet', 'storage', 'plant', 'lamp', 'rug',
];

/** Best-effort category from free text (asset name/url) when nothing explicit is known. */
export function inferCategory(text: string): string {
  const t = normalizeCategory(text.split('/').pop() ?? text);
  return CATEGORY_KEYWORDS.find((k) => t.includes(k)) ?? 'furniture';
}

export function itemNodeToObstacle(node: ItemNode): Obstacle {
  const obb = computeObbForItemNode(node);
  return {
    id: node.id,
    name: node.name ?? node.id,
    category: normalizeCategory(node.asset?.category) || inferCategory(node.asset?.src ?? node.name ?? ''),
    y: node.position?.[1] ?? 0,
    h: obb.size[1],
    obb: makeObb2(obb.center[0], obb.center[2], obb.size[0] / 2, obb.size[2] / 2, obb.yaw),
    source: 'item',
  };
}

export function sceneItems(scene: SceneInput): ItemNode[] {
  const list = Array.isArray(scene) ? (scene as ReadonlyArray<AnyNode>) : Object.values(scene as Record<string, AnyNode | undefined>);
  return list.filter((n): n is ItemNode => !!n && n.type === 'item' && n.visible !== false);
}

const roomCache = new WeakMap<RoomInterpretation, Map<string, RoomModel>>();

export function buildRoomModel(interp: RoomInterpretation, options: PlacementOptions = DEFAULT_PLACEMENT_OPTIONS): RoomModel {
  const key = `${options.doorHinge}|${options.windowZoneDepth}|${options.walkwayMin}`;
  let byKey = roomCache.get(interp);
  const hit = byKey?.get(key);
  if (hit) return hit;

  const outline: Poly | null = interp.outline.length >= 3 ? interp.outline.map(([x, z]) => [x, z] as Vec2) : null;
  const wallCentroid: Vec2 = interp.walls.length
    ? [
        interp.walls.reduce((s, w) => s + (w.start[0] + w.end[0]) / 2, 0) / interp.walls.length,
        interp.walls.reduce((s, w) => s + (w.start[2] + w.end[2]) / 2, 0) / interp.walls.length,
      ]
    : [0, 0];
  const centroid = outline ? polygonCentroid(outline) : wallCentroid;

  const walls: WallModel[] = [];
  for (const w of interp.walls) {
    const start: Vec2 = [w.start[0], w.start[2]];
    const end: Vec2 = [w.end[0], w.end[2]];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < 1e-6) continue;
    const dir: Vec2 = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
    let normal: Vec2 = [-dir[1], dir[0]];
    const mid: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const probe: Vec2 = [mid[0] + normal[0] * 0.3, mid[1] + normal[1] * 0.3];
    const inside = outline ? pointInPolygon(probe, outline) : (centroid[0] - mid[0]) * normal[0] + (centroid[1] - mid[1]) * normal[1] >= 0;
    if (!inside) normal = [-normal[0], -normal[1]];
    const yaw = Math.atan2(-dir[1], dir[0]);
    const obb = makeObb2((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, length / 2 + w.thickness / 2, w.thickness / 2, yaw);
    walls.push({ id: w.id, start, end, dir, normal, length, thickness: w.thickness, rect: obb.corners, obb });
  }

  const openings: OpeningModel[] = [];
  for (const o of interp.openings) {
    const wall = walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const at = (t: number, off: number): Vec2 => [
      wall.start[0] + wall.dir[0] * t + wall.normal[0] * off,
      wall.start[1] + wall.dir[1] * t + wall.normal[1] * off,
    ];
    const a = o.offset;
    const b = o.offset + o.width;
    const face = wall.thickness / 2;
    const zoneList: Poly[] = [];
    if (o.kind === 'door') {
      const hinges: Array<'start' | 'end'> = options.doorHinge === 'both' ? ['start', 'end'] : [options.doorHinge];
      for (const h of hinges) {
        const apex = h === 'start' ? at(a, face) : at(b, face);
        const u: Vec2 = h === 'start' ? wall.dir : [-wall.dir[0], -wall.dir[1]];
        zoneList.push(sectorPolygon(apex, u, wall.normal, o.width));
      }
    } else if (o.kind === 'window') {
      zoneList.push([at(a, face), at(b, face), at(b, face + options.windowZoneDepth), at(a, face + options.windowZoneDepth)]);
    } else {
      zoneList.push([at(a, face), at(b, face), at(b, face + options.walkwayMin), at(a, face + options.walkwayMin)]);
    }
    openings.push({ id: o.id, kind: o.kind, wallId: o.wallId, zones: zoneList, yLo: o.sill, yHi: o.sill + o.height });
  }

  const model: RoomModel = { outline, walls, openings, centroid };
  if (!byKey) {
    byKey = new Map();
    roomCache.set(interp, byKey);
  }
  byKey.set(key, model);
  return model;
}

/** Item nodes plus (optionally) non-rejected detections not already represented as items. */
export function collectObstacles(
  scene: SceneInput,
  interp: RoomInterpretation,
  options: PlacementOptions,
  extra: Obstacle[] = []
): Obstacle[] {
  const skip = new Set(options.ignoreIds);
  const items = sceneItems(scene).filter((n) => !skip.has(n.id));
  const obstacles = items.map(itemNodeToObstacle);
  if (options.includeDetections) {
    const represented = new Set<string>();
    for (const n of items) {
      const d = (n.metadata as { detectionId?: string } | undefined)?.detectionId;
      if (d) represented.add(d);
    }
    for (const d of interp.detections) {
      if (d.status === 'rejected' || represented.has(d.id) || skip.has(d.id)) continue;
      obstacles.push({
        id: d.id,
        name: d.label,
        category: normalizeCategory(d.category),
        y: d.obb.center[1] - d.obb.size[1] / 2,
        h: d.obb.size[1],
        obb: makeObb2(d.obb.center[0], d.obb.center[2], d.obb.size[0] / 2, d.obb.size[2] / 2, d.obb.yaw),
        source: 'detection',
      });
    }
  }
  return obstacles.concat(extra);
}

export function buildContext(
  scene: SceneInput,
  interp: RoomInterpretation,
  partial: Partial<PlacementOptions> = {},
  extra: Obstacle[] = []
): PlacementContext {
  const options = { ...DEFAULT_PLACEMENT_OPTIONS, ...partial };
  return { options, room: buildRoomModel(interp, options), obstacles: collectObstacles(scene, interp, options, extra) };
}

export function subjectObb(s: Subject): Obb2 {
  return makeObb2(s.x, s.z, s.dims[0] / 2, s.dims[2] / 2, s.yaw);
}
