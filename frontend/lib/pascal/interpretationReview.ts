import { useScene, type AnyNode, type AnyNodeId } from '@pascal-app/core';
import type {
  DetectionInterpretation,
  DetectionStatus,
  MaskRegion,
  OpeningKind,
  OrientedBoundingBox,
  Point2D,
  Provenance,
  RoomInterpretation,
} from '@/lib/contracts';
import {
  clampOpeningCenter,
  deriveInterpretationFromScene,
  getInterpretationMeta,
  openingPosition,
  wallLength,
  withInterpretationMeta,
  type InterpretationMeta,
} from './scanConverter';
import { nodeViews, type NodeView, type NodeViewMap } from './nodes';

/**
 * Review and correction of a converted RoomInterpretation.
 *
 * Every correction is one `applyNodeChanges` call (one Pascal temporal step), sets
 * provenance=user/status=corrected on what it touches, and keeps linked MaskRegions in sync.
 */

type NodeMap = NodeViewMap;

export type ReviewKind = 'outline' | 'wall' | 'opening' | 'detection';
export interface ElementRef {
  kind: ReviewKind;
  /** Pascal node id for outline/wall/opening; detection id for detections. */
  id: string;
}

export interface ReviewItem {
  ref: ElementRef;
  key: string;
  label: string;
  confidence: number;
  status: DetectionStatus;
  provenance: Provenance;
}

export const LOW_CONFIDENCE = 0.9;
const EPS = 1e-3;
const CORRECTED = { provenance: 'user' as const, status: 'corrected' as const };

export const refKey = (ref: ElementRef) => `${ref.kind}:${ref.id}`;
export const isTrustedStatus = (status: DetectionStatus | null | undefined) => status === 'verified' || status === 'corrected';

/** Overlay colour: reviewed elements are blue, otherwise red/amber/green by confidence. */
export function confidenceColor(confidence: number, status: DetectionStatus = 'auto'): string {
  if (status === 'rejected') return '#6b7280';
  if (isTrustedStatus(status)) return '#3b82f6';
  if (confidence < 0.7) return '#ef4444';
  if (confidence < LOW_CONFIDENCE) return '#f59e0b';
  return '#22c55e';
}

export function getScanNode(nodes: NodeMap): NodeView | null {
  return Object.values(nodes).find((n) => n?.type === 'scan' && Array.isArray(n.metadata?.detections)) || null;
}

export function getDetections(nodes: NodeMap): DetectionInterpretation[] {
  return getScanNode(nodes)?.metadata?.detections || [];
}

/** Elements to review, unreviewed and lowest-confidence first. */
export function getReviewItems(nodes: NodeMap): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const node of Object.values(nodes)) {
    const meta = getInterpretationMeta(node);
    if (!node || !meta || meta.kind === 'zone') continue;
    const kind: ReviewKind = meta.kind;
    const label =
      kind === 'outline' ? 'Room outline'
        : kind === 'wall' ? `Wall ${meta.sourceId}`
          : `${capitalize(meta.openingKind || node.type)} ${meta.sourceId}`;
    items.push({ ref: { kind, id: node.id }, key: refKey({ kind, id: node.id }), label, confidence: meta.confidence, status: meta.status, provenance: meta.provenance });
  }
  for (const det of getDetections(nodes)) {
    const ref: ElementRef = { kind: 'detection', id: det.id };
    items.push({ ref, key: refKey(ref), label: det.label, confidence: det.confidence, status: det.status, provenance: det.provenance });
  }
  const rank = (s: DetectionStatus) => (s === 'auto' ? 0 : s === 'rejected' ? 2 : 1);
  return items.sort((a, b) => rank(a.status) - rank(b.status) || a.confidence - b.confidence || a.key.localeCompare(b.key));
}

export interface TrustedInterpretation {
  /** Only verified/corrected elements; null when no interpretation is in the scene. */
  interpretation: RoomInterpretation | null;
  untrusted: ReviewItem[];
  warning: string | null;
}

/** What placement features may rely on: verified or corrected elements only. */
export function getTrustedInterpretation(nodes: NodeMap = nodeViews()): TrustedInterpretation {
  const full = deriveInterpretationFromScene(nodes);
  if (!full) return { interpretation: null, untrusted: [], warning: null };
  const untrusted = getReviewItems(nodes).filter((item) => item.status === 'auto');
  const trusted: RoomInterpretation = {
    ...full,
    outline: isTrustedStatus(full.outlineStatus) ? full.outline : [],
    walls: full.walls.filter((w) => isTrustedStatus(w.status)),
    openings: full.openings.filter((o) => isTrustedStatus(o.status)),
    detections: full.detections.filter((d) => isTrustedStatus(d.status)),
  };
  const warning = untrusted.length
    ? `${untrusted.length} scan element${untrusted.length === 1 ? ' is' : 's are'} unreviewed; placement ignores them until verified or corrected.`
    : null;
  return { interpretation: trusted, untrusted, warning };
}

