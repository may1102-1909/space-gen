import type { Point2D } from '@/lib/contracts';
import type { NodeViewMap } from './nodes';

/**
 * Plan-space (scene XZ, metres) snapping for the architectural tools.
 *
 * Targets are precomputed from the scene's walls / outline and an optional scan point set,
 * so a pointer move is a handful of distance checks, never a splat raycast. Priority:
 * corner > wall face > scan point > floor (the raw y=0 hit).
 */

export type SnapKind = 'corner' | 'wall-face' | 'scan-point' | 'floor';

export interface FaceSegment {
  a: Point2D;
  b: Point2D;
  wallId: string;
}

export interface SnapTargets {
  corners: Point2D[];
  faces: FaceSegment[];
  /** Scan feature points bucketed by `cell` for O(1) neighbourhood lookup. */
  scanBuckets: Map<string, Point2D[]>;
  cell: number;
}

export interface SnapResult {
  point: Point2D;
  kind: SnapKind;
  distance: number;
}

export const SNAP_RADII: Record<Exclude<SnapKind, 'floor'>, number> = {
  corner: 0.3,
  'wall-face': 0.2,
  'scan-point': 0.15,
};

type NodeMap = NodeViewMap;

const key = (x: number, z: number, cell: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;

function dedupe(points: Point2D[], eps = 1e-3): Point2D[] {
  const out: Point2D[] = [];
  for (const p of points) {
    if (!out.some((q) => Math.abs(q[0] - p[0]) < eps && Math.abs(q[1] - p[1]) < eps)) out.push(p);
  }
  return out;
}

/** Both faces of a wall: its centreline offset by ±thickness/2. */
export function wallFaces(start: Point2D, end: Point2D, thickness: number, wallId = ''): FaceSegment[] {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return [];
  const nx = (-dz / len) * (thickness / 2);
  const nz = (dx / len) * (thickness / 2);
  return [1, -1].map((s) => ({
    a: [start[0] + nx * s, start[1] + nz * s] as Point2D,
    b: [end[0] + nx * s, end[1] + nz * s] as Point2D,
    wallId,
  }));
}

/** Closest point on segment ab to p. */
export function closestOnSegment(p: Point2D, a: Point2D, b: Point2D): Point2D {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return [a[0] + dx * t, a[1] + dz * t];
}

const dist = (a: Point2D, b: Point2D) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Builds snap targets from visible walls (interpreted and user-drawn), the interpretation
 * outline (slab/zone polygons) and optional scan points (e.g. proxy-mesh floor vertices).
 */
export function buildSnapTargets(nodes: NodeMap, scanPoints: Point2D[] = [], cell = 0.5): SnapTargets {
  const corners: Point2D[] = [];
  const faces: FaceSegment[] = [];
  for (const node of Object.values(nodes)) {
    if (!node || node.visible === false) continue;
    if (node.type === 'wall' && node.start && node.end) {
      corners.push([node.start[0], node.start[1]], [node.end[0], node.end[1]]);
      faces.push(...wallFaces(node.start, node.end, node.thickness ?? 0.2, node.id));
    } else if ((node.metadata?.interpretation as { kind?: string } | undefined)?.kind === 'outline' && Array.isArray(node.polygon)) {
      for (const p of node.polygon) corners.push([p[0], p[1]]);
    }
  }
  const scanBuckets = new Map<string, Point2D[]>();
  for (const p of scanPoints) {
    const k = key(p[0], p[1], cell);
    const bucket = scanBuckets.get(k);
    if (bucket) bucket.push(p);
    else scanBuckets.set(k, [p]);
  }
  return { corners: dedupe(corners), faces, scanBuckets, cell };
}

export function snapPlanPoint(point: Point2D, targets: SnapTargets, radii = SNAP_RADII): SnapResult {
  let best: SnapResult | null = null;
  for (const c of targets.corners) {
    const d = dist(point, c);
    if (d <= radii.corner && (!best || d < best.distance)) best = { point: [c[0], c[1]], kind: 'corner', distance: d };
  }
  if (best) return best;

  for (const f of targets.faces) {
    const q = closestOnSegment(point, f.a, f.b);
    const d = dist(point, q);
    if (d <= radii['wall-face'] && (!best || d < best.distance)) best = { point: q, kind: 'wall-face', distance: d };
  }
  if (best) return best;

  const { cell, scanBuckets } = targets;
  const cx = Math.floor(point[0] / cell);
  const cz = Math.floor(point[1] / cell);
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iz = cz - 1; iz <= cz + 1; iz++) {
      for (const p of scanBuckets.get(`${ix},${iz}`) || []) {
        const d = dist(point, p);
        if (d <= radii['scan-point'] && (!best || d < best.distance)) best = { point: [p[0], p[1]], kind: 'scan-point', distance: d };
      }
    }
  }
  return best || { point: [point[0], point[1]], kind: 'floor', distance: 0 };
}

/**
 * Plan footprint of a scan proxy mesh's vertical structure (wall faces, furniture sides):
 * vertices within a height band, projected to XZ and voxel-downsampled once (not per frame).
 * `positions` are scene-space xyz triples (already transformed by scanToScene).
 */
export function planFeaturePoints(positions: ArrayLike<number>, minY = 0.3, maxY = 2.0, voxel = 0.1, limit = 4000): Point2D[] {
  const seen = new Map<string, Point2D>();
  for (let i = 0; i + 2 < positions.length && seen.size < limit; i += 3) {
    const y = positions[i + 1];
    if (y < minY || y > maxY) continue;
    const x = positions[i];
    const z = positions[i + 2];
    const k = key(x, z, voxel);
    if (!seen.has(k)) seen.set(k, [x, z]);
  }
  return [...seen.values()];
}
