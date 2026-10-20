import type { RoomInterpretation } from '@/lib/contracts';
import type { EditableSceneSummary } from '@/lib/pascal/sceneBridge';
import type { ItemNode } from '@/lib/pascal/itemEditing';
import {
  buildContext,
  inferCategory,
  normalizeCategory,
  solveInContext,
  validateSubject,
  type PlacementContext,
  type ScoredPlacement,
} from '@/lib/placement';

export interface CandidatePlacement {
  id: string;
  name: string;
  category: string;
  modelUrl: string;
  position: [number, number, number];
  rotation: [number, number, number];
  dimensions: [number, number, number];
  confidence: number;
  reasoning: string;
  zoneId?: string;
  status: 'pending' | 'accepted' | 'rejected';
}

/**
 * Legacy entry points kept for existing callers (chat panel, store, tests).
 * The geometry and scoring live in `@/lib/placement`; this file only adapts
 * `EditableSceneSummary` to the placement context and back.
 */

/** Rooms narrower than this (m) in either axis are treated as unenclosed (no outline check). */
const MIN_ENCLOSED_SPAN = 1;

function synthesizeInterpretation(scene: EditableSceneSummary): RoomInterpretation {
  const walls = scene.walls.map((w) => ({
    id: w.id,
    start: [w.start[0], 0, w.start[1]] as [number, number, number],
    end: [w.end[0], 0, w.end[1]] as [number, number, number],
    height: w.height > 0 ? w.height : 2.5,
    thickness: w.thickness > 0 ? w.thickness : 0.1,
    confidence: 1,
    provenance: 'user' as const,
  }));

  // Bounding box of the walls only; an unenclosed layout gets no outline rather than a degenerate one.
  let outline: Array<[number, number]> = [];
  if (walls.length >= 3) {
    const xs = walls.flatMap((w) => [w.start[0], w.end[0]]);
    const zs = walls.flatMap((w) => [w.start[2], w.end[2]]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    if (x1 - x0 >= MIN_ENCLOSED_SPAN && z1 - z0 >= MIN_ENCLOSED_SPAN) {
      outline = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    }
  }

  return {
    provenance: 'user',
    floor: { normal: [0, 1, 0], constant: 0, provenance: 'user' },
    ceilingHeight: Math.max(2.5, ...walls.map((w) => w.height)),
    outline,
    walls,
    openings: [],
    detections: [],
  };
}

function summaryItemsToNodes(scene: EditableSceneSummary): ItemNode[] {
  return scene.items.map(
    (i) =>
      ({
        id: i.id,
        type: 'item',
        name: i.name,
        visible: true,
        position: i.position,
        rotation: i.rotation ?? [0, 0, 0],
        scale: [1, 1, 1],
        asset: {
          category: i.category ?? '',
          src: i.modelUrl ?? i.name,
          dimensions: i.dimensions ?? [0.8, 0.8, 0.8],
        },
      }) as unknown as ItemNode
  );
}

const contexts = new WeakMap<EditableSceneSummary, PlacementContext>();

function contextFor(scene: EditableSceneSummary): PlacementContext {
  let ctx = contexts.get(scene);
  if (!ctx) {
    ctx = buildContext(summaryItemsToNodes(scene), synthesizeInterpretation(scene), {
      includeDetections: false,
      // Openings are not part of the summary, so the legacy API can only reason about obstacles.
    });
    contexts.set(scene, ctx);
  }
  return ctx;
}

/**
 * Validates whether a candidate 3D box footprint collides with walls or existing items.
 */
export function checkCollision(
  pos: [number, number, number],
  dims: [number, number, number],
  scene: EditableSceneSummary,
  ignoreItemId?: string,
  rotationY = 0
): { collides: boolean; reason?: string } {
  const ctx = contextFor(scene);
  const probe: PlacementContext = ignoreItemId
    ? { ...ctx, obstacles: ctx.obstacles.filter((o) => o.id !== ignoreItemId) }
    : ctx;
  const violations = validateSubject(
    { id: '__candidate__', category: 'furniture', x: pos[0], y: pos[1], z: pos[2], yaw: rotationY, dims },
    probe
  );
  for (const v of violations) {
    if (v.code === 'OVERLAP_WALL') {
      const name = scene.walls.find((w) => w.id === v.nodeIds[1])?.name ?? v.nodeIds[1];
      return { collides: true, reason: `Clips wall "${name}"` };
    }
    if (v.code === 'OVERLAP_ITEM') {
      const name = scene.items.find((i) => i.id === v.nodeIds[1])?.name ?? v.nodeIds[1];
      return { collides: true, reason: `Overlaps item "${name}"` };
    }
  }
  return { collides: false };
}

/**
 * Deterministic spiral grid search to find the nearest valid collision-free coordinate.
 */
export function findNearestValidPosition(
  initialPos: [number, number, number],
  dims: [number, number, number],
  scene: EditableSceneSummary,
  maxRadius: number = 0.8,
  step: number = 0.1
): [number, number, number] {
  if (!checkCollision(initialPos, dims, scene).collides) return initialPos;

  const [ix, iy, iz] = initialPos;
  for (let r = step; r <= maxRadius + 1e-9; r += step) {
    const numPoints = Math.max(8, Math.round((2 * Math.PI * r) / step));
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const candidate: [number, number, number] = [
        Number((ix + r * Math.cos(angle)).toFixed(2)),
        iy,
        Number((iz + r * Math.sin(angle)).toFixed(2)),
      ];
      if (!checkCollision(candidate, dims, scene).collides) return candidate;
    }
  }
  return initialPos;
}

