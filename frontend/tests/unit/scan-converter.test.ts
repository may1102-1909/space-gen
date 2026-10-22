import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useScene } from '@pascal-app/core';
import { ProjectManifestSchema, RoomInterpretationSchema } from '@/lib/contracts';
import {
  applyInterpretationToScene,
  convertScanToEditableNodes,
  deriveInterpretationFromScene,
  getInterpretationMeta,
  planInterpretationNodes,
  SAMPLE_ROOM_SCAN_MANIFEST,
} from '@/lib/pascal/scanConverter';
import { undoSceneAction } from '@/lib/pascal/sceneBridge';

const manifest = ProjectManifestSchema.parse(
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/realistic_room.json'), 'utf-8')),
);
const nodes = () => useScene.getState().nodes as Record<string, any>;

function convertFixture() {
  return applyInterpretationToScene(manifest.interpretation, { scan: manifest.scan, maskRegions: manifest.maskRegions });
}

describe('scanConverter: RoomInterpretation -> Pascal nodes', () => {
  afterEach(() => {
    useScene.getState().clearScene();
    (useScene as any).temporal.getState().clear();
  });

  it('plans slab, zone, walls, openings and a scan node from the fixture', () => {
    const plan = planInterpretationNodes(manifest.interpretation, {}, { scan: manifest.scan, maskRegions: manifest.maskRegions });
    const byType = (type: string) => plan.creates.filter((c) => (c.node as any).type === type);
    expect(byType('slab')).toHaveLength(1);
    expect(byType('zone')).toHaveLength(1);
    expect(byType('wall')).toHaveLength(4);
    expect(byType('door')).toHaveLength(2);
    expect(byType('window')).toHaveLength(1);
    expect(byType('scan')).toHaveLength(1);
    expect(byType('level')).toHaveLength(1);

    const east = byType('wall').find((c) => (c.node as any).id === 'wall_east')!.node as any;
    expect(east.start).toEqual([8, 0]);
    expect(east.end).toEqual([8, 6]);
    expect(getInterpretationMeta(east)).toMatchObject({ kind: 'wall', sourceId: 'wall_east', confidence: 0.95, status: 'auto', provenance: 'auto' });

    const balcony = byType('door').find((c) => (c.node as any).id === 'door_balcony')!;
    expect(balcony.parentId).toBe('wall_east');
    // offset is the opening centre along the wall
    expect((balcony.node as any).position).toEqual([1.5, 1.1, 0]);
    const window = byType('window')[0].node as any;
    expect(window.position[0]).toBeCloseTo(3);
    expect(window.position[1]).toBeCloseTo(1.6);

    const scan = byType('scan')[0].node as any;
    expect(scan.metadata.detections).toHaveLength(6);
    expect(scan.metadata.maskRegions).toHaveLength(6);
    expect(scan.metadata.scanToScene).toEqual(manifest.scan.scanToScene);
  });

  it('applies as one undo step and round-trips back to the same interpretation', () => {
    const before = Object.keys(nodes()).sort();
    convertFixture();
    expect(Object.values(nodes()).filter((n) => n.type === 'wall')).toHaveLength(4);
    expect(nodes().wall_south.children).toContain('door_main');

    const derived = deriveInterpretationFromScene(nodes())!;
    expect(RoomInterpretationSchema.safeParse(derived).success).toBe(true);
    const original = manifest.interpretation;
    expect(derived.outline).toEqual(original.outline);
    expect(derived.outlineStatus).toBe('auto');
    expect(derived.provenance).toBe('auto');
    expect(derived.walls.map(({ status, ...w }) => w)).toEqual(expect.arrayContaining(original.walls));
    expect(derived.walls.every((w) => w.status === 'auto')).toBe(true);
    for (const op of original.openings) {
      expect(derived.openings.find((o) => o.id === op.id)).toMatchObject({ ...op, status: 'auto' });
    }
    expect(derived.detections).toEqual(original.detections);

    undoSceneAction();
    expect(Object.keys(nodes()).sort()).toEqual(before);
  });

  it('annotates an existing scan node instead of creating a second one', () => {
    useScene.getState().applyNodeChanges({
      create: [{ node: { id: 'scan_existing', type: 'scan', url: '/a.sog', metadata: { maskRegions: [] } } as any }],
    });
    convertFixture();
    const scans = Object.values(nodes()).filter((n) => n.type === 'scan');
    expect(scans).toHaveLength(1);
    expect(scans[0].metadata.detections).toHaveLength(6);
    expect(scans[0].metadata.maskRegions).toHaveLength(6);
  });

  it('refuses to convert twice', () => {
    convertFixture();
    expect(() => convertFixture()).toThrow(/already/);
  });

  it('keeps the legacy demo manifest working through the same path', () => {
    const result = convertScanToEditableNodes(SAMPLE_ROOM_SCAN_MANIFEST);
    expect(result.wallCount).toBe(4);
    expect(result.exclusionBoxCount).toBe(5);
    const derived = deriveInterpretationFromScene(nodes())!;
    expect(derived.openings).toHaveLength(2);
    expect(derived.detections[0].maskRegionId).toBe('mask_detected_sofa_1');
  });
});
