import { describe, it, expect } from 'vitest';
import { extractVisualDescriptorsFromPhoto, matchCatalogAsset } from '@/lib/ai/photoTo3DMatcher';
import { isPointInsideVolume } from '@/lib/splat/splatCropManager';

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
