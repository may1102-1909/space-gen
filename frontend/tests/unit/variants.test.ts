import { describe, expect, it } from 'vitest';
import type { EditRecord } from '@/lib/contracts';
import { readEditHistory } from '@/lib/pascal/sceneBridge';
import {
  activeVariant, createVariant, deleteVariant, describeChange, diffItems, duplicateVariant,
  historyOf, normalizeVariants, renameVariant, switchVariant, type Snapshot, type VariantSet,
} from '@/lib/variants/variants';

const record: EditRecord = { id: 'e1', timestamp: '2026-01-01T00:00:00Z', op: 'add', description: 'Added chair' };
const item = (id: string, x: number, assetId = 'a1', extra: object = {}) => ({
  type: 'item', id, name: id, position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], children: [],
  asset: { id: assetId, src: `/${assetId}.glb`, dimensions: [1, 1, 1] }, ...extra,
});
const scene = (items: object[] = [item('item_1', 0), item('item_2', 2)]): Snapshot => ({
  nodes: {
    scan_1: { type: 'scan', id: 'scan_1', metadata: { editHistory: [record], maskRegions: [{ id: 'm' }] } },
    level_1: { type: 'level', id: 'level_1', children: items.map((i: any) => i.id) },
    ...Object.fromEntries(items.map((i: any) => [i.id, i])),
  },
  rootNodeIds: ['scan_1', 'level_1', ...items.map((i: any) => i.id)],
});
const start: VariantSet = { variants: [{ id: 'a', name: 'A', sceneSnapshot: {}, createdAt: 't' }], activeVariantId: 'a' };

describe('variant CRUD and switching', () => {
  it('normalizes an empty list and commits the live scene into the active variant', () => {
    const s = normalizeVariants({ variants: [], activeVariantId: 'default' }, scene());
    expect(s.variants.map((v) => v.id)).toEqual(['default']);
    expect(Object.keys(activeVariant(s).sceneSnapshot.nodes)).toContain('item_1');
  });

  it('creates from current: copies the scene, records the parent, activates the new variant', () => {
    const s = createVariant(start, scene(), { name: 'B', from: 'current', id: 'b' });
    expect(s.activeVariantId).toBe('b');
    expect(s.variants).toHaveLength(2);
    expect(activeVariant(s).parentVariantId).toBe('a');
    expect(diffItems(s.variants[0].sceneSnapshot, s.variants[1].sceneSnapshot)).toEqual([]);
    // Independent copies: editing one never touches the other.
    s.variants[1].sceneSnapshot.nodes.item_1.position = [9, 0, 0];
    expect(s.variants[0].sceneSnapshot.nodes.item_1.position).toEqual([0, 0, 0]);
  });

  it('creates blank: shell only, no items, links, masks or history', () => {
    const s = createVariant(start, scene(), { name: 'Shell', from: 'blank', id: 'b' });
    const blank = activeVariant(s).sceneSnapshot;
    expect(Object.values(blank.nodes).filter((n: any) => n.type === 'item')).toHaveLength(0);
    expect(blank.nodes.level_1.children).toEqual([]);
    expect(blank.rootNodeIds).toEqual(['scan_1', 'level_1']);
    expect(blank.nodes.scan_1.metadata).toEqual({ maskRegions: [] });
    expect(historyOf(blank, readEditHistory)).toEqual([]);
    // The source variant keeps its items and history.
    expect(readEditHistory(s.variants[0].sceneSnapshot.nodes)).toEqual([record]);
    expect(Object.keys(s.variants[0].sceneSnapshot.nodes)).toContain('item_1');
  });

  it('duplicates any variant and switches without losing unsaved live edits', () => {
    let s = createVariant(start, scene(), { name: 'B', from: 'current', id: 'b' });
    s = duplicateVariant(s, scene([item('item_1', 5)]), 'a', { newId: 'c' });
    expect(s.variants.map((v) => v.name)).toEqual(['A', 'B', 'A copy']);
    expect(s.activeVariantId).toBe('c');
    // The live scene belonged to the active variant ('b' at duplication time), not to 'a'.
    expect(s.variants[1].sceneSnapshot.nodes.item_1.position).toEqual([5, 0, 0]);
    expect(s.variants[0].sceneSnapshot.nodes.item_1.position).toEqual([0, 0, 0]);
    expect(s.variants[2].sceneSnapshot.nodes.item_1.position).toEqual([0, 0, 0]);
    const back = switchVariant(s, scene([item('item_1', 7)]), 'a');
    expect(back.activeVariantId).toBe('a');
    expect(() => switchVariant(back, {}, 'nope')).toThrow();
  });

  it('renames (rejecting blanks) and deletes, never the last variant', () => {
    let s = createVariant(start, scene(), { name: 'B', from: 'current', id: 'b' });
    expect(renameVariant(s, scene(), 'b', '  Warm  ').variants[1].name).toBe('Warm');
    expect(() => renameVariant(s, scene(), 'b', '  ')).toThrow();
    s = deleteVariant(s, scene(), 'b');
    expect(s.variants.map((v) => v.id)).toEqual(['a']);
    expect(s.activeVariantId).toBe('a');
    expect(() => deleteVariant(s, scene(), 'a')).toThrow(/last variant/);
  });
});

describe('diffItems', () => {
  it('reports added, removed, moved (with distance) and replaced items', () => {
    const a = scene([item('item_1', 0), item('item_2', 2), item('item_3', 4)]);
    const b = scene([item('item_1', 1.5), item('item_3', 4, 'a2'), item('item_4', 0)]);
    const changes = diffItems(a, b);
    const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
    expect(byId.item_1).toMatchObject({ kind: 'moved' });
    expect(byId.item_1.distance).toBeCloseTo(1.5);
    expect(byId.item_2).toMatchObject({ kind: 'removed' });
    expect(byId.item_3).toMatchObject({ kind: 'replaced', distance: undefined });
    expect(byId.item_4).toMatchObject({ kind: 'added' });
    expect(changes).toHaveLength(4);
  });

  it('ignores sub-centimeter noise and proposal ghosts; identical scenes have no diff', () => {
    expect(diffItems(scene(), scene())).toEqual([]);
    expect(diffItems(scene([item('item_1', 0)]), scene([item('item_1', 0.005)]))).toEqual([]);
    expect(diffItems(scene([]), scene([item('ghost', 0, 'a1', { metadata: { proposalPreview: 'p1' } })]))).toEqual([]);
  });

  it('formats distances with the scan-scale error bound', () => {
    const [moved] = diffItems(scene([item('item_1', 0)]), scene([item('item_1', 1.5)]));
    expect(describeChange(moved, 'none')).toMatch(/^Moved item_1 by ≈ 1\.5.* m \(±\d+ cm est\.\)$/);
  });
});
