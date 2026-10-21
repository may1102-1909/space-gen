import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useScene } from '@pascal-app/core';
import { ProjectManifestSchema } from '@/lib/contracts';
import { applyInterpretationToScene, deriveInterpretationFromScene, getInterpretationMeta } from '@/lib/pascal/scanConverter';
import {
  addOpening,
  confidenceColor,
  deleteWall,
  getDetections,
  getReviewItems,
  getScanNode,
  getTrustedInterpretation,
  moveOutlineVertex,
  moveWall,
  rejectElement,
  relabelDetection,
  removeOpening,
  resizeOpening,
  splitWall,
  updateDetectionBox,
  verifyElement,
} from '@/lib/pascal/interpretationReview';
import { redoSceneAction, undoSceneAction } from '@/lib/pascal/sceneBridge';

const manifest = ProjectManifestSchema.parse(
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/realistic_room.json'), 'utf-8')),
);
const nodes = () => useScene.getState().nodes as Record<string, any>;
const meta = (id: string) => getInterpretationMeta(nodes()[id])!;
const masks = () => getScanNode(nodes())!.metadata!.maskRegions as any[];

describe('interpretation review and corrections', () => {
  beforeEach(() => {
    applyInterpretationToScene(manifest.interpretation, { scan: manifest.scan, maskRegions: manifest.maskRegions });
    (useScene as any).temporal.getState().clear();
  });
  afterEach(() => {
    useScene.getState().clearScene();
    (useScene as any).temporal.getState().clear();
  });

  it('lists unreviewed, low-confidence items first', () => {
    const items = getReviewItems(nodes());
    expect(items.map((i) => i.key).slice(0, 3)).toEqual(['detection:det_tv_console', 'detection:det_dining_table', 'opening:door_balcony']);
    const firstReviewed = items.findIndex((i) => i.status !== 'auto');
    expect(items.slice(firstReviewed).every((i) => i.status !== 'auto')).toBe(true);
    expect(confidenceColor(0.5)).toBe('#ef4444');
    expect(confidenceColor(0.88)).toBe('#f59e0b');
    expect(confidenceColor(0.95)).toBe('#22c55e');
    expect(confidenceColor(0.5, 'corrected')).toBe('#3b82f6');
  });

  it('moving a wall drags shared corners, marks provenance=user/corrected, and undoes in one step', () => {
    moveWall('wall_east', [-0.4, 0]);
    expect(nodes().wall_east.start).toEqual([7.6, 0]);
    expect(nodes().wall_east.end).toEqual([7.6, 6]);
    expect(nodes().wall_north.end).toEqual([7.6, 0]);
    expect(nodes().wall_south.start).toEqual([7.6, 6]);
    expect(nodes().slab_scan_outline.polygon[1]).toEqual([7.6, 0]);
    expect(nodes().zone_scan_room.polygon[2]).toEqual([7.6, 6]);
    expect(meta('wall_east')).toMatchObject({ provenance: 'user', status: 'corrected' });
    expect(meta('wall_west').status).toBe('auto');

    const derived = deriveInterpretationFromScene(nodes())!;
    expect(derived.provenance).toBe('user');
    expect(derived.walls.find((w) => w.id === 'wall_east')).toMatchObject({ start: [7.6, 0, 0], status: 'corrected', provenance: 'user' });

    undoSceneAction();
    expect(nodes().wall_east.start).toEqual([8, 0]);
    expect(nodes().wall_north.end).toEqual([8, 0]);
    expect(meta('wall_east').status).toBe('auto');
    redoSceneAction();
    expect(nodes().wall_east.start).toEqual([7.6, 0]);
  });

  it('dragging an outline vertex moves the walls meeting there', () => {
    moveOutlineVertex('slab_scan_outline', 2, [8.5, 6.5]);
    expect(nodes().wall_east.end).toEqual([8.5, 6.5]);
    expect(nodes().wall_south.start).toEqual([8.5, 6.5]);
    expect(meta('slab_scan_outline')).toMatchObject({ status: 'corrected', provenance: 'user' });
    expect(deriveInterpretationFromScene(nodes())!.outlineStatus).toBe('corrected');
  });

  it('splits a wall and re-hosts openings beyond the split', () => {
    const newId = splitWall('wall_south', 0.5);
    expect(nodes().wall_south.end).toEqual([4, 6]);
    expect(nodes()[newId].start).toEqual([4, 6]);
    expect(nodes()[newId].end).toEqual([0, 6]);
    // door_main is centred 2 m along the 8 m wall: stays on the first half.
    expect(nodes().door_main.parentId).toBe('wall_south');
    const derived = deriveInterpretationFromScene(nodes())!;
    expect(derived.walls).toHaveLength(5);
    undoSceneAction();
    expect(nodes()[newId]).toBeUndefined();
    expect(nodes().wall_south.end).toEqual([0, 6]);
  });

  it('deletes a wall with its openings', () => {
    deleteWall('wall_east');
    expect(nodes().wall_east).toBeUndefined();
    expect(nodes().door_balcony).toBeUndefined();
    const derived = deriveInterpretationFromScene(nodes())!;
    expect(derived.walls).toHaveLength(3);
    expect(derived.openings.map((o) => o.id)).not.toContain('door_balcony');
  });

  it('adds, resizes and removes openings', () => {
    const id = addOpening('wall_west', 'window');
    expect(nodes().wall_west.children).toContain(id);
    resizeOpening(id, { width: 1.5, offset: 1, sill: 1 });
    const op = deriveInterpretationFromScene(nodes())!.openings.find((o) => o.id === id)!;
    expect(op).toMatchObject({ wallId: 'wall_west', kind: 'window', width: 1.5, offset: 1, sill: 1, provenance: 'user', status: 'corrected' });
    resizeOpening('door_main', { width: 1.1 });
    expect(nodes().door_main.position[0]).toBe(2); // width change keeps the centre
    expect(meta('door_main').status).toBe('corrected');
    resizeOpening('door_main', { width: 1.5, edge: 'end' });
    expect(nodes().door_main.position[0]).toBeCloseTo(2.2); // start edge (1.45) stays put
    removeOpening(id);
    expect(nodes()[id]).toBeUndefined();
  });

  it('moving/resizing/rotating a detection updates its linked MaskRegion', () => {
    updateDetectionBox('det_tv_console', { center: [4, 0.3, 0.6], size: [2.2, 0.6, 0.5], yaw: 0.1 });
    const det = getDetections(nodes()).find((d) => d.id === 'det_tv_console')!;
    expect(det).toMatchObject({ obb: { center: [4, 0.3, 0.6], size: [2.2, 0.6, 0.5], yaw: 0.1 }, status: 'corrected', provenance: 'user' });
    expect(masks().find((m) => m.id === 'mask_tv_console').obb).toEqual(det.obb);
    expect(masks().find((m) => m.id === 'mask_sofa_01').obb.center).toEqual([4, 0.45, 4.5]);
    undoSceneAction();
    expect(masks().find((m) => m.id === 'mask_tv_console').obb.center).toEqual([4, 0.3, 0.4]);
  });

  it('relabels and rejects detections; rejecting disables the mask', () => {
    relabelDetection('det_dining_table', 'Desk', 'desk');
    expect(getDetections(nodes()).find((d) => d.id === 'det_dining_table')).toMatchObject({ label: 'Desk', category: 'desk', status: 'corrected' });
    rejectElement({ kind: 'detection', id: 'det_dining_table' });
    expect(getDetections(nodes()).find((d) => d.id === 'det_dining_table')!.status).toBe('rejected');
    expect(masks().find((m) => m.id === 'mask_dining_table').enabled).toBe(false);
    rejectElement({ kind: 'wall', id: 'wall_west' });
    expect(nodes().wall_west.visible).toBe(false);
  });

  it('getTrustedInterpretation keeps only verified or corrected elements and warns otherwise', () => {
    let trusted = getTrustedInterpretation(nodes());
    expect(trusted.interpretation!.walls).toHaveLength(0);
    expect(trusted.interpretation!.outline).toHaveLength(0);
    expect(trusted.interpretation!.detections.map((d) => d.id)).toEqual(['det_sofa_01', 'det_chair_left', 'det_chair_right', 'det_coffee_table']);
    expect(trusted.warning).toMatch(/10 scan elements are unreviewed/);

    verifyElement({ kind: 'wall', id: 'wall_north' });
    expect(meta('wall_north')).toMatchObject({ status: 'verified', provenance: 'auto' });
    moveWall('wall_east', [-0.2, 0]);
    trusted = getTrustedInterpretation(nodes());
    expect(trusted.interpretation!.walls.map((w) => w.id).sort()).toEqual(['wall_east', 'wall_north', 'wall_south']);
  });
});
