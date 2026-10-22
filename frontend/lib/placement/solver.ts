/**
 * Placement solver for "place N of asset X": generates candidate layouts (around an anchor,
 * along walls, facing a focal point), validates every slot with the placement rules, scores
 * the layouts and returns the top-k with human-readable reasons. It never edits the scene;
 * callers turn a layout into EditProposals with `toEditProposals`.
 */
import type { EditProposal, RoomInterpretation, Violation } from '@/lib/contracts';
import { add, dot, frontOf, len, normalize, polygonDistance, scale, sub, yawFacing } from './geometry';
import { buildRoom, categoryIs, lookupByCategory, resolveConfig } from './room';
import { areCompanions, itemFootprint, type RuleContext } from './rules';
import type {
  CandidatePlacement,
  PlacementAssetSpec,
  PlacementConfig,
  PlacementItem,
  PlacementScene,
  RoomGeometry,
  Vec2,
  WallGeometry,
} from './types';
import { toProposalValidation, validateItem } from './validate';

export type PlacementStrategy = 'around-anchor' | 'along-wall' | 'facing-focal';

export interface PlacementRequest {
  asset: PlacementAssetSpec;
  count: number;
  /** Item to group around; defaults to the best match from `config.anchorAffinity`. */
  anchorId?: string;
  /** Point the placements should face; defaults to the first item in `config.focalCategories`. */
  focal?: { position: Vec2; name?: string };
  /** Number of layouts to return (default 3). */
  topK?: number;
  config?: Partial<PlacementConfig>;
}

export interface PlacementSlot {
  /** Base center (bottom of the item), scene frame. */
  position: [number, number, number];
  rotationY: number;
  score: number;
  reasons: string[];
  violations: Violation[];
}

export interface PlacementLayout {
  id: string;
  strategy: PlacementStrategy;
  anchorId?: string;
  requested: number;
  placements: PlacementSlot[];
  score: number;
  symmetry: number;
  reasons: string[];
}

interface Candidate {
  center: Vec2;
  yaw: number;
  label: string;
  relation: number;
}

interface LayoutPlan {
  id: string;
  strategy: PlacementStrategy;
  anchorId?: string;
  /** Candidate list per slot; the first valid entry of each list is used. */
  slots: Candidate[][];
  /** Mirror axes used for the symmetry score. */
  axis: { origin: Vec2; dir: Vec2 }[];
  summary: string;
}

const fmt = (n: number): string => n.toFixed(2);
const rotate = (v: Vec2, a: number): Vec2 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

function makeItem(c: Candidate, asset: PlacementAssetSpec, id: string, groupId: string, floorY: number): PlacementItem {
  const { width, height, depth } = asset.dimensions;
  return {
    id,
    name: asset.name ?? asset.category,
    category: asset.category.toLowerCase(),
    obb: { center: [c.center[0], floorY + height / 2, c.center[1]], size: [width, height, depth], yaw: c.yaw },
    attachTo: 'floor',
    groupId,
  };
}

/** Smallest gap to anything the item is not meant to sit against (capped at walkwayMin). */
function clearanceOf(item: PlacementItem, ctx: RuleContext, config: PlacementConfig): number {
  const fp = itemFootprint(item);
  let best = config.walkwayMin;
  for (const o of ctx.obstacles) {
    if (o.obb.size[1] <= config.lowProfileHeight || areCompanions(item, o, config)) continue;
    best = Math.min(best, polygonDistance(fp, itemFootprint(o)));
  }
  for (const w of ctx.room.walls) {
    const gap = polygonDistance(fp, w.footprint);
    if (gap > config.abutMax) best = Math.min(best, gap);
  }
  return best;
}

/** Mean closeness of each point's mirror image (about the best axis) to the layout's points; 1 = perfectly symmetric. */
export function symmetryScore(points: Vec2[], axes: { origin: Vec2; dir: Vec2 }[], tolerance = 0.25): number {
  if (points.length <= 1 || !axes.length) return 1;
  let best = 0;
  for (const { origin, dir } of axes) {
    const u = normalize(dir);
    let total = 0;
    for (const p of points) {
      const rel = sub(p, origin);
      const mirrored = add(origin, sub(scale(u, 2 * dot(rel, u)), rel));
      const nearest = Math.min(...points.map((q) => len(sub(q, mirrored))));
      total += Math.exp(-nearest / tolerance);
    }
    best = Math.max(best, total / points.length);
  }
  return best;
}

