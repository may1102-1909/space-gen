import { describe, it, expect } from 'vitest';
import catalogManifest from '@/public/catalog/catalogManifest.json';
import { catalogFromPublicManifest, searchCatalog } from '@/lib/ai/catalog';
import { descriptorsFromHint } from '@/lib/ai/vision';
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

describe('Photo to catalog match', () => {
  it('turns photo descriptors into the closest catalog asset', () => {
    const descriptors = descriptorsFromHint('Scandinavian minimal ash wood chair');
    expect(descriptors.category).toBe('chair');
    expect(descriptors.styleTags).toContain('scandinavian');

    const [best] = searchCatalog(catalogFromPublicManifest(catalogManifest), descriptors);
    expect(best.entry.url).toContain('chair.glb');
    expect(best.entry.styleTags).toContain('scandinavian');
  });
});