const SIDE_ORDER: Record<string, number> = { north: 0, south: 1, east: 2, west: 3 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nz = (n: number) => (Object.is(n, -0) ? 0 : n);

/**
 * Synthesizes design-coherent smart placements for uploaded or catalog 3D models.
 * Delegates to the placement solver and returns its best layout as pending candidates.
 */
export function solveSmartPlacements(
  modelUrl: string,
  modelName: string,
  category: string,
  dimensions: [number, number, number],
  userPrompt: string,
  scene: EditableSceneSummary
): CandidatePlacement[] {
  const countMatch = userPrompt.toLowerCase().match(/\b([1-8])\b/);
  const count = countMatch ? parseInt(countMatch[1], 10) : 2;
  const cat = normalizeCategory(category) || inferCategory(modelName);

  const ctx = contextFor(scene);
  const layouts = solveInContext(
    { asset: { url: modelUrl, name: modelName, category: cat, dimensions }, count, topK: 1 },
    ctx
  );
  const best = layouts[0];
  if (!best) return [];

  const placements: ScoredPlacement[] = [...best.placements].sort(
    (a, b) => (SIDE_ORDER[a.side ?? ''] ?? 9) - (SIDE_ORDER[b.side ?? ''] ?? 9)
  );
  const stamp = Date.now();
  return placements.map((p, i) => {
    const anchor = p.anchorId ? ctx.obstacles.find((o) => o.id === p.anchorId) : undefined;
    const isDining = anchor?.category === 'dining_table' || /dining/i.test(anchor?.name ?? '');
    const label =
      p.strategy === 'anchor' && anchor && p.side
        ? `${isDining ? 'Dining Chair' : anchor.name} ${cap(p.side)}`
        : p.strategy === 'wall'
          ? `Wall #${i + 1}`
          : `Open floor #${i + 1}`;
    return {
      id: `candidate_${cat}_${stamp}_${i}`,
      name: `${modelName} (${label})`,
      category: cat,
      modelUrl,
      position: [nz(p.position[0]), nz(p.position[1]), nz(p.position[2])],
      rotation: [0, nz(p.rotationY), 0],
      dimensions,
      confidence: Math.round(Math.min(0.99, Math.max(0.1, p.score)) * 100) / 100,
      reasoning: p.reasons.join('; '),
      status: 'pending' as const,
    };
  });
}
