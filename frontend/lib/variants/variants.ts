import type { EditRecord, Variant } from '@/lib/contracts';
import type { ScaleSource } from '@/lib/contracts/scan';
import { formatMeasurement } from '@/lib/measurement/accuracy';
import { isProposalGhost } from '@/lib/pascal/proposalPreview';

/** A Pascal scene document (`getSceneDocument()` output). */
export interface SnapNode {
  id: string;
  type: string;
  name?: string;
  position?: number[];
  rotation?: number[];
  scale?: number[];
  children?: string[];
  metadata?: Record<string, unknown>;
  asset?: { id?: string; src?: string; name?: string; dimensions?: number[] };
}
export type Snapshot = { nodes?: Record<string, SnapNode>; rootNodeIds?: string[] } & Record<string, unknown>;

export interface VariantSet {
  variants: Variant[];
  activeVariantId: string;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The manifest's variant list, guaranteed non-empty with the active id present. `scene` is the
 * live Pascal document: it is always the truth for the active variant, so every operation starts
 * by committing it into that variant.
 */
export function normalizeVariants(set: VariantSet, scene: Snapshot, now = new Date().toISOString()): VariantSet {
  const variants = set.variants.length ? set.variants : [{ id: set.activeVariantId || 'default', name: 'Default', sceneSnapshot: {}, createdAt: now }];
  const activeVariantId = variants.some((v) => v.id === set.activeVariantId) ? set.activeVariantId : variants[0].id;
  return {
    activeVariantId,
    variants: variants.map((v) => (v.id === activeVariantId ? { ...v, sceneSnapshot: clone(scene) } : v)),
  };
}

export const activeVariant = (set: VariantSet): Variant => set.variants.find((v) => v.id === set.activeVariantId) ?? set.variants[0];

const newId = () => `variant_${Math.random().toString(36).slice(2, 10)}`;

/** The shell of a scene: items are removed (and unlinked), their masks and edit history dropped. */
export function blankSnapshot(snapshot: Snapshot): Snapshot {
  const copy = clone(snapshot);
  const nodes = copy.nodes ?? {};
  const itemIds = new Set(Object.keys(nodes).filter((id) => nodes[id]?.type === 'item'));
  for (const id of itemIds) delete nodes[id];
  if (copy.rootNodeIds) copy.rootNodeIds = copy.rootNodeIds.filter((id) => !itemIds.has(id));
  for (const node of Object.values(nodes)) {
    if (node.children) node.children = node.children.filter((id) => !itemIds.has(id));
    if (node.metadata) {
      delete node.metadata.editHistory;
      if (node.type === 'scan') node.metadata.maskRegions = [];
    }
  }
  return copy;
}

/** Creates a variant from the active one (`current`) or as a shell only (`blank`) and makes it active. */
export function createVariant(
  set: VariantSet,
  scene: Snapshot,
  options: { name: string; from: 'current' | 'blank'; id?: string; now?: string },
): VariantSet {
  const base = normalizeVariants(set, scene, options.now);
  const source = activeVariant(base);
  const variant: Variant = {
    id: options.id ?? newId(),
    name: options.name,
    sceneSnapshot: options.from === 'blank' ? blankSnapshot(source.sceneSnapshot) : clone(source.sceneSnapshot),
    createdAt: options.now ?? new Date().toISOString(),
    parentVariantId: source.id,
  };
  return { variants: [...base.variants, variant], activeVariantId: variant.id };
}

/** Copies any variant (not only the active one) and makes the copy active. */
export function duplicateVariant(set: VariantSet, scene: Snapshot, id: string, options: { name?: string; newId?: string; now?: string } = {}): VariantSet {
  const base = normalizeVariants(set, scene, options.now);
  const source = base.variants.find((v) => v.id === id);
  if (!source) throw new Error(`Unknown variant ${id}`);
  const copy: Variant = {
    ...clone(source),
    id: options.newId ?? newId(),
    name: options.name ?? `${source.name} copy`,
    createdAt: options.now ?? new Date().toISOString(),
    parentVariantId: source.id,
  };
  return { variants: [...base.variants, copy], activeVariantId: copy.id };
}

export function renameVariant(set: VariantSet, scene: Snapshot, id: string, name: string): VariantSet {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Variant name cannot be empty');
  const base = normalizeVariants(set, scene);
  return { ...base, variants: base.variants.map((v) => (v.id === id ? { ...v, name: trimmed } : v)) };
}

/** Deletes a variant; the last one cannot be deleted. Deleting the active one activates its neighbour. */
export function deleteVariant(set: VariantSet, scene: Snapshot, id: string): VariantSet {
  const base = normalizeVariants(set, scene);
  if (base.variants.length <= 1) throw new Error('Cannot delete the last variant');
  const index = base.variants.findIndex((v) => v.id === id);
  if (index < 0) throw new Error(`Unknown variant ${id}`);
  const variants = base.variants.filter((v) => v.id !== id).map((v) => (v.parentVariantId === id ? { ...v, parentVariantId: null } : v));
  const activeVariantId = base.activeVariantId === id ? variants[Math.min(index, variants.length - 1)].id : base.activeVariantId;
  return { variants, activeVariantId };
}

/** Makes `id` active; the caller loads `activeVariant(result).sceneSnapshot` into the scene. */
export function switchVariant(set: VariantSet, scene: Snapshot, id: string): VariantSet {
  const base = normalizeVariants(set, scene);
  if (!base.variants.some((v) => v.id === id)) throw new Error(`Unknown variant ${id}`);
  return { ...base, activeVariantId: id };
}

// ---- Comparison -----------------------------------------------------------------------------

export interface ItemInfo {
  id: string;
  name: string;
  position: [number, number, number];
  rotationY: number;
  /** Footprint including node scale, in meters. */
  size: [number, number, number];
  assetId: string;
  assetSrc: string;
}

export function readItems(snapshot: Snapshot): ItemInfo[] {
  return Object.values(snapshot.nodes ?? {})
    .filter((n) => n.type === 'item' && !isProposalGhost(n))
    .map((n) => {
      const dims = n.asset?.dimensions ?? [1, 1, 1];
      const scale = n.scale ?? [1, 1, 1];
      return {
        id: n.id,
        name: n.name ?? n.asset?.name ?? n.id,
        position: (n.position ?? [0, 0, 0]) as [number, number, number],
        rotationY: n.rotation?.[1] ?? 0,
        size: [dims[0] * scale[0], dims[1] * scale[1], dims[2] * scale[2]],
        assetId: n.asset?.id ?? '',
        assetSrc: n.asset?.src ?? '',
      };
    });
}

export type ChangeKind = 'added' | 'removed' | 'moved' | 'replaced';

export interface ItemChange {
  kind: ChangeKind;
  id: string;
  /** Name in variant B, or in A for removed items. */
  name: string;
  /** Previous name, for replaced items. */
  fromName?: string;
  /** Straight-line distance between the two positions, in meters (moved / replaced in place). */
  distance?: number;
}

export const MOVE_EPSILON_M = 0.01;

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Item differences going from variant A to variant B, matched by node id (ids survive a replace). */
export function diffItems(a: Snapshot, b: Snapshot): ItemChange[] {
  const before = new Map(readItems(a).map((i) => [i.id, i]));
  const after = new Map(readItems(b).map((i) => [i.id, i]));
  const changes: ItemChange[] = [];
  for (const [id, next] of after) {
    const prev = before.get(id);
    if (!prev) { changes.push({ kind: 'added', id, name: next.name }); continue; }
    const d = distance(prev.position, next.position);
    if (prev.assetId !== next.assetId || prev.assetSrc !== next.assetSrc) {
      changes.push({ kind: 'replaced', id, name: next.name, fromName: prev.name, distance: d > MOVE_EPSILON_M ? d : undefined });
    } else if (d > MOVE_EPSILON_M) {
      changes.push({ kind: 'moved', id, name: next.name, distance: d });
    }
  }
  for (const [id, prev] of before) if (!after.has(id)) changes.push({ kind: 'removed', id, name: prev.name });
  return changes;
}

export function describeChange(change: ItemChange, scaleSource: ScaleSource): string {
  const label = { added: 'Added', removed: 'Removed', moved: 'Moved', replaced: 'Replaced' }[change.kind];
  const what = change.kind === 'replaced' && change.fromName && change.fromName !== change.name ? `${change.fromName} with ${change.name}` : change.name;
  const by = change.distance === undefined ? '' : ` by ${formatMeasurement(change.distance, scaleSource)}`;
  return `${label} ${what}${by}`;
}

/** EditRecords kept in a snapshot, oldest first (stored on the scan node, see editHistoryHost). */
export function historyOf(snapshot: Snapshot, read: (nodes: Record<string, unknown>) => EditRecord[] | null): EditRecord[] {
  return [...(read(snapshot.nodes ?? {}) ?? [])].sort((x, y) => x.timestamp.localeCompare(y.timestamp));
}
