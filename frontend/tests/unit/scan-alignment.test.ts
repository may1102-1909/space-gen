import { describe, expect, it } from 'vitest';
import {
  applyMetricAlignment,
  floorAlignmentFromPoints,
  IDENTITY_SCAN_TO_SCENE,
  multiplyMatrix4,
  transformPoint,
} from '@/lib/pascal/scanAlignment';
import type { Matrix4 } from '@/lib/contracts/primitives';

describe('scan alignment transforms', () => {
  it('levels a floor plane from 3 points and moves it to scene y=0', () => {
    const matrix = floorAlignmentFromPoints([
      [0, 2, 0],
      [1, 2, 0],
      [0, 2, 1],
    ]);
    expect(transformPoint(matrix, [0, 2, 0])[1]).toBeCloseTo(0);
    expect(transformPoint(matrix, [1, 2, 0])[1]).toBeCloseTo(0);
    expect(transformPoint(matrix, [0, 2, 1])[1]).toBeCloseTo(0);
  });

  it('fits a best-fit floor plane for 4+ points and maps floor elevation to y=0', () => {
    const matrix = floorAlignmentFromPoints([
      [0, 2, 0],
      [2, 2, 0],
      [2, 2, 2],
      [0, 2, 2],
    ]);
    expect(transformPoint(matrix, [0, 2, 0])[1]).toBeCloseTo(0);
    expect(transformPoint(matrix, [2, 2, 0])[1]).toBeCloseTo(0);
    expect(transformPoint(matrix, [2, 2, 2])[1]).toBeCloseTo(0);
    expect(transformPoint(matrix, [0, 2, 2])[1]).toBeCloseTo(0);
  });

  it('levels tilted scan floors with accurate normal orientation', () => {
    const matrix = floorAlignmentFromPoints([
      [0, 1, 0],
      [1, 2, 0],
      [0, 2, 1],
      [1, 3, 1],
    ]);
    expect(transformPoint(matrix, [0, 1, 0])[1]).toBeCloseTo(0);
    expect(transformPoint(matrix, [1, 2, 0])[1]).toBeCloseTo(0);
    expect(transformPoint(matrix, [0, 2, 1])[1]).toBeCloseTo(0);
    expect(transformPoint(matrix, [1, 3, 1])[1]).toBeCloseTo(0);
  });

  it('scales a picked reference to its real-world measurement', () => {
    const matrix = applyMetricAlignment(
      IDENTITY_SCAN_TO_SCENE,
      [[0, 0, 0], [2, 0, 0]],
      1,
      0,
    );
    expect(transformPoint(matrix, [2, 0, 0])[0]).toBeCloseTo(1);
  });

  it('rotates about Y to square up a wall vector to the nearest cardinal axis', () => {
    // A wall at ~30 degrees: [0, 0, 0] to [Math.cos(pi/6), 0, Math.sin(pi/6)]
    const wallStart = [0, 0, 0] as [number, number, number];
    const angle = Math.PI / 6; // 30 deg
    const wallEnd = [Math.cos(angle) * 3, 0, Math.sin(angle) * 3] as [number, number, number];

    const currentA = transformPoint(IDENTITY_SCAN_TO_SCENE, wallStart);
    const currentB = transformPoint(IDENTITY_SCAN_TO_SCENE, wallEnd);
    const wallAngle = Math.atan2(currentB[2] - currentA[2], currentB[0] - currentA[0]);
    const target = Math.round(wallAngle / (Math.PI / 2)) * (Math.PI / 2); // 0 radians (X-axis)
    const yaw = target - wallAngle;

    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const rotate: Matrix4 = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
    const squaredMatrix = multiplyMatrix4(rotate, IDENTITY_SCAN_TO_SCENE);

    const alignedA = transformPoint(squaredMatrix, wallStart);
    const alignedB = transformPoint(squaredMatrix, wallEnd);

    // After squaring, wall is parallel to X axis (delta Z = 0)
    expect(alignedB[2] - alignedA[2]).toBeCloseTo(0);
    expect(alignedB[0] - alignedA[0]).toBeCloseTo(3);
  });

  it('rejects too few or collinear floor points', () => {
    expect(() => floorAlignmentFromPoints([[0, 0, 0], [1, 0, 0]])).toThrow(/three/);
    expect(() => floorAlignmentFromPoints([[0, 0, 0], [1, 0, 0], [2, 0, 0]])).toThrow(/collinear/);
    expect(() => floorAlignmentFromPoints([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])).toThrow(/collinear/);
  });
});
