/**
 * Scene adapter: turns Pascal scene nodes (plain objects, e.g. `useScene.getState().nodes`)
 * into the plain placement data the validator and solver consume. Nothing here reads the live store.
 */
import type { OpeningInterpretation, RoomInterpretation, WallInterpretation } from '@/lib/contracts';
import { add, normalize, scale, sub, yawFacing } from './geometry';
import type { PlacementAttachment, PlacementItem, PlacementScene, Vec2 } from './types';

type NodeLike = Record<string, unknown>;
type Vec3 = [number, number, number];

const DEFAULT_DIMENSIONS: Vec3 = [0.8, 0.8, 0.8];

function vec3(value: unknown): Vec3 | undefined {
  return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every((n) => typeof n === 'number')
    ? [value[0], value[1], value[2]]
    : undefined;
}

function vec2(value: unknown): Vec2 | undefined {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number'
    ? [value[0], value[1]]
    : undefined;
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

const asNode = (value: unknown): NodeLike | undefined =>
  value && typeof value === 'object' ? (value as NodeLike) : undefined;

/** "/assets/models/dining_table.glb" -> "dining_table" */
function categoryFromSrc(src: string | undefined): string | undefined {
  const base = src?.split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i, '');
  return base ? base.toLowerCase() : undefined;
}

export interface PascalAdapterOptions {
  /** Supplies dimensions [w, h, d] for assets whose node carries none (e.g. from the project asset list). */
  resolveDimensions?: (src: string) => Vec3 | undefined;
}

/** Converts Pascal `item` nodes to placement items. Item `position` is the base center (bottom at position[1]). */
export function itemsFromPascalNodes(
  nodes: Record<string, unknown>,
  options: PascalAdapterOptions = {},
): PlacementItem[] {
  const walls = new Map<string, NodeLike>();
  for (const raw of Object.values(nodes)) {
    const node = asNode(raw);
    if (node?.type === 'wall' && typeof node.id === 'string') walls.set(node.id, node);
  }

  const items: PlacementItem[] = [];
  for (const raw of Object.values(nodes)) {
    const node = asNode(raw);
    if (!node || node.type !== 'item' || typeof node.id !== 'string') continue;
    const asset = asNode(node.asset) ?? {};
    const src = str(asset.src) ?? str(node.modelUrl);
    const baseDims =
      vec3(asset.dimensions) ?? vec3(node.dimensions) ?? (src ? options.resolveDimensions?.(src) : undefined) ?? DEFAULT_DIMENSIONS;
    const s = vec3(node.scale) ?? [1, 1, 1];
    const size: Vec3 = [baseDims[0] * s[0], baseDims[1] * s[1], baseDims[2] * s[2]];
    const position = vec3(node.position) ?? [0, 0, 0];
    const rotation = vec3(node.rotation) ?? [0, 0, 0];
    const attachRaw = str(asset.attachTo);
    const attachTo: PlacementAttachment =
      attachRaw === 'ceiling' ? 'ceiling' : attachRaw === 'wall' || attachRaw === 'wall-side' ? 'wall' : 'floor';

    let center: Vec3 = [position[0], position[1] + size[1] / 2, position[2]];
    let yaw = rotation[1];
    // Wall-hosted items store wall-local coordinates: x along the wall from its start, y = bottom elevation.
    const wall = walls.get(str(node.wallId) ?? str(node.parentId) ?? '');
    if (attachTo === 'wall' && wall) {
      const a = vec2(wall.start) ?? [0, 0];
      const b = vec2(wall.end) ?? [1, 0];
      const dir = normalize(sub(b, a));
      const side = node.side === 'back' ? -1 : 1;
      const normal: Vec2 = [-dir[1] * side, dir[0] * side];
      const offset = num(wall.thickness, 0.2) / 2 + size[2] / 2;
      const plan = add(add(a, scale(dir, position[0])), scale(normal, offset));
      center = [plan[0], position[1] + size[1] / 2, plan[1]];
      yaw = yawFacing(normal);
    }

    items.push({
      id: node.id,
      name: str(node.name) ?? 'Item',
      category: (str(asset.category) ?? str(node.category) ?? categoryFromSrc(src) ?? 'item').toLowerCase(),
      obb: { center, size, yaw },
      attachTo,
    });
  }
  return items;
}

export function sceneFromPascalNodes(
  nodes: Record<string, unknown>,
  options: PascalAdapterOptions = {},
): PlacementScene {
  return { items: itemsFromPascalNodes(nodes, options) };
}

/** Uses scan detections as placement items (for rooms not yet converted to Pascal items). Rejected detections are skipped. */
export function sceneFromDetections(interpretation: RoomInterpretation): PlacementScene {
  return {
    items: interpretation.detections
      .filter((d) => d.status !== 'rejected')
      .map((d) => ({ id: d.id, name: d.label, category: d.category.toLowerCase(), obb: d.obb, attachTo: 'floor' as const })),
  };
}

/**
 * Builds a RoomInterpretation from Pascal wall/door/window/slab/level nodes, for callers that
 * have no scan interpretation. Pascal walls use plan [x, z]; doors/windows use `offset`
 * (opening center along the wall) when present, else wall-local position[0].
 */
export function interpretationFromPascalNodes(nodes: Record<string, unknown>): RoomInterpretation {
  const list = Object.values(nodes).map(asNode).filter((n): n is NodeLike => !!n);
  const level = list.find((n) => n.type === 'level');
  const ceilingHeight = num(level?.height, 2.8);

  const walls: WallInterpretation[] = list
    .filter((n) => n.type === 'wall' && typeof n.id === 'string')
    .map((n) => {
      const start = vec2(n.start) ?? [0, 0];
      const end = vec2(n.end) ?? [1, 0];
      return {
        id: n.id as string,
        start: [start[0], 0, start[1]],
        end: [end[0], 0, end[1]],
        height: num(n.height, ceilingHeight),
        thickness: num(n.thickness, 0.2),
        confidence: 1,
        provenance: 'user',
      };
    });
  const wallIds = new Set(walls.map((w) => w.id));

  const openings: OpeningInterpretation[] = [];
  for (const n of list) {
    if ((n.type !== 'door' && n.type !== 'window') || typeof n.id !== 'string') continue;
    const wallId = str(n.wallId) ?? str(n.parentId);
    if (!wallId || !wallIds.has(wallId)) continue;
    const height = num(n.height, n.type === 'door' ? 2.1 : 1.2);
    const position = vec3(n.position);
    const sill =
      typeof n.elevation === 'number'
        ? n.elevation
        : n.type === 'door'
          ? 0
          : Math.max(0, (position?.[1] ?? 0.9 + height / 2) - height / 2);
    openings.push({
      id: n.id,
      wallId,
      kind: n.type,
      offset: Math.max(0, num(n.offset, position?.[0] ?? 0)),
      width: num(n.width, 0.9),
      height,
      sill: Math.max(0, sill),
      confidence: 1,
      provenance: 'user',
    });
  }

  const slab = list.find((n) => n.type === 'slab' && Array.isArray(n.polygon));
  const outline = ((slab?.polygon as unknown[]) ?? []).map(vec2).filter((p): p is Vec2 => !!p);

  return {
    provenance: 'user',
    floor: { normal: [0, 1, 0], constant: 0, provenance: 'user' },
    ceilingHeight,
    outline: outline.length >= 3 ? outline : walls.map((w) => [w.start[0], w.start[2]]),
    walls,
    openings,
    detections: [],
  };
}
