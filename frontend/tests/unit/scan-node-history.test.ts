import { afterEach, describe, expect, it } from 'vitest';
import { applySceneSnapshot, getSceneDocument, useScene } from '@pascal-app/core';
import type { Matrix4 } from '@/lib/contracts/primitives';
import { undoSceneAction } from '@/lib/pascal/sceneBridge';
import { IDENTITY_SCAN_TO_SCENE } from '@/lib/pascal/scanAlignment';
import { replaceScanNode, setScanAlignment, upsertScanNode } from '@/lib/pascal/scanNodes';
import { applyInterpretationToScene, hasInterpretationNodes } from '@/lib/pascal/scanConverter';
import type { RoomInterpretation } from '@/lib/contracts';

const aligned: Matrix4 = [
  0, 0, 1, 0,
  0, 1, 0, 0,
  -1, 0, 0, 0,
  2, 0, 3, 1,
];

describe('Pascal scan alignment history', () => {
  afterEach(() => {
    useScene.getState().clearScene();
    useScene.temporal.getState().clear();
  });

  it('stores the transform in ScanNode metadata and Ctrl+Z undo restores it', () => {
    const scanId = upsertScanNode('/Hurstville_Museum_Gallery.sog', { id: 'scan_alignment_test' });
    useScene.temporal.getState().clear();

    setScanAlignment(scanId, aligned);
    expect((useScene.getState().nodes as Record<string, any>)[scanId].metadata.scanToScene).toEqual(aligned);

    undoSceneAction();
    expect((useScene.getState().nodes as Record<string, any>)[scanId].metadata.scanToScene)
      .toEqual(IDENTITY_SCAN_TO_SCENE);
  });

  it('records a scale calibration as scaleSource=user_measurement, undoable with the transform', () => {
    const scanId = upsertScanNode('/Hurstville_Museum_Gallery.sog', { id: 'scan_scale_test' });
    (useScene as any).temporal.getState().clear();

    setScanAlignment(scanId, aligned, 'user_measurement');
    expect((useScene.getState().nodes as Record<string, any>)[scanId].metadata.scaleSource).toBe('user_measurement');

    undoSceneAction();
    expect((useScene.getState().nodes as Record<string, any>)[scanId].metadata.scaleSource).toBeUndefined();
  });

  it('importing a scan replaces the old scan and its built room in one step; auto-level is a second step', () => {
    const room: RoomInterpretation = {
      provenance: 'auto',
      floor: { normal: [0, 1, 0], constant: 0, provenance: 'auto' },
      ceilingHeight: 2.5,
      outline: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [
        { id: 'w0', start: [0, 0, 0], end: [4, 0, 0], height: 2.5, thickness: 0.15, confidence: 0.9, provenance: 'auto' },
      ],
      openings: [{ id: 'o0', wallId: 'w0', kind: 'door', offset: 1, width: 0.9, height: 2.1, sill: 0, confidence: 0.9, provenance: 'auto' }],
      detections: [],
    };
    upsertScanNode('/old.sog', { id: 'scan_old' });
    applyInterpretationToScene(room);
    useScene.temporal.getState().clear();
    const nodes = () => Object.values(useScene.getState().nodes as Record<string, any>);

    const scanId = replaceScanNode('http://api/assets/new.ply', 'ply');
    setScanAlignment(scanId, aligned);
    expect(nodes().filter((n) => n.type === 'scan').map((n) => n.id)).toEqual([scanId]);
    expect(nodes().filter((n) => ['wall', 'door', 'slab', 'zone'].includes(n.type))).toHaveLength(0);
    expect(hasInterpretationNodes(useScene.getState().nodes as never)).toBe(false);
    expect((useScene.getState().nodes as Record<string, any>)[scanId]).toMatchObject({ url: 'http://api/assets/new.ply', metadata: { format: 'ply', scanToScene: aligned } });

    undoSceneAction();
    expect((useScene.getState().nodes as Record<string, any>)[scanId].metadata.scanToScene).toEqual(IDENTITY_SCAN_TO_SCENE);
    undoSceneAction();
    expect(nodes().filter((n) => n.type === 'scan').map((n) => n.id)).toEqual(['scan_old']);
    expect(nodes().filter((n) => n.type === 'wall')).toHaveLength(1);
  });

  it('an imported scan survives save/reload after the room is built', () => {
    const url = `http://127.0.0.1:8765/api/projects/p1/assets/${'a'.repeat(64)}.ply`;
    const scanId = replaceScanNode(url, 'ply');
    applyInterpretationToScene({
      provenance: 'auto', floor: { normal: [0, 1, 0], constant: 0, provenance: 'auto' }, ceilingHeight: 2.5,
      outline: [[0, 0], [4, 0], [4, 3]], walls: [], openings: [], detections: [],
    });
    applySceneSnapshot(JSON.parse(JSON.stringify(getSceneDocument())), { origin: 'load' } as never);
    const scan = (useScene.getState().nodes as Record<string, any>)[scanId];
    expect(scan).toMatchObject({ type: 'scan', url });
    expect((useScene.getState().nodes as Record<string, any>)[scan.parentId]?.type).toBe('level');
    expect(scan.metadata.detections).toEqual([]);
  });
});
