/**
 * Individual placement rules. Each rule checks one subject item against the room and the
 * other items, and returns contract Violations. Thresholds come from PlacementConfig.
 */
import type { Violation } from '@/lib/contracts';
import {
  add,
  clipHalfPlane,
  dot,
  footprint,
  frontOf,
  intervalOverlap,
  len,
  penetration,
  pointInPolygon,
  pointPolygonDistance,
  pointSegmentDistance,
  polygonDistance,
  rectCorners,
  scale,
  sub,
  yawAlong,
} from './geometry';
import { categoryIs, lookupByCategory } from './room';
import type { PlacementConfig, PlacementItem, RoomGeometry, Vec2, WallGeometry } from './types';

export interface RuleContext {
  room: RoomGeometry;
  /** Every other item in the scene (the subject excluded). */
  obstacles: PlacementItem[];
}

export type PlacementRule = (subject: PlacementItem, ctx: RuleContext, config: PlacementConfig) => Violation[];

const fmt = (n: number): string => n.toFixed(2);

const footprintCache = new WeakMap<PlacementItem, Vec2[]>();
export function itemFootprint(item: PlacementItem): Vec2[] {
  let fp = footprintCache.get(item);
  if (!fp) {
    fp = footprint(item.obb);
    footprintCache.set(item, fp);
  }
  return fp;
}

export const itemBottom = (item: PlacementItem): number => item.obb.center[1] - item.obb.size[1] / 2;
export const itemTop = (item: PlacementItem): number => item.obb.center[1] + item.obb.size[1] / 2;
const planRadius = (item: PlacementItem): number => Math.hypot(item.obb.size[0], item.obb.size[2]) / 2;
const planCenter = (item: PlacementItem): Vec2 => [item.obb.center[0], item.obb.center[2]];

const isLowProfile = (item: PlacementItem, config: PlacementConfig): boolean =>
  item.obb.size[1] <= config.lowProfileHeight;

/** True when the two items are allowed to sit close (same group or companion categories). */
export function areCompanions(a: PlacementItem, b: PlacementItem, config: PlacementConfig): boolean {
  if (a.groupId && (a.groupId === b.groupId || a.groupId === b.id)) return true;
  if (b.groupId && b.groupId === a.id) return true;
  const ofA = lookupByCategory(config.companions, a.category, [] as string[]);
  const ofB = lookupByCategory(config.companions, b.category, [] as string[]);
  return ofA.some((k) => categoryIs(b.category, k)) || ofB.some((k) => categoryIs(a.category, k));
}

/** Footprint must lie within the room outline (and the outline must not cut into it). */
export const checkInsideRoom: PlacementRule = (subject, { room }, config) => {
  if (room.outline.length < 3) return [];
  const fp = itemFootprint(subject);
  let worst = 0;
  for (const corner of fp) {
    if (!pointInPolygon(corner, room.outline)) {
      worst = Math.max(worst, pointPolygonDistance(corner, room.outline));
    }
  }
  // A reflex corner of a non-convex outline poking into the footprint also counts.
  const outlineCutsIn = room.outline.some(
    (v) => pointInPolygon(v, fp) && fp.every((p, i) => pointSegmentDistance(v, p, fp[(i + 1) % fp.length]) > config.outlineTolerance),
  );
  if (worst <= config.outlineTolerance && !outlineCutsIn) return [];
  return [
    {
      rule: 'inside-room',
      severity: 'error',
      detail: `"${subject.name}" extends ${fmt(worst)} m outside the room outline.`,
      nodeIds: [subject.id],
    },
  ];
};

/** No 3D box overlap with other items beyond the tolerance. */
export const checkItemOverlap: PlacementRule = (subject, { obstacles }, config) => {
  const out: Violation[] = [];
  const fp = itemFootprint(subject);
  const c = planCenter(subject);
  const r = planRadius(subject);
  for (const other of obstacles) {
    if (len(sub(planCenter(other), c)) > r + planRadius(other)) continue;
    const vertical = intervalOverlap(itemBottom(subject), itemTop(subject), itemBottom(other), itemTop(other));
    if (vertical <= config.overlapTolerance) continue;
    const depth = penetration(fp, itemFootprint(other));
    if (depth > config.overlapTolerance) {
      out.push({
        rule: 'item-overlap',
        severity: 'error',
        detail: `"${subject.name}" overlaps "${other.name}" by ${fmt(depth)} m.`,
        nodeIds: [subject.id, other.id],
      });
    }
  }
  return out;
};