function anchorPlans(anchor: PlacementItem, rank: number, asset: PlacementAssetSpec, config: PlacementConfig): LayoutPlan[] {
  const { width: w, depth: d } = asset.dimensions;
  const yaw = anchor.obb.yaw;
  const ax: Vec2 = [Math.cos(yaw), -Math.sin(yaw)];
  const az: Vec2 = [Math.sin(yaw), Math.cos(yaw)];
  const c: Vec2 = [anchor.obb.center[0], anchor.obb.center[2]];
  const gap = lookupByCategory(config.anchorGap, anchor.category, 0.1);
  const relation = Math.max(0.5, 1 - 0.1 * rank);
  const spacing = 0.05;

  type Side = { normal: Vec2; tangent: Vec2; length: number; half: number; name: string };
  const sides: Side[] = [
    { normal: az, tangent: ax, length: anchor.obb.size[0], half: anchor.obb.size[2] / 2, name: 'front' },
    { normal: scale(az, -1), tangent: ax, length: anchor.obb.size[0], half: anchor.obb.size[2] / 2, name: 'back' },
    { normal: ax, tangent: az, length: anchor.obb.size[2], half: anchor.obb.size[0] / 2, name: 'right end' },
    { normal: scale(ax, -1), tangent: az, length: anchor.obb.size[2], half: anchor.obb.size[0] / 2, name: 'left end' },
  ];
  const slotsOf = (side: Side): Candidate[] => {
    const k = side.length >= 0.6 * w ? Math.max(1, Math.floor((side.length + spacing) / (w + spacing))) : 0;
    const offsets = Array.from({ length: k }, (_, i) => (i - (k - 1) / 2) * (side.length / k)).sort(
      (a, b) => Math.abs(a) - Math.abs(b) || a - b,
    );
    return offsets.map((o, i) => ({
      center: add(add(c, scale(side.normal, side.half + gap + d / 2)), scale(side.tangent, o)),
      yaw: yawFacing(scale(side.normal, -1)),
      label: `${side.name} of "${anchor.name}" (seat ${i + 1} of ${k})`,
      relation,
    }));
  };
  const interleave = (a: Candidate[], b: Candidate[]): Candidate[] =>
    Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]]).flat().filter((x): x is Candidate => !!x);

  const longFirst = anchor.obb.size[0] >= anchor.obb.size[2];
  const longPair = longFirst ? interleave(slotsOf(sides[0]), slotsOf(sides[1])) : interleave(slotsOf(sides[2]), slotsOf(sides[3]));
  const endPair = longFirst ? interleave(slotsOf(sides[2]), slotsOf(sides[3])) : interleave(slotsOf(sides[0]), slotsOf(sides[1]));
  const axis = [
    { origin: c, dir: ax },
    { origin: c, dir: az },
  ];
  const base = { strategy: 'around-anchor' as const, anchorId: anchor.id, axis };
  return [
    {
      ...base,
      id: `around-anchor:${anchor.id}:sides`,
      slots: [...longPair, ...endPair].map((x) => [x]),
      summary: `Grouped around "${anchor.name}", long sides first, each seat facing it with a ${fmt(gap)} m gap`,
    },
    {
      ...base,
      id: `around-anchor:${anchor.id}:ends`,
      slots: [...endPair, ...longPair].map((x) => [x]),
      summary: `Grouped around "${anchor.name}", ends first, each seat facing it with a ${fmt(gap)} m gap`,
    },
  ];
}

function wallPlan(wall: WallGeometry, count: number, asset: PlacementAssetSpec, relation: number, config: PlacementConfig): LayoutPlan | null {
  const { width: w, depth: d } = asset.dimensions;
  const margin = w / 2 + 0.05;
  if (wall.length < 2 * margin) return null;
  const samples: number[] = [];
  for (let t = margin; t <= wall.length - margin + 1e-9; t += config.wallStep) samples.push(t);
  const mid = wall.length / 2;
  const pitch = w + 0.15;
  const toCandidate = (t: number): Candidate => ({
    center: add(add(wall.a, scale(wall.dir, t)), scale(wall.inward, wall.thickness / 2 + d / 2 + 0.02)),
    yaw: yawFacing(wall.inward),
    label: `backed against wall ${wall.id} at ${fmt(t)} m`,
    relation,
  });
  const slots = Array.from({ length: count }, (_, i) => {
    const ideal = Math.max(margin, Math.min(wall.length - margin, mid + (i - (count - 1) / 2) * pitch));
    return [ideal, ...[...samples].sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))].map(toCandidate);
  });
  return {
    id: `along-wall:${wall.id}`,
    strategy: 'along-wall',
    slots,
    axis: [{ origin: add(wall.a, scale(wall.dir, mid)), dir: wall.inward }],
    summary: `Backed against wall ${wall.id} (${fmt(wall.length)} m), facing into the room, ${fmt(pitch)} m apart`,
  };
}

