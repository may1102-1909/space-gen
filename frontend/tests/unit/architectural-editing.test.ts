import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { planWallInsertion, runAsSingleSceneHistoryStep, useScene, type AnyNodeId } from '@pascal-app/core';
import { ProjectManifestSchema } from '@/lib/contracts';
import { applyInterpretationToScene, deriveInterpretationFromScene, getInterpretationMeta } from '@/lib/pascal/scanConverter';
import { setWallEndpoints } from '@/lib/pascal/interpretationReview';
import { installArchitecturalSync, planInterpretationStamps } from '@/lib/pascal/architecturalSync';
import { buildSnapTargets, closestOnSegment, planFeaturePoints, snapPlanPoint, wallFaces } from '@/lib/pascal/scanSnapping';
import { formatMeasurement } from '@/lib/measurement/accuracy';
import { redoSceneAction, undoSceneAction } from '@/lib/pascal/sceneBridge';

const manifest = ProjectManifestSchema.parse(
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/realistic_room.json'), 'utf-8')),
);
const nodes = () => useScene.getState().nodes as Record<string, any>;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('scan snapping math', () => {
  const walls: Record<string, any> = {
    w1: { id: 'w1', type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.2 },
    w2: { id: 'w2', type: 'wall', start: [4, 0], end: [4, 3], thickness: 0.2 },
  };

  it('computes both wall faces at ±thickness/2', () => {
    const [a, b] = wallFaces([0, 0], [4, 0], 0.2);
    expect(a.a[1]).toBeCloseTo(0.1);
    expect(b.a[1]).toBeCloseTo(-0.1);
    expect(closestOnSegment([2, 5], [0, 0], [4, 0])).toEqual([2, 0]);
    expect(closestOnSegment([-3, 1], [0, 0], [4, 0])).toEqual([0, 0]);
  });

  it('prefers corners, then wall faces, then scan points, then the floor', () => {
    const targets = buildSnapTargets(walls, [[2, 2]]);
    expect(snapPlanPoint([3.85, 0.15], targets)).toMatchObject({ kind: 'corner', point: [4, 0] });
    const face = snapPlanPoint([2, 0.25], targets);
    expect(face.kind).toBe('wall-face');
    expect(face.point[0]).toBeCloseTo(2);
    expect(face.point[1]).toBeCloseTo(0.1);
    expect(snapPlanPoint([2.1, 1.95], targets)).toMatchObject({ kind: 'scan-point', point: [2, 2] });
    expect(snapPlanPoint([1, 1.5], targets)).toMatchObject({ kind: 'floor', point: [1, 1.5] });
  });

  it('ignores hidden (rejected) walls and finds scan points across bucket borders', () => {
    const targets = buildSnapTargets({ ...walls, w2: { ...walls.w2, visible: false } }, [[0.49, 1.49]]);
    expect(targets.corners).toHaveLength(2);
    expect(snapPlanPoint([0.52, 1.52], targets)).toMatchObject({ kind: 'scan-point' });
  });

  it('downsamples scan proxy vertices to a plan point set within the height band', () => {
    const positions = [0, 0.05, 0, 1, 1, 1, 1.02, 1.5, 1.01, 3, 2.5, 3];
    expect(planFeaturePoints(positions)).toEqual([[1, 1]]);
  });

  it('formats measurements as estimates through one function', () => {
    expect(formatMeasurement(3.14159, 'sensor')).toBe('≈ 3.14 m (±8 cm est.)');
  });
});