/** No overlap with wall volumes beyond the tolerance. */
export const checkWallOverlap: PlacementRule = (subject, { room }, config) => {
  const out: Violation[] = [];
  const fp = itemFootprint(subject);
  for (const wall of room.walls) {
    if (itemBottom(subject) >= wall.height) continue;
    const depth = penetration(fp, wall.footprint);
    if (depth > config.overlapTolerance) {
      out.push({
        rule: 'wall-overlap',
        severity: 'error',
        detail: `"${subject.name}" cuts ${fmt(depth)} m into wall ${wall.id}.`,
        nodeIds: [subject.id, wall.id],
      });
    }
  }
  return out;
};

/** Keeps the door swing (half-disk of radius width*factor+margin on the room side) free. */
export const checkDoorClearance: PlacementRule = (subject, { room }, config) => {
  const out: Violation[] = [];
  const fp = itemFootprint(subject);
  for (const door of room.doors) {
    if (itemBottom(subject) >= door.height) continue;
    const radius = door.width * config.doorSwingFactor + config.doorClearanceMargin;
    const inside = clipHalfPlane(fp, door.center, door.inward);
    if (inside.length < 3) continue;
    const distance = pointPolygonDistance(door.center, inside);
    if (distance < radius - config.overlapTolerance) {
      out.push({
        rule: 'door-clearance',
        severity: 'error',
        detail: `"${subject.name}" is ${fmt(distance)} m from door ${door.id}; its swing needs ${fmt(radius)} m clear.`,
        nodeIds: [subject.id, door.id],
      });
    }
  }
  return out;
};

const wallGap = (fp: Vec2[], wall: WallGeometry): number => polygonDistance(fp, wall.footprint);

/** Gaps between the subject and an obstacle are either intentional (<= abutMax) or a walkway (>= walkwayMin). */
export const checkWalkway: PlacementRule = (subject, { room, obstacles }, config) => {
  if (isLowProfile(subject, config) || itemBottom(subject) >= config.headroom) return [];
  const out: Violation[] = [];
  const fp = itemFootprint(subject);
  const c = planCenter(subject);
  const r = planRadius(subject);
  const pinch = (gap: number) => gap > config.abutMax && gap < config.walkwayMin;

  for (const other of obstacles) {
    if (isLowProfile(other, config) || itemBottom(other) >= config.headroom) continue;
    if (areCompanions(subject, other, config)) continue;
    if (len(sub(planCenter(other), c)) - r - planRadius(other) >= config.walkwayMin) continue;
    const gap = polygonDistance(fp, itemFootprint(other));
    if (pinch(gap)) {
      out.push({
        rule: 'walkway',
        severity: 'warning',
        detail: `Only ${fmt(gap)} m between "${subject.name}" and "${other.name}" (walkway needs ${fmt(config.walkwayMin)} m).`,
        nodeIds: [subject.id, other.id],
      });
    }
  }
  for (const wall of room.walls) {
    if (pointSegmentDistance(c, wall.a, wall.b) - r - wall.thickness / 2 >= config.walkwayMin) continue;
    const gap = wallGap(fp, wall);
    if (pinch(gap)) {
      out.push({
        rule: 'walkway',
        severity: 'warning',
        detail: `Only ${fmt(gap)} m between "${subject.name}" and wall ${wall.id} (walkway needs ${fmt(config.walkwayMin)} m).`,
        nodeIds: [subject.id, wall.id],
      });
    }
  }
  return out;
};

/** The zone in front of the item (depth by category) must be free of walls and non-companion items. */
export const checkFrontClearance: PlacementRule = (subject, { room, obstacles }, config) => {
  const depth = lookupByCategory(config.frontClearance, subject.category, 0);
  if (depth <= 0 || subject.attachTo === 'ceiling') return [];
  const front = frontOf(subject.obb.yaw);
  const zoneCenter = add(planCenter(subject), scale(front, subject.obb.size[2] / 2 + depth / 2));
  const zone = rectCorners(zoneCenter, subject.obb.size[0], depth, subject.obb.yaw);
  const blockers: string[] = [];
  const ids: string[] = [];
  for (const other of obstacles) {
    if (isLowProfile(other, config) || areCompanions(subject, other, config)) continue;
    if (penetration(zone, itemFootprint(other)) > config.overlapTolerance) {
      blockers.push(`"${other.name}"`);
      ids.push(other.id);
    }
  }
  for (const wall of room.walls) {
    if (penetration(zone, wall.footprint) > config.overlapTolerance) {
      blockers.push(`wall ${wall.id}`);
      ids.push(wall.id);
    }
  }
  if (!blockers.length && room.outline.length >= 3) {
    if (zone.some((p) => !pointInPolygon(p, room.outline) && pointPolygonDistance(p, room.outline) > config.outlineTolerance)) {
      blockers.push('the room boundary');
    }
  }
  if (!blockers.length) return [];
  return [
    {
      rule: 'front-clearance',
      severity: 'warning',
      detail: `"${subject.name}" needs ${fmt(depth)} m clear in front; blocked by ${blockers.join(', ')}.`,
      nodeIds: [subject.id, ...ids],
    },
  ];
};