function focalPlans(focal: { position: Vec2; name: string }, count: number, asset: PlacementAssetSpec, room: RoomGeometry, config: PlacementConfig): LayoutPlan[] {
  const toRoom = sub(room.centroid, focal.position);
  const dir: Vec2 = len(toRoom) > 1e-6 ? normalize(toRoom) : [0, 1];
  return config.focalRadii.map((radius) => {
    const step = 2 * Math.asin(Math.min(1, (asset.dimensions.width + 0.3) / 2 / radius));
    const angles: number[] = [];
    if (count % 2 === 1) angles.push(0);
    for (let i = 0; angles.length < count; i++) {
      const a = count % 2 === 1 ? (i + 1) * step : (i + 0.5) * step;
      angles.push(a, -a);
    }
    const slots = angles.slice(0, count).map((a) => {
      const center = add(focal.position, scale(rotate(dir, a), radius));
      return [
        {
          center,
          yaw: yawFacing(sub(focal.position, center)),
          label: `${fmt(radius)} m from "${focal.name}" at ${fmt((a * 180) / Math.PI)}°, facing it`,
          relation: 0.9,
        },
      ];
    });
    return {
      id: `facing-focal:${fmt(radius)}`,
      strategy: 'facing-focal' as const,
      slots,
      axis: [{ origin: focal.position, dir }],
      summary: `Arranged on a ${fmt(radius)} m arc facing "${focal.name}"`,
    };
  });
}

function evaluatePlan(
  plan: LayoutPlan,
  request: PlacementRequest,
  scene: PlacementScene,
  room: RoomGeometry,
  config: PlacementConfig,
): PlacementLayout {
  const placed: PlacementItem[] = [];
  const slots: PlacementSlot[] = [];
  const clearances: number[] = [];
  const groupId = plan.anchorId ?? plan.id;

  for (const options of plan.slots) {
    if (slots.length >= request.count) break;
    for (const cand of options) {
      const item = makeItem(cand, request.asset, `${plan.id}#${slots.length}`, groupId, room.floorY);
      const ctx: RuleContext = { room, obstacles: placed.length ? [...scene.items, ...placed] : scene.items };
      const violations = validateItem(item, ctx, config);
      if (violations.some((v) => v.severity === 'error')) continue;
      const clearance = clearanceOf(item, ctx, config);
      const validity = Math.max(0, 1 - 0.2 * violations.length);
      const clearanceScore = Math.min(1, clearance / config.walkwayMin);
      const reasons = [
        `Placed ${cand.label}`,
        clearance >= config.walkwayMin
          ? `At least ${fmt(config.walkwayMin)} m clear of other obstacles`
          : `${fmt(clearance)} m to the nearest obstacle`,
        ...violations.map((v) => `Warning: ${v.detail}`),
      ];
      placed.push(item);
      clearances.push(clearance);
      slots.push({
        position: [cand.center[0], room.floorY, cand.center[1]],
        rotationY: cand.yaw,
        score: 0.5 * validity + 0.25 * clearanceScore + 0.25 * cand.relation,
        reasons,
        violations,
      });
      break;
    }
  }

  const n = slots.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const symmetry = n ? symmetryScore(slots.map((s) => [s.position[0], s.position[2]] as Vec2), plan.axis) : 0;
  const completeness = n / request.count;
  const meanSlot = mean(slots.map((s) => s.score));
  const score = n ? completeness * (0.8 * meanSlot + 0.2 * symmetry) : 0;
  const warnings = slots.reduce((k, s) => k + s.violations.length, 0);

  const reasons = [plan.summary];
  reasons.push(n < request.count ? `Only ${n} of ${request.count} fit without collisions` : `All ${n} placements are collision-free`);
  if (n > 1) reasons.push(symmetry >= 0.8 ? `Symmetric arrangement (${fmt(symmetry)})` : `Asymmetric arrangement (symmetry ${fmt(symmetry)})`);
  if (n) {
    const minClear = Math.min(...clearances);
    reasons.push(
      minClear >= config.walkwayMin
        ? `Keeps ${fmt(config.walkwayMin)} m walkways and door swings clear`
        : `Tightest clearance ${fmt(minClear)} m`,
    );
  }
  if (warnings) reasons.push(`${warnings} warning${warnings > 1 ? 's' : ''} to review`);

  return {
    id: plan.id,
    strategy: plan.strategy,
    anchorId: plan.anchorId,
    requested: request.count,
    placements: slots,
    score: Number(score.toFixed(4)),
    symmetry: Number(symmetry.toFixed(4)),
    reasons,
  };
}

