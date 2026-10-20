import type { RoomInterpretation } from '@/lib/contracts';
import { makeObb2, polygonBounds, pointInPolygon, yawFacing, type Vec2 } from './geometry';
import {
  type Obstacle,
  type PlacementContext,
  type SceneInput,
  type Subject,
  buildContext,
  normalizeCategory,
} from './context';
import type { PlacementOptions, PlacementViolation } from './types';
import { clearFrontDepth, validateSubject } from './validate';

export interface PlacementAsset {
  url: string;
  name: string;
  category: string;
  /** Unscaled [width, height, depth] in meters. */
  dimensions: [number, number, number];
}

export interface PlacementRequest {
  asset: PlacementAsset;
  /** Number of instances to place. */
  count: number;
  /** Categories (or name fragments) of anchor objects; defaults derive from the asset category. */
  anchorCategories?: string[];
  /** Explicit focal points (x, z) items should face when not anchored. */
  focalPoints?: Vec2[];
  /** Number of alternative layouts to return (default 3). */
  topK?: number;
  /** Preferred anchor-to-item gap override (m). */
  anchorGap?: number;
}

export type PlacementStrategy = 'anchor' | 'wall' | 'focal';

export interface ScoredPlacement {
  position: [number, number, number];
  rotationY: number;
  strategy: PlacementStrategy;
  anchorId?: string;
  /** Compass side of the anchor (north = -z) for anchored placements. */
  side?: 'north' | 'south' | 'east' | 'west';
  score: number;
  breakdown: Record<'validity' | 'clearance' | 'anchor' | 'alignment' | 'symmetry', number>;
  reasons: string[];
  /** Non-blocking (warning/info) violations that remain. */
  violations: PlacementViolation[];
}

export interface PlacementLayout {
  placements: ScoredPlacement[];
  score: number;
  reasons: string[];
}

interface Pose {
  x: number;
  z: number;
  yaw: number;
  strategy: PlacementStrategy;
  anchor?: Obstacle;
  side?: ScoredPlacement['side'];
  /** Signed lateral offset along the anchor side / wall, and the half-length available. */
  lateral?: number;
  halfSpan?: number;
}

const WEIGHTS = { validity: 0.25, clearance: 0.2, anchor: 0.25, alignment: 0.1, symmetry: 0.2 };
const WALL_LOVERS = new Set(['sofa', 'couch', 'bed', 'wardrobe', 'bookcase', 'shelf', 'cabinet', 'storage', 'desk', 'tv_stand', 'dresser']);

const DEFAULT_ANCHORS: Record<string, string[]> = {
  chair: ['dining_table', 'table', 'desk', 'coffee_table', 'sofa'],
  stool: ['table', 'desk'],
  armchair: ['coffee_table', 'sofa'],
  lamp: ['sofa', 'bed', 'desk'],
  side_table: ['sofa', 'bed'],
  coffee_table: ['sofa'],
  ottoman: ['sofa', 'armchair'],
};

const COMPASS: Array<[ScoredPlacement['side'], Vec2]> = [
  ['north', [0, -1]],
  ['south', [0, 1]],
  ['east', [1, 0]],
  ['west', [-1, 0]],
];

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function anchorMatches(o: Obstacle, cats: string[]): number {
  const name = normalizeCategory(o.name);
  for (let i = 0; i < cats.length; i++) if (o.category === cats[i] || name.includes(cats[i])) return i;
  return -1;
}

function compass(n: Vec2): ScoredPlacement['side'] {
  // Anchor's local side normal mapped to the nearest compass direction in world space.
  let best = COMPASS[0];
  let bestDot = -Infinity;
  for (const c of COMPASS) {
    const d = c[1][0] * n[0] + c[1][1] * n[1];
    if (d > bestDot) {
      bestDot = d;
      best = c;
    }
  }
  return best[0];
}

