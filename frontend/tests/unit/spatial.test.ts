import { describe, it, expect } from 'vitest';
import { checkCollision, findNearestValidPosition, solveSmartPlacements } from '@/lib/ai/spatialLayoutSolver';
import { extractVisualDescriptorsFromPhoto, matchCatalogAsset } from '@/lib/ai/photoTo3DMatcher';
import { isPointInsideVolume } from '@/lib/splat/splatCropManager';
import { EditableSceneSummary } from '@/lib/pascal/sceneBridge';

describe('Spatial Layout Solver', () => {
  const mockScene: EditableSceneSummary = {
    siteId: 'site_1',
    buildingId: 'building_1',
    activeLevelId: 'level_1',
    levels: [{ id: 'level_1', name: 'Main', elevation: 0, height: 3 }],
    zones: [{ id: 'zone_1', name: 'Living Room', levelId: 'level_1' }],
    walls: [
      {
        id: 'wall_north',
        name: 'North Wall',
        start: [-4, -3],
        end: [4, -3],
        height: 3,
        thickness: 0.2,
        levelId: 'level_1',
      },
    ],
    items: [
      {
        id: 'table_1',
        name: 'Dining Table',
        category: 'dining_table',
        position: [0, 0, 0],
        dimensions: [1.8, 0.75, 0.9],
        levelId: 'level_1',
      },
    ],
    scans: [],
  };

  it('detects collisions against walls and existing furniture items', () => {
    // Overlapping dining table
    const tableCollision = checkCollision([0, 0, 0], [0.5, 0.8, 0.5], mockScene);
    expect(tableCollision.collides).toBe(true);
    expect(tableCollision.reason).toContain('Dining Table');

    // Clipping north wall at z = -3.0
    const wallCollision = checkCollision([0, 0, -2.9], [0.5, 0.8, 0.5], mockScene);
    expect(wallCollision.collides).toBe(true);
    expect(wallCollision.reason).toContain('North Wall');

    // Open floor spot
    const clearSpot = checkCollision([2, 0, 1], [0.5, 0.8, 0.5], mockScene);
    expect(clearSpot.collides).toBe(false);
  });

  it('finds nearest valid collision-free spot via spiral search', () => {
    const collidingStart: [number, number, number] = [0, 0, 0];
    const resolved = findNearestValidPosition(collidingStart, [0.5, 0.8, 0.5], mockScene);
    const checkResolved = checkCollision(resolved, [0.5, 0.8, 0.5], mockScene);
    expect(checkResolved.collides).toBe(false);
  });

  it('solves symmetrical dining chair layout around dining table', () => {
    const candidates = solveSmartPlacements(
      '/samples/models/chair.glb',
      'Dining Chair',
      'chair',
      [0.55, 0.85, 0.55],
      'place 2 chairs around the dining table',
      mockScene
    );

    expect(candidates.length).toBe(2);
    expect(candidates[0].name).toContain('Dining Chair North');
    expect(candidates[1].name).toContain('Dining Chair South');
    expect(candidates[0].rotation[1]).toBe(0);
    expect(candidates[1].rotation[1]).toBeCloseTo(Math.PI);
  });
});

describe('Splat Crop Manager', () => {
  it('correctly determines whether a 3D point is inside an exclusion volume', () => {
    const box = {
      id: 'box_1',
      type: 'box' as const,
      center: [1, 0, 1] as [number, number, number],
      size: [2, 2, 2] as [number, number, number],
      mode: 'exclude' as const,
    };

    // Point inside box: [1, 0, 1] is the center
    expect(isPointInsideVolume([1, 0, 1], box)).toBe(true);
    expect(isPointInsideVolume([1.5, 0.5, 1.5], box)).toBe(true);

    // Point outside box
    expect(isPointInsideVolume([3, 0, 1], box)).toBe(false);
    expect(isPointInsideVolume([1, 5, 1], box)).toBe(false);
  });
});

describe('Photo to 3D Matcher', () => {
  it('extracts descriptors and matches closest catalog asset', async () => {
    const descriptors = await extractVisualDescriptorsFromPhoto(
      'data:image/png;base64,mock',
      'Scandinavian minimal ash wood chair'
    );

    expect(descriptors.category).toBe('chair');
    expect(descriptors.styleTags).toContain('scandinavian');

    const matched = matchCatalogAsset(descriptors);
    expect(matched.modelUrl).toContain('chair.glb');
    expect(matched.confidence).toBeGreaterThan(0.9);
  });
});