function findAnchors(request: PlacementRequest, scene: PlacementScene, room: RoomGeometry, config: PlacementConfig): { item: PlacementItem; rank: number }[] {
  if (request.anchorId) {
    const item = scene.items.find((i) => i.id === request.anchorId);
    return item ? [{ item, rank: 0 }] : [];
  }
  const affinity = lookupByCategory(config.anchorAffinity, request.asset.category, [] as string[]);
  const minHeight = lookupByCategory(config.anchorMinHeight, request.asset.category, 0);
  const found: { item: PlacementItem; rank: number; dist: number }[] = [];
  for (const item of scene.items) {
    if (item.obb.size[1] < minHeight) continue;
    const rank = affinity.findIndex((k) => categoryIs(item.category, k));
    if (rank >= 0) found.push({ item, rank, dist: len(sub([item.obb.center[0], item.obb.center[2]], room.centroid)) });
  }
  return found.sort((a, b) => a.rank - b.rank || a.dist - b.dist).slice(0, 2);
}

function findFocal(request: PlacementRequest, scene: PlacementScene, config: PlacementConfig): { position: Vec2; name: string } | null {
  if (request.focal) return { position: request.focal.position, name: request.focal.name ?? 'focal point' };
  const item = scene.items.find((i) => config.focalCategories.some((k) => categoryIs(i.category, k)));
  return item ? { position: [item.obb.center[0], item.obb.center[2]], name: item.name } : null;
}

/** Returns up to `topK` layouts for placing `count` copies of the asset, best first. */
export function solvePlacement(
  request: PlacementRequest,
  scene: PlacementScene,
  interpretation: RoomInterpretation,
): PlacementLayout[] {
  const config = resolveConfig(request.config);
  const room = buildRoom(interpretation);
  const count = Math.max(1, Math.floor(request.count));
  const req = { ...request, count };

  const anchors = findAnchors(req, scene, room, config);
  const plans: LayoutPlan[] = anchors.flatMap(({ item, rank }) => anchorPlans(item, rank, req.asset, config));
  const wallRelation = anchors.length ? 0.5 : 0.8;
  for (const wall of room.walls) {
    const plan = wallPlan(wall, count, req.asset, wallRelation, config);
    if (plan) plans.push(plan);
  }
  const focal = findFocal(req, scene, config);
  if (focal) plans.push(...focalPlans(focal, count, req.asset, room, config));

  const seen = new Set<string>();
  const layouts: PlacementLayout[] = [];
  for (const plan of plans) {
    const layout = evaluatePlan(plan, req, scene, room, config);
    if (!layout.placements.length) continue;
    const key = layout.placements
      .map((p) => `${fmt(p.position[0])},${fmt(p.position[2])}`)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    layouts.push(layout);
  }
  return layouts.sort((a, b) => b.score - a.score).slice(0, request.topK ?? 3);
}

/** Converts a layout into pending EditProposals (op "add"), one per placement. */
export function toEditProposals(layout: PlacementLayout, asset: PlacementAssetSpec): EditProposal[] {
  return layout.placements.map((slot, i) => ({
    id: `proposal_${layout.id.replace(/[^a-z0-9]+/gi, '_')}_${i}`,
    op: 'add',
    targetNodeId: null,
    asset: { source: asset.source ?? 'catalog', url: asset.url, dimensions: { ...asset.dimensions } },
    transform: { position: slot.position, rotationY: slot.rotationY, scale: [1, 1, 1] },
    rationale: [...layout.reasons.slice(0, 1), ...slot.reasons].join('. '),
    validation: toProposalValidation(slot.violations),
    status: 'pending',
  }));
}

/** Converts a layout into the store's CandidatePlacement preview records. */
export function toCandidatePlacements(layout: PlacementLayout, asset: PlacementAssetSpec): CandidatePlacement[] {
  const { width, height, depth } = asset.dimensions;
  const name = asset.name ?? asset.category;
  return layout.placements.map((slot, i) => ({
    id: `candidate_${layout.id.replace(/[^a-z0-9]+/gi, '_')}_${i}`,
    name: `${name} #${i + 1}`,
    category: asset.category,
    modelUrl: asset.url,
    position: slot.position,
    rotation: [0, slot.rotationY, 0],
    dimensions: [width, height, depth],
    confidence: Number(slot.score.toFixed(2)),
    reasoning: [layout.reasons[0], ...slot.reasons.slice(1)].join('. '),
    status: 'pending',
  }));
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  pair: 2, couple: 2,
};

/** Reads "place 4 chairs" / "add two stools" style counts; returns `fallback` when none is given. */
export function parsePlacementCount(prompt: string, fallback = 2): number {
  const digits = prompt.match(/\b(\d{1,2})\b/);
  if (digits) return Math.max(1, Math.min(12, parseInt(digits[1], 10)));
  const word = prompt.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|pair|couple)\b/);
  return word ? NUMBER_WORDS[word[1]] : fallback;
}