function generatePoses(req: PlacementRequest, ctx: PlacementContext): { poses: Pose[]; anchors: Obstacle[] } {
  const { room } = ctx;
  const [w, , d] = req.asset.dimensions;
  const hw = w / 2;
  const hd = d / 2;
  const cat = normalizeCategory(req.asset.category);
  const poses: Pose[] = [];

  const anchorCats = (req.anchorCategories ?? DEFAULT_ANCHORS[cat] ?? []).map(normalizeCategory);
  const anchors = ctx.obstacles
    .map((o) => ({ o, rank: anchorMatches(o, anchorCats) }))
    .filter((a) => a.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((a) => a.o)
    .slice(0, 3);

  // Anchor sides: slots along each side, facing the anchor.
  for (const a of anchors) {
    const seatLike = cat === 'chair' || cat === 'stool' || cat === 'armchair';
    const gaps = req.anchorGap !== undefined ? [req.anchorGap] : seatLike ? (a.category.includes('table') && !a.category.includes('coffee') ? [0.12, 0.3] : [0.4, 0.7]) : [0.05, 0.3];
    const sides: Array<{ n: Vec2; half: number; along: Vec2; span: number }> = [
      { n: [-a.obb.az[0], -a.obb.az[1]], half: a.obb.hz, along: a.obb.ax, span: a.obb.hx },
      { n: a.obb.az, half: a.obb.hz, along: a.obb.ax, span: a.obb.hx },
      { n: [-a.obb.ax[0], -a.obb.ax[1]], half: a.obb.hx, along: a.obb.az, span: a.obb.hz },
      { n: a.obb.ax, half: a.obb.hx, along: a.obb.az, span: a.obb.hz },
    ];
    for (const s of sides) {
      const side = compass(s.n);
      const yaw = yawFacing(-s.n[0], -s.n[1]);
      const pitch = w + 0.1;
      const slots = Math.max(1, Math.floor((2 * s.span) / pitch));
      for (const gap of gaps) {
        const dist = s.half + gap + hd;
        for (let i = 0; i < slots; i++) {
          const t = (i - (slots - 1) / 2) * pitch;
          poses.push({
            x: a.obb.cx + s.n[0] * dist + s.along[0] * t,
            z: a.obb.cz + s.n[1] * dist + s.along[1] * t,
            yaw,
            strategy: 'anchor',
            anchor: a,
            side,
            lateral: t,
            halfSpan: s.span,
          });
        }
      }
    }
  }

  // Wall strip: flush against inner wall faces, front pointing into the room.
  for (const wall of room.walls) {
    const margin = hw + 0.05;
    if (wall.length < 2 * margin) continue;
    const yaw = yawFacing(wall.normal[0], wall.normal[1]);
    const off = wall.thickness / 2 + hd + 0.005;
    for (let t = margin; t <= wall.length - margin + 1e-9; t += 0.3) {
      poses.push({
        x: wall.start[0] + wall.dir[0] * t + wall.normal[0] * off,
        z: wall.start[1] + wall.dir[1] * t + wall.normal[1] * off,
        yaw,
        strategy: 'wall',
        lateral: t - wall.length / 2,
        halfSpan: wall.length / 2,
      });
    }
  }

  // Free floor grid facing the nearest focal point (default: room centroid).
  const focal: Vec2[] = req.focalPoints?.length ? req.focalPoints : [room.centroid];
  const bounds = room.outline
    ? polygonBounds(room.outline)
    : (() => {
        const b = polygonBounds(room.walls.flatMap((x) => [x.start, x.end]));
        return { minX: b.minX - 2, maxX: b.maxX + 2, minZ: b.minZ - 2, maxZ: b.maxZ + 2 };
      })();
  for (let x = bounds.minX + 0.5; x < bounds.maxX; x += 0.5) {
    for (let z = bounds.minZ + 0.5; z < bounds.maxZ; z += 0.5) {
      if (room.outline && !pointInPolygon([x, z], room.outline)) continue;
      let f = focal[0];
      let best = Infinity;
      for (const p of focal) {
        const dd = Math.hypot(p[0] - x, p[1] - z);
        if (dd < best) {
          best = dd;
          f = p;
        }
      }
      if (best < 0.3) continue;
      poses.push({ x, z, yaw: yawFacing(f[0] - x, f[1] - z), strategy: 'focal' });
    }
  }
  return { poses, anchors };
}

function subjectFor(req: PlacementRequest, pose: Pose, idx: number): Subject {
  return {
    id: `candidate_${idx}`,
    category: normalizeCategory(req.asset.category),
    x: pose.x,
    y: 0,
    z: pose.z,
    yaw: pose.yaw,
    dims: req.asset.dimensions,
  };
}

function wallAlignment(yaw: number, ctx: PlacementContext): number {
  const wall = ctx.room.walls[0];
  if (!wall) return 0.5;
  const base = Math.atan2(wall.normal[0], wall.normal[1]);
  const q = Math.PI / 2;
  const rem = Math.abs(((yaw - base) % q + q) % q);
  return clamp01(1 - Math.min(rem, q - rem) / (q / 4));
}

function staticScore(
  req: PlacementRequest,
  pose: Pose,
  warnings: PlacementViolation[],
  ctx: PlacementContext,
  anchors: Obstacle[],
  idx: number
): { total: number; breakdown: ScoredPlacement['breakdown']; reasons: string[] } {
  const cat = normalizeCategory(req.asset.category);
  const reasons: string[] = [];
  const validity = clamp01(1 - 0.25 * warnings.length);
  const front = clearFrontDepth(subjectFor(req, pose, idx), ctx, 1.5);
  const clearance = clamp01(front / 1.5);

  let anchor: number;
  if (pose.strategy === 'anchor' && pose.anchor) {
    const gap = Math.hypot(pose.x - pose.anchor.obb.cx, pose.z - pose.anchor.obb.cz);
    anchor = clamp01(1 - (gap - (pose.anchor.obb.hz + req.asset.dimensions[2] / 2)) / 3);
    anchor = 0.8 + 0.2 * anchor;
    reasons.push(`faces ${pose.anchor.name} on its ${pose.side} side`);
  } else if (anchors.length > 0) {
    anchor = 0.2;
  } else if (pose.strategy === 'wall') {
    anchor = WALL_LOVERS.has(cat) ? 1 : 0.5;
    if (WALL_LOVERS.has(cat)) reasons.push('against a wall as is typical for this category');
  } else {
    anchor = WALL_LOVERS.has(cat) ? 0.2 : 0.6;
    if (!WALL_LOVERS.has(cat)) reasons.push('free-standing, facing the room focus');
  }

  const alignment = pose.strategy === 'anchor' && pose.anchor ? 1 : wallAlignment(pose.yaw, ctx);
  if (alignment > 0.95) reasons.push('aligned with the room axes');

  let symmetry = 0.5;
  if (pose.lateral !== undefined && pose.halfSpan) {
    symmetry = clamp01(1 - Math.abs(pose.lateral) / pose.halfSpan);
    if (symmetry > 0.9) reasons.push('centred on the anchor/wall axis');
  }

  if (front >= 1.2) reasons.push(`${front.toFixed(1)} m clear in front`);
  if (warnings.length === 0) reasons.push('no rule violations');
  for (const w of warnings) reasons.push(`warning ${w.code}: ${w.message}`);

  const breakdown = { validity, clearance, anchor, alignment, symmetry };
  const total = Object.entries(WEIGHTS).reduce((s, [k, wt]) => s + wt * breakdown[k as keyof typeof breakdown], 0);
  return { total, breakdown, reasons };
}

/** Rotational/mirror symmetry bonus relative to already chosen placements about the group's anchor/centroid. */
function symmetryWithChosen(pose: Pose, chosen: ScoredPlacement[], centre: Vec2): number {
  if (chosen.length === 0) return -1;
  let best = 0;
  for (const c of chosen) {
    const px = 2 * centre[0] - c.position[0];
    const pz = 2 * centre[1] - c.position[2];
    const point = Math.hypot(pose.x - px, pose.z - pz);
    const mirrorX = Math.hypot(pose.x - (2 * centre[0] - c.position[0]), pose.z - c.position[2]);
    const mirrorZ = Math.hypot(pose.x - c.position[0], pose.z - (2 * centre[1] - c.position[2]));
    best = Math.max(best, 1 - Math.min(point, mirrorX, mirrorZ) / 0.5);
  }
  return clamp01(best);
}

interface Pooled {
  pose: Pose;
  idx: number;
  base: number;
  breakdown: ScoredPlacement['breakdown'];
  reasons: string[];
  warnings: PlacementViolation[];
}

export function solvePlacements(
  request: PlacementRequest,
  scene: SceneInput,
  interpretation: RoomInterpretation,
  options: Partial<PlacementOptions> = {}
): PlacementLayout[] {
  const ctx = buildContext(scene, interpretation, options);
  return solveInContext(request, ctx);
}

export function solveInContext(request: PlacementRequest, ctx: PlacementContext): PlacementLayout[] {
  const count = Math.max(1, Math.floor(request.count));
  const topK = Math.max(1, request.topK ?? 3);
  const { poses, anchors } = generatePoses(request, ctx);

  const pool: Pooled[] = [];
  poses.forEach((pose, idx) => {
    const violations = validateSubject(subjectFor(request, pose, idx), ctx);
    if (violations.some((v) => v.severity === 'error')) return;
    const warnings = violations;
    const s = staticScore(request, pose, warnings, ctx, anchors, idx);
    pool.push({ pose, idx, base: round(s.total), breakdown: s.breakdown, reasons: s.reasons, warnings });
  });
  pool.sort((a, b) => b.base - a.base || a.idx - b.idx);
  if (pool.length === 0) return [];

  const centre: Vec2 = anchors[0] ? [anchors[0].obb.cx, anchors[0].obb.cz] : ctx.room.centroid;
  const layouts: PlacementLayout[] = [];
  const firstPicks: Pooled[] = [];
  for (const p of pool) {
    if (firstPicks.every((f) => Math.hypot(f.pose.x - p.pose.x, f.pose.z - p.pose.z) > 0.5)) firstPicks.push(p);
    if (firstPicks.length >= topK) break;
  }

  for (const first of firstPicks) {
    const chosen: ScoredPlacement[] = [];
    const extra: Obstacle[] = [];
    const take = (p: Pooled, symmetry: number) => {
      const breakdown = { ...p.breakdown };
      const reasons = [...p.reasons];
      let score = p.base;
      if (symmetry >= 0) {
        score += WEIGHTS.symmetry * (symmetry - breakdown.symmetry);
        breakdown.symmetry = symmetry;
        if (symmetry > 0.9) reasons.push('mirrors an earlier placement across the group centre');
      }
      chosen.push({
        position: [round(p.pose.x), 0, round(p.pose.z)],
        rotationY: round(p.pose.yaw),
        strategy: p.pose.strategy,
        anchorId: p.pose.anchor?.id,
        side: p.pose.side,
        score: round(score),
        breakdown,
        reasons,
        violations: p.warnings,
      });
      const s = subjectFor(request, p.pose, p.idx);
      extra.push({
        id: `placed_${chosen.length}`,
        name: `${request.asset.name} #${chosen.length}`,
        category: s.category,
        y: 0,
        h: s.dims[1],
        obb: makeObb2(s.x, s.z, s.dims[0] / 2, s.dims[2] / 2, s.yaw),
        source: 'extra',
      });
    };
    take(first, -1);

    while (chosen.length < count) {
      const sub: PlacementContext = { ...ctx, obstacles: ctx.obstacles.concat(extra) };
      let best: { p: Pooled; total: number; sym: number } | null = null;
      let evaluated = 0;
      for (const p of pool) {
        if (evaluated >= 60) break;
        if (chosen.some((c) => Math.hypot(c.position[0] - p.pose.x, c.position[2] - p.pose.z) < 0.05)) continue;
        const violations = validateSubject(subjectFor(request, p.pose, p.idx), sub);
        if (violations.some((v) => v.severity === 'error')) continue;
        evaluated++;
        const sym = symmetryWithChosen(p.pose, chosen, centre);
        const penalty = 0.25 * Math.max(0, violations.length - p.warnings.length) * WEIGHTS.validity;
        const total = p.base + WEIGHTS.symmetry * (sym - p.breakdown.symmetry) - penalty;
        if (!best || total > best.total + 1e-9) best = { p, total, sym };
      }
      if (!best) break;
      take(best.p, best.sym);
    }

    const score = chosen.reduce((s, c) => s + c.score, 0) / chosen.length;
    const reasons = [`${chosen.length}/${count} placed`, `strategies: ${[...new Set(chosen.map((c) => c.strategy))].join(', ')}`];
    layouts.push({ placements: chosen, score: round(score), reasons });
  }

  return layouts.sort((a, b) => b.placements.length - a.placements.length || b.score - a.score);
}