/** Floor items rest on the floor (or on another item's top); wall items sit flush against a wall; ceiling items touch the ceiling. */
export const checkSupport: PlacementRule = (subject, { room, obstacles }, config) => {
  const violation = (detail: string): Violation[] => [
    { rule: 'support', severity: 'error', detail, nodeIds: [subject.id] },
  ];
  const bottom = itemBottom(subject);

  if (subject.attachTo === 'ceiling') {
    const gap = room.ceilingHeight - itemTop(subject);
    return Math.abs(gap) <= config.supportTolerance
      ? []
      : violation(`"${subject.name}" is ${fmt(gap)} m from the ceiling it should hang from.`);
  }

  if (subject.attachTo === 'wall') {
    const front = frontOf(subject.obb.yaw);
    const back = sub(planCenter(subject), scale(front, subject.obb.size[2] / 2));
    for (const wall of room.walls) {
      if (dot(front, wall.inward) < Math.cos((5 * Math.PI) / 180)) continue;
      const t = dot(sub(back, wall.a), wall.dir);
      if (t < -config.wallAttachTolerance || t > wall.length + config.wallAttachTolerance) continue;
      const gap = dot(sub(back, wall.a), wall.inward) - wall.thickness / 2;
      if (Math.abs(gap) <= config.wallAttachTolerance && itemTop(subject) <= wall.height + config.supportTolerance) {
        return bottom < room.floorY - config.supportTolerance
          ? violation(`"${subject.name}" extends ${fmt(room.floorY - bottom)} m below the floor.`)
          : [];
      }
    }
    return violation(`"${subject.name}" is wall-mounted but its back is not flush against any wall.`);
  }

  const gap = bottom - room.floorY;
  if (Math.abs(gap) <= config.supportTolerance) return [];
  if (gap < 0) return violation(`"${subject.name}" sinks ${fmt(-gap)} m below the floor.`);
  const c = planCenter(subject);
  const restsOnItem = obstacles.some(
    (o) => Math.abs(itemTop(o) - bottom) <= config.supportTolerance && pointInPolygon(c, itemFootprint(o)),
  );
  return restsOnItem ? [] : violation(`"${subject.name}" floats ${fmt(gap)} m above the floor with nothing beneath it.`);
};

/** Items taller than a window's sill stay out of the zone in front of that window. */
export const checkWindowSill: PlacementRule = (subject, { room }, config) => {
  const out: Violation[] = [];
  const fp = itemFootprint(subject);
  const top = itemTop(subject);
  for (const win of room.windows) {
    if (top <= win.sill + config.sillTolerance) continue;
    if (itemBottom(subject) >= win.sill + win.height) continue;
    const zoneCenter = add(win.center, scale(win.inward, config.windowZoneDepth / 2));
    const zone = rectCorners(zoneCenter, win.width, config.windowZoneDepth, yawAlong(win.dir));
    if (penetration(fp, zone) > config.overlapTolerance) {
      out.push({
        rule: 'window-sill',
        severity: 'warning',
        detail: `"${subject.name}" (top ${fmt(top)} m) rises above the ${fmt(win.sill)} m sill of window ${win.id}.`,
        nodeIds: [subject.id, win.id],
      });
    }
  }
  return out;
};

export const PLACEMENT_RULES: Record<string, PlacementRule> = {
  'inside-room': checkInsideRoom,
  'item-overlap': checkItemOverlap,
  'wall-overlap': checkWallOverlap,
  'door-clearance': checkDoorClearance,
  walkway: checkWalkway,
  'front-clearance': checkFrontClearance,
  support: checkSupport,
  'window-sill': checkWindowSill,
};