describe('interpretation sync for Pascal tool edits', () => {
  let uninstall: () => void;
  beforeEach(() => {
    applyInterpretationToScene(manifest.interpretation, { scan: manifest.scan, maskRegions: manifest.maskRegions });
    (useScene as any).temporal.getState().clear();
    uninstall = installArchitecturalSync();
  });
  afterEach(() => {
    uninstall();
    useScene.getState().clearScene();
    (useScene as any).temporal.getState().clear();
  });

  /** The same commit path as Pascal's wall tool (createWallOnCurrentLevel). */
  function drawWall(start: [number, number], end: [number, number]) {
    runAsSingleSceneHistoryStep(useScene as any, () => {
      const result = planWallInsertion(useScene.getState().nodes, { levelId: 'level_scan' as AnyNodeId, start, end, joinRadius: 0.05 });
      if (!result.ok) throw new Error('wall insertion failed');
      useScene.getState().applyNodeChanges(result.plan.changes);
    });
  }

  it('a drawn wall and a door on it join the interpretation as user edits in one undo step', async () => {
    const initial = new Set(Object.keys(nodes()));
    drawWall([4, 0], [4, 6]);
    await flush();
    const drawn = Object.values(nodes()).filter((n) => n.type === 'wall' && !initial.has(n.id));
    expect(drawn.length).toBeGreaterThan(0);
    for (const w of drawn) expect(getInterpretationMeta(w)).toMatchObject({ kind: 'wall', provenance: 'user', status: 'corrected' });

    // Teeing into north and south splits them; the pieces stay interpreted with unique ids.
    expect(drawn.filter((w) => getInterpretationMeta(w)!.sourceId === 'wall_north')).toHaveLength(1);
    const wall = drawn.find((w) => w.start[0] === 4 && w.end[0] === 4)!;
    expect(getInterpretationMeta(wall)!.sourceId).toBe(wall.id);
    useScene.getState().applyNodeChanges({
      create: [{ node: { id: 'door_tool', type: 'door', wallId: wall.id, position: [1, 1.05, 0], rotation: [0, 0, 0], width: 0.9, height: 2.1 } as any, parentId: wall.id }],
    });
    await flush();
    expect(getInterpretationMeta(nodes().door_tool)).toMatchObject({ kind: 'opening', openingKind: 'door', provenance: 'user' });

    const derived = deriveInterpretationFromScene(nodes())!;
    expect(derived.provenance).toBe('user');
    expect(derived.walls.map((w) => w.id)).toContain(wall.id);
    expect(derived.openings.find((o) => o.id === 'door_tool')).toMatchObject({ wallId: wall.id, offset: 1, kind: 'door' });
    // Interpreted walls keep unique ids even when Pascal splits them on a join.
    const ids = derived.walls.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);

    undoSceneAction();
    expect(nodes().door_tool).toBeUndefined();
    redoSceneAction();
    expect(getInterpretationMeta(nodes().door_tool)?.provenance).toBe('user');
    undoSceneAction();
    undoSceneAction();
    expect(Object.values(nodes()).some((n) => n.id === wall.id)).toBe(false);
    redoSceneAction();
    expect(getInterpretationMeta(nodes()[wall.id])).toMatchObject({ provenance: 'user', status: 'corrected' });
  });

  it('marks interpreted walls corrected when a tool changes their geometry, and leaves T12 edits alone', () => {
    const before = nodes();
    const moved = { ...before, wall_east: { ...before.wall_east, start: [7.8, 0] } };
    expect(planInterpretationStamps(before, moved)).toEqual([
      { id: 'wall_east', data: { metadata: expect.objectContaining({ interpretation: expect.objectContaining({ provenance: 'user', status: 'corrected', sourceId: 'wall_east' }) }) } },
    ]);
    const statusOnly = { ...before, wall_east: { ...before.wall_east, metadata: { interpretation: { ...before.wall_east.metadata.interpretation, status: 'verified' } } } };
    expect(planInterpretationStamps(before, statusOnly)).toEqual([]);

    setWallEndpoints('wall_east', [7.6, 0], [7.6, 6]);
    expect(planInterpretationStamps(before, nodes())).toEqual([]);
  });

  it('does nothing when the scene has no interpretation', () => {
    useScene.getState().clearScene();
    expect(planInterpretationStamps({}, { w: { id: 'w', type: 'wall', start: [0, 0], end: [1, 0] } } as Record<string, any>)).toEqual([]);
  });
});
