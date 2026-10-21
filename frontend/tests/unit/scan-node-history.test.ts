import { afterEach, describe, expect, it } from 'vitest';
import { useScene } from '@pascal-app/core';
import type { Matrix4 } from '@/lib/contracts/primitives';
import { undoSceneAction } from '@/lib/pascal/sceneBridge';
import { IDENTITY_SCAN_TO_SCENE } from '@/lib/pascal/scanAlignment';
import { setScanAlignment, upsertScanNode } from '@/lib/pascal/scanNodes';

const aligned: Matrix4 = [
  0, 0, 1, 0,
  0, 1, 0, 0,
  -1, 0, 0, 0,
  2, 0, 3, 1,
];

describe('Pascal scan alignment history', () => {
  afterEach(() => {
    useScene.getState().clearScene();
    (useScene as any).temporal.getState().clear();
  });

  it('stores the transform in ScanNode metadata and Ctrl+Z undo restores it', () => {
    const scanId = upsertScanNode('/Hurstville_Museum_Gallery.sog', { id: 'scan_alignment_test' });
    (useScene as any).temporal.getState().clear();

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
});
