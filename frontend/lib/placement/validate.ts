import type { EditProposal, RoomInterpretation } from '@/lib/contracts';
import {
  type Obb2,
  type Poly,
  convexSeparation,
  makeObb2,
  obbBroadGap,
  polygonContains,
} from './geometry';
import {
  type PlacementContext,
  type SceneInput,
  type Subject,
  buildContext,
  inferCategory,
  itemNodeToObstacle,
  normalizeCategory,
  sceneItems,
  subjectObb,
} from './context';
import type { PlacementOptions, PlacementViolation } from './types';

const Y_EPS = 0.01;

const SEATING = new Set(['chair', 'armchair', 'stool', 'bench', 'sofa', 'couch', 'ottoman']);
const NO_FRONT = new Set(['rug', 'carpet', 'plant', 'lamp', 'light', 'decor', 'mirror', 'painting']);

const isTable = (c: string) => c.includes('table') || c === 'desk' || c === 'tv_stand';
const hasFront = (c: string) => !NO_FRONT.has(c) && !isTable(c);

/** A seat facing a table/desk (or a table sitting in front of a seat) is intended, not a blockage. */
function isIntendedPartner(frontCat: string, blockerCat: string): boolean {
  return SEATING.has(frontCat) && (isTable(blockerCat) || blockerCat === 'ottoman');
}

function yOverlap(aY: number, aH: number, bY: number, bH: number): number {
  return Math.min(aY + aH, bY + bH) - Math.max(aY, bY);
}

export function frontDepthFor(category: string, options: PlacementOptions): number {
  return options.frontClearance[category] ?? options.frontClearance.default;
}