// ---------------------------------------------------------------------------
// Batched writes
// ---------------------------------------------------------------------------

class Batch {
  private updates = new Map<string, Record<string, unknown>>();
  private creates: Array<{ node: AnyNode; parentId?: AnyNodeId }> = [];
  private deletes: string[] = [];
  readonly nodes: NodeMap;

  constructor() {
    this.nodes = nodeViews();
  }

  node(id: string): NodeView {
    const base = this.nodes[id];
    if (!base) throw new Error(`Node not found: ${id}`);
    return { ...base, ...this.updates.get(id) };
  }

  patch(id: string, data: Record<string, unknown>) {
    this.updates.set(id, { ...this.updates.get(id), ...data });
  }

  mark(id: string, meta: Partial<InterpretationMeta>) {
    this.patch(id, { metadata: withInterpretationMeta(this.node(id), meta) });
  }

  create(node: Record<string, unknown>, parentId: string | null | undefined) {
    this.creates.push({ node: node as unknown as AnyNode, parentId: (parentId || undefined) as AnyNodeId | undefined });
  }

  remove(id: string) {
    this.deletes.push(id);
    this.updates.delete(id);
  }

  commit() {
    const update = [...this.updates].map(([id, data]) => ({ id: id as AnyNodeId, data: data as Partial<AnyNode> }));
    useScene.getState().applyNodeChanges({
      create: this.creates.length ? this.creates : undefined,
      update: update.length ? update : undefined,
      delete: this.deletes.length ? (this.deletes as AnyNodeId[]) : undefined,
    });
  }
}

const samePoint = (a: Point2D, b: Point2D) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
const pt = (p: readonly number[]): Point2D => [p[0], p[1]];

function interpretedNodes(batch: Batch, kind: InterpretationMeta['kind']) {
  return Object.values(batch.nodes)
    .filter((n): n is NodeView => getInterpretationMeta(n)?.kind === kind)
    .map((n) => batch.node(n.id));
}

function clampOpenings(batch: Batch, wallId: string) {
  const wall = batch.node(wallId);
  const len = wallLength(wall.start, wall.end);
  for (const childId of wall.children || []) {
    const child = batch.nodes[childId];
    if (!child || (child.type !== 'door' && child.type !== 'window')) continue;
    const current = batch.node(childId);
    const width = Math.min(current.width, len);
    const u = clampOpeningCenter(current.position[0], width, len);
    if (u !== current.position[0] || width !== current.width) {
      batch.patch(childId, { width, position: [u, current.position[1], current.position[2]] });
      batch.mark(childId, CORRECTED);
    }
  }
}

/** Moves every wall endpoint and outline vertex at `from` to `to`, keeping the room closed. */
function movePoints(batch: Batch, moves: Array<{ from: Point2D; to: Point2D }>, skipWallId?: string) {
  const target = (p: Point2D) => moves.find((m) => samePoint(m.from, p))?.to;
  for (const wall of interpretedNodes(batch, 'wall')) {
    if (wall.id === skipWallId) continue;
    const start = target(wall.start);
    const end = target(wall.end);
    if (!start && !end) continue;
    batch.patch(wall.id, { start: start || wall.start, end: end || wall.end });
    batch.mark(wall.id, CORRECTED);
    clampOpenings(batch, wall.id);
  }
  for (const kind of ['outline', 'zone'] as const) {
    for (const poly of interpretedNodes(batch, kind)) {
      let changed = false;
      const polygon = (poly.polygon as Point2D[]).map((p) => {
        const to = target(p);
        if (to) changed = true;
        return to ? [...to] : p;
      });
      if (changed) {
        batch.patch(poly.id, { polygon });
        batch.mark(poly.id, CORRECTED);
      }
    }
  }
}

function requireMeta(batch: Batch, id: string, kind: InterpretationMeta['kind']) {
  const node = batch.node(id);
  if (getInterpretationMeta(node)?.kind !== kind) throw new Error(`${id} is not an interpreted ${kind}`);
  return node;
}

function patchDetection(
  batch: Batch,
  detectionId: string,
  change: (d: DetectionInterpretation) => DetectionInterpretation,
  maskChange: (m: MaskRegion, d: DetectionInterpretation) => MaskRegion,
) {
  const scanRaw = getScanNode(batch.nodes);
  if (!scanRaw) throw new Error('No scan node with detections');
  const scan = batch.node(scanRaw.id);
  const detections: DetectionInterpretation[] = scan.metadata?.detections || [];
  const current = detections.find((d) => d.id === detectionId);
  if (!current) throw new Error(`Detection not found: ${detectionId}`);
  const next = change(current);
  const masks: MaskRegion[] = scan.metadata?.maskRegions || [];
  const linked = (m: MaskRegion) => m.id === current.maskRegionId || m.detectionId === current.id;
  batch.patch(scan.id, {
    metadata: {
      ...scan.metadata,
      detections: detections.map((d) => (d.id === detectionId ? next : d)),
      maskRegions: masks.map((m) => (linked(m) ? maskChange(m, next) : m)),
    },
  });
}

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

function setStatus(ref: ElementRef, status: DetectionStatus, provenance?: Provenance) {
  const batch = new Batch();
  if (ref.kind === 'detection') {
    patchDetection(
      batch,
      ref.id,
      (d) => ({ ...d, status, ...(provenance ? { provenance } : {}) }),
      (m) => (status === 'rejected' ? { ...m, enabled: false } : m),
    );
  } else {
    const meta = { status, ...(provenance ? { provenance } : {}) };
    batch.mark(ref.id, meta);
    if (status === 'rejected' && ref.kind !== 'outline') batch.patch(ref.id, { visible: false });
    if (ref.kind === 'outline') {
      for (const zone of interpretedNodes(batch, 'zone')) batch.mark(zone.id, meta);
    }
  }
  batch.commit();
}

/** Confirms an element as interpreted. Provenance stays as it was. */
export function verifyElement(ref: ElementRef) {
  setStatus(ref, 'verified');
}

/** Marks an element as wrong: hidden from the scene, linked masks disabled. */
export function rejectElement(ref: ElementRef) {
  setStatus(ref, 'rejected', 'user');
}

export function moveOutlineVertex(slabId: string, index: number, to: Point2D) {
  const batch = new Batch();
  const slab = requireMeta(batch, slabId, 'outline');
  const from = pt(slab.polygon[index]);
  movePoints(batch, [{ from, to: pt(to) }]);
  batch.commit();
}

/** Sets a wall's endpoints; connected walls and the outline follow shared corners. */
export function setWallEndpoints(wallId: string, start: Point2D, end: Point2D) {
  const batch = new Batch();
  const wall = requireMeta(batch, wallId, 'wall');
  if (wallLength(start, end) < 0.05) throw new Error('A wall must be at least 5 cm long.');
  const moves = [
    { from: pt(wall.start), to: pt(start) },
    { from: pt(wall.end), to: pt(end) },
  ].filter((m) => !samePoint(m.from, m.to));
  batch.patch(wallId, { start: pt(start), end: pt(end) });
  batch.mark(wallId, CORRECTED);
  movePoints(batch, moves, wallId);
  clampOpenings(batch, wallId);
  batch.commit();
}

export function moveWall(wallId: string, delta: Point2D) {
  const wall = nodeViews()[wallId];
  if (!wall) throw new Error(`Node not found: ${wallId}`);
  setWallEndpoints(wallId, [wall.start[0] + delta[0], wall.start[1] + delta[1]], [wall.end[0] + delta[0], wall.end[1] + delta[1]]);
}

/** Splits a wall at fraction `t`; openings past the split move to the new wall. */
export function splitWall(wallId: string, t = 0.5): string {
  const batch = new Batch();
  const wall = requireMeta(batch, wallId, 'wall');
  const meta = getInterpretationMeta(wall)!;
  const len = wallLength(wall.start, wall.end);
  const split: Point2D = [wall.start[0] + (wall.end[0] - wall.start[0]) * t, wall.start[1] + (wall.end[1] - wall.start[1]) * t];
  const splitU = len * t;
  const newId = `wall_${meta.sourceId.replace(/^wall_/, '')}_split_${Date.now().toString(36)}`;
  batch.patch(wallId, { end: split });
  batch.mark(wallId, CORRECTED);
  batch.create(
    {
      id: newId,
      type: 'wall',
      name: `${wall.name || 'Wall'} (split)`,
      start: split,
      end: pt(wall.end),
      height: wall.height,
      thickness: wall.thickness,
      metadata: { interpretation: { ...meta, ...CORRECTED, sourceId: newId } satisfies InterpretationMeta },
    },
    wall.parentId,
  );
  for (const childId of wall.children || []) {
    const child = batch.nodes[childId];
    if (!child || (child.type !== 'door' && child.type !== 'window') || child.position[0] <= splitU) continue;
    batch.remove(childId);
    batch.create(
      {
        ...child,
        parentId: undefined,
        wallId: newId,
        position: [child.position[0] - splitU, child.position[1], child.position[2]],
        metadata: withInterpretationMeta(child, CORRECTED),
      },
      newId,
    );
  }
  clampOpenings(batch, wallId);
  batch.commit();
  return newId;
}