function frontZone(o: Obb2, depth: number): Obb2 {
  const f = o.az;
  return makeObb2(o.cx + f[0] * (o.hz + depth / 2), o.cz + f[1] * (o.hz + depth / 2), o.hx, depth / 2, o.yaw);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Checks one subject pose against room and obstacles. Pure; used by validate() and the solver.
 *
 * Rules: OUTSIDE_ROOM, OVERLAP_WALL, OVERLAP_ITEM, DOOR_SWING, WINDOW_SILL, NOT_SUPPORTED (errors);
 * WALKWAY, FRONT_CLEARANCE (warnings).
 *
 * WALKWAY is an approximate pairwise gap check: for each neighbour (item or wall) the face-to-face
 * SAT gap must be >= walkwayMin unless it is a sealed slot (< walkwayPinchIgnore) or the facing
 * corridor is shorter than walkwayMinLength (corner-to-corner). Seat/table pairs are exempt.
 */
export function validateSubject(subject: Subject, ctx: PlacementContext): PlacementViolation[] {
  const { options, room, obstacles } = ctx;
  const tol = options.overlapTolerance;
  const out: PlacementViolation[] = [];
  const obb = subjectObb(subject);
  const id = subject.id;
  const top = subject.y + subject.dims[1];
  const reach = Math.max(options.walkwayMin, ...Object.values(options.frontClearance)) + tol + 0.05;

  // Inside room outline.
  if (room.outline && !polygonContains(room.outline, obb.corners, tol)) {
    out.push({
      code: 'OUTSIDE_ROOM',
      severity: 'error',
      message: `"${id}" extends outside the room outline.`,
      nodeIds: [id],
      details: { x: r3(subject.x), z: r3(subject.z) },
    });
  }

  // Walls.
  for (const wall of room.walls) {
    const sep = convexSeparation(obb.corners, wall.rect);
    if (sep.gap < -tol) {
      out.push({
        code: 'OVERLAP_WALL',
        severity: 'error',
        message: `"${id}" overlaps wall ${wall.id} by ${r3(-sep.gap)} m.`,
        nodeIds: [id, wall.id],
        details: { penetration: r3(-sep.gap) },
      });
    }
  }

  // Items.
  for (const o of obstacles) {
    if (o.id === id) continue;
    if (obbBroadGap(obb, o.obb) > tol) continue;
    const sep = convexSeparation(obb.corners, o.obb.corners);
    if (sep.gap < -tol && yOverlap(subject.y, subject.dims[1], o.y, o.h) > Y_EPS) {
      out.push({
        code: 'OVERLAP_ITEM',
        severity: 'error',
        message: `"${id}" overlaps "${o.name}" by ${r3(-sep.gap)} m.`,
        nodeIds: [id, o.id],
        details: { penetration: r3(-sep.gap), otherCategory: o.category },
      });
    }
  }

  // Doors (swing / doorway) and windows (tall items).
  for (const op of room.openings) {
    const vOverlap = yOverlap(subject.y, subject.dims[1], op.yLo, op.yHi - op.yLo);
    if (op.kind === 'window') {
      if (vOverlap <= Y_EPS) continue;
      if (op.zones.some((z) => convexSeparation(obb.corners, z).gap < -tol)) {
        out.push({
          code: 'WINDOW_SILL',
          severity: 'error',
          message: `"${id}" (top ${r3(top)} m) blocks window ${op.id} (sill ${r3(op.yLo)} m).`,
          nodeIds: [id, op.id],
          details: { itemTop: r3(top), sill: r3(op.yLo), windowTop: r3(op.yHi) },
        });
      }
    } else if (subject.y < op.yHi - Y_EPS && op.zones.some((z) => convexSeparation(obb.corners, z).gap < -tol)) {
      out.push({
        code: 'DOOR_SWING',
        severity: 'error',
        message: `"${id}" blocks the ${op.kind === 'door' ? 'swing of door' : 'opening'} ${op.id}.`,
        nodeIds: [id, op.id],
        details: { kind: op.kind },
      });
    }
  }

  // Support: on floor, on another item, or wall-mounted.
  if (subject.y < -options.supportTolerance) {
    out.push({
      code: 'NOT_SUPPORTED',
      severity: 'error',
      message: `"${id}" is below the floor (y=${r3(subject.y)}).`,
      nodeIds: [id],
      details: { y: r3(subject.y), reason: 'below_floor' },
    });
  } else if (subject.y > options.supportTolerance) {
    const onItem = obstacles.find(
      (o) => o.id !== id && Math.abs(subject.y - (o.y + o.h)) <= options.supportTolerance && convexSeparation(obb.corners, o.obb.corners).gap < -tol
    );
    const onWall = room.walls.some((w) => {
      const g = convexSeparation(obb.corners, w.rect).gap;
      return g <= options.wallAttachTolerance;
    });
    if (!onItem && !onWall) {
      out.push({
        code: 'NOT_SUPPORTED',
        severity: 'error',
        message: `"${id}" floats at y=${r3(subject.y)} with no floor, item or wall support.`,
        nodeIds: [id],
        details: { y: r3(subject.y), reason: 'floating' },
      });
    }
  }

  // Front clearance: subject's own front and subject blocking others' fronts.
  if (hasFront(subject.category)) {
    const depth = frontDepthFor(subject.category, options);
    const zone = frontZone(obb, depth);
    const blocker = findFrontBlocker(zone, subject.y, subject.dims[1], subject.category, id, ctx, tol);
    if (blocker) {
      out.push({
        code: 'FRONT_CLEARANCE',
        severity: 'warning',
        message: `Front of "${id}" has less than ${depth} m clearance (blocked by ${blocker.name}).`,
        nodeIds: [id, blocker.id],
        details: { required: depth, category: subject.category },
      });
    }
  }
  for (const o of obstacles) {
    if (o.id === id || !hasFront(o.category) || isIntendedPartner(o.category, subject.category)) continue;
    if (obbBroadGap(obb, o.obb) > reach) continue;
    const depth = frontDepthFor(o.category, options);
    const zone = frontZone(o.obb, depth).corners;
    if (yOverlap(subject.y, subject.dims[1], o.y, o.h) > Y_EPS && convexSeparation(obb.corners, zone).gap < -tol) {
      out.push({
        code: 'FRONT_CLEARANCE',
        severity: 'warning',
        message: `"${id}" blocks the front clearance (${depth} m) of "${o.name}".`,
        nodeIds: [id, o.id],
        details: { required: depth, category: o.category },
      });
    }
  }

  // Walkways (approximate pairwise gaps).
  const minGap = options.walkwayMin;
  const gapCheck = (poly: Poly, otherId: string, otherCat: string | null, label: string) => {
    if (otherCat !== null && ((SEATING.has(subject.category) && isTable(otherCat)) || (SEATING.has(otherCat) && isTable(subject.category)))) return;
    const sep = convexSeparation(obb.corners, poly);
    if (sep.gap >= options.walkwayPinchIgnore - 1e-9 && sep.gap < minGap - 1e-9 && sep.lateralOverlap >= options.walkwayMinLength) {
      out.push({
        code: 'WALKWAY',
        severity: 'warning',
        message: `Gap between "${id}" and ${label} is ${r3(sep.gap)} m; walkways need >= ${minGap} m.`,
        nodeIds: [id, otherId],
        details: { gap: r3(sep.gap), required: minGap },
      });
    }
  };
  for (const o of obstacles) {
    if (o.id !== id && obbBroadGap(obb, o.obb) <= reach && yOverlap(subject.y, subject.dims[1], o.y, o.h) > Y_EPS) gapCheck(o.obb.corners, o.id, o.category, `"${o.name}"`);
  }
  for (const w of room.walls) gapCheck(w.rect, w.id, null, `wall ${w.id}`);

  return out;
}

function findFrontBlocker(
  zoneObb: Obb2,
  y: number,
  h: number,
  category: string,
  selfId: string,
  ctx: PlacementContext,
  tol: number
): { id: string; name: string } | null {
  const zone = zoneObb.corners;
  for (const w of ctx.room.walls) {
    if (convexSeparation(zone, w.rect).gap < -tol) return { id: w.id, name: `wall ${w.id}` };
  }
  for (const o of ctx.obstacles) {
    if (o.id === selfId || isIntendedPartner(category, o.category)) continue;
    if (obbBroadGap(zoneObb, o.obb) > tol) continue;
    if (yOverlap(y, h, o.y, o.h) > Y_EPS && convexSeparation(zone, o.obb.corners).gap < -tol) return { id: o.id, name: `"${o.name}"` };
  }
  return null;
}

/** Longest clear front depth (m) up to `max`, probed at 0.1 m steps. Used by solver scoring. */
export function clearFrontDepth(subject: Subject, ctx: PlacementContext, max = 1.5): number {
  const obb = subjectObb(subject);
  const tol = ctx.options.overlapTolerance;
  let clear = 0;
  for (let d = 0.3; d <= max + 1e-9; d += 0.3) {
    const zone = frontZone(obb, d);
    if (findFrontBlocker(zone, subject.y, subject.dims[1], subject.category, subject.id, ctx, tol)) break;
    clear = d;
  }
  return clear;
}

/** Resolves the subject pose described by a proposal against the scene (target defaults fill gaps). */
export function proposalToSubject(proposal: EditProposal, scene: SceneInput, options: Partial<PlacementOptions> = {}): Subject | null {
  if (proposal.op === 'remove') return null;
  const target = proposal.targetNodeId ? sceneItems(scene).find((n) => n.id === proposal.targetNodeId) : undefined;
  const targetObs = target ? itemNodeToObstacle(target) : undefined;
  const id = proposal.targetNodeId ?? proposal.id;

  const t = proposal.transform;
  const scale = t?.scale ?? target?.scale ?? [1, 1, 1];
  const baseDims: [number, number, number] | null = proposal.asset
    ? [proposal.asset.dimensions.width, proposal.asset.dimensions.height, proposal.asset.dimensions.depth]
    : target
      ? ((target.asset?.dimensions as [number, number, number]) ?? [1, 1, 1])
      : null;
  if (!baseDims) return null;
  const position = t?.position ?? (target?.position as [number, number, number] | undefined) ?? [0, 0, 0];
  const dims: [number, number, number] = [
    Math.max(0.01, baseDims[0] * Math.abs(scale[0])),
    Math.max(0.01, baseDims[1] * Math.abs(scale[1])),
    Math.max(0.01, baseDims[2] * Math.abs(scale[2])),
  ];
  const category =
    normalizeCategory(options.category) || targetObs?.category || inferCategory(proposal.asset?.url ?? id);
  return { id, category, x: position[0], y: position[1], z: position[2], yaw: t?.rotationY ?? target?.rotation?.[1] ?? 0, dims };
}

/**
 * Validates an edit proposal against the Pascal scene and room interpretation.
 * `move`/`replace` ignore the target node itself as an obstacle; `remove` has no violations.
 */
export function validate(
  proposal: EditProposal,
  scene: SceneInput,
  interpretation: RoomInterpretation,
  options: Partial<PlacementOptions> = {}
): PlacementViolation[] {
  const subject = proposalToSubject(proposal, scene, options);
  if (!subject) return [];
  const ignoreIds = [...(options.ignoreIds ?? []), subject.id];
  const ctx = buildContext(scene, interpretation, { ...options, ignoreIds });
  return validateSubject(subject, ctx);
}