/** Removes a wall and its openings from the scene (and from the saved interpretation). */
export function deleteWall(wallId: string) {
  const batch = new Batch();
  requireMeta(batch, wallId, 'wall');
  batch.remove(wallId);
  batch.commit();
}

export function addOpening(wallId: string, kind: OpeningKind, at?: { offset?: number; width?: number; height?: number; sill?: number }): string {
  const batch = new Batch();
  const wall = requireMeta(batch, wallId, 'wall');
  const len = wallLength(wall.start, wall.end);
  const isWindow = kind === 'window';
  const width = Math.min(at?.width ?? (isWindow ? 1.2 : 0.9), len);
  const height = at?.height ?? (isWindow ? 1.2 : 2.1);
  const sill = at?.sill ?? (isWindow ? 0.9 : 0);
  const offset = clampOpeningCenter(at?.offset ?? len / 2, width, len);
  const sourceId = `${isWindow ? 'window' : 'door'}_user_${Date.now().toString(36)}`;
  batch.create(
    {
      id: sourceId,
      type: isWindow ? 'window' : 'door',
      name: isWindow ? 'Window' : kind === 'opening' ? 'Opening' : 'Door',
      wallId,
      position: openingPosition(offset, height, sill),
      rotation: [0, 0, 0],
      width,
      height,
      ...(kind === 'opening' ? { openingKind: 'opening' } : {}),
      metadata: { interpretation: { kind: 'opening', sourceId, confidence: 1, ...CORRECTED, openingKind: kind } satisfies InterpretationMeta },
    },
    wallId,
  );
  batch.commit();
  return sourceId;
}

export function removeOpening(openingId: string) {
  const batch = new Batch();
  requireMeta(batch, openingId, 'opening');
  batch.remove(openingId);
  batch.commit();
}

/**
 * Moves/resizes an opening. `offset` is the centre along the wall (contract convention), so a
 * width change keeps the centre fixed; `edge` instead keeps the opposite edge fixed (edge drag).
 */
export function resizeOpening(
  openingId: string,
  change: { offset?: number; width?: number; height?: number; sill?: number; edge?: 'start' | 'end' },
) {
  const batch = new Batch();
  const node = requireMeta(batch, openingId, 'opening');
  const wall = batch.node(node.wallId || node.parentId || '');
  const len = wallLength(wall.start, wall.end);
  const width = Math.min(Math.max(0.1, change.width ?? node.width), len);
  const height = Math.max(0.1, change.height ?? node.height);
  const currentSill = Math.max(0, node.position[1] - node.height / 2);
  let center = change.offset ?? node.position[0];
  if (change.offset === undefined && change.edge === 'end') center = node.position[0] - node.width / 2 + width / 2;
  if (change.offset === undefined && change.edge === 'start') center = node.position[0] + node.width / 2 - width / 2;
  const offset = clampOpeningCenter(center, width, len);
  const sill = Math.max(0, change.sill ?? currentSill);
  batch.patch(openingId, { width, height, position: openingPosition(offset, height, sill) });
  batch.mark(openingId, CORRECTED);
  batch.commit();
}

/** Moves/resizes/rotates a detection box; its linked MaskRegion follows. */
export function updateDetectionBox(detectionId: string, change: Partial<OrientedBoundingBox>) {
  const batch = new Batch();
  patchDetection(
    batch,
    detectionId,
    (d) => ({
      ...d,
      obb: {
        center: change.center ? [...change.center] : d.obb.center,
        size: change.size ? (change.size.map((v) => Math.max(0.05, v)) as OrientedBoundingBox['size']) : d.obb.size,
        yaw: change.yaw ?? d.obb.yaw,
      },
      ...CORRECTED,
    }),
    (m, d) => ({ ...m, obb: { center: [...d.obb.center], size: [...d.obb.size], yaw: d.obb.yaw } }),
  );
  batch.commit();
}

export function relabelDetection(detectionId: string, label: string, category?: string) {
  if (!label.trim()) throw new Error('A label is required.');
  const batch = new Batch();
  patchDetection(batch, detectionId, (d) => ({ ...d, label: label.trim(), category: category?.trim() || d.category, ...CORRECTED }), (m) => m);
  batch.commit();
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
