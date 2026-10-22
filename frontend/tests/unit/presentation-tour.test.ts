import { describe, expect, it } from 'vitest';
import { jumpTo, lerpPose, stepTour, togglePlay } from '@/lib/presentation/tour';
import { catalogProductLinks, listItems, resolveVariants, safeWebUrl, type SharedProject } from '@/lib/presentation/model';

describe('tour stepping', () => {
  it('advances and wraps in both directions', () => {
    let s = { index: 0, playing: false };
    s = stepTour(s, 3, 1);
    expect(s.index).toBe(1);
    s = stepTour(stepTour(s, 3, 1), 3, 1);
    expect(s.index).toBe(0);
    expect(stepTour(s, 3, -1).index).toBe(2);
  });
  it('keeps playing state while stepping and survives an empty tour', () => {
    expect(stepTour({ index: 0, playing: true }, 2, 1)).toEqual({ index: 1, playing: true });
    expect(stepTour({ index: 4, playing: false }, 0, 1).index).toBe(0);
  });
  it('clamps jumps and refuses to auto-play a single stop', () => {
    expect(jumpTo({ index: 0, playing: false }, 3, 9).index).toBe(2);
    expect(jumpTo({ index: 0, playing: false }, 3, -2).index).toBe(0);
    expect(togglePlay({ index: 0, playing: false }, 1).playing).toBe(false);
    expect(togglePlay({ index: 0, playing: false }, 2).playing).toBe(true);
    expect(togglePlay({ index: 0, playing: true }, 2).playing).toBe(false);
  });
  it('interpolates poses with eased endpoints', () => {
    const a = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const b = { position: [10, 2, -4] as [number, number, number], target: [1, 1, 1] as [number, number, number] };
    expect(lerpPose(a, b, 0)).toEqual(a);
    expect(lerpPose(a, b, 1)).toEqual(b);
    expect(lerpPose(a, b, 0.5).position).toEqual([5, 1, -2]);
    expect(lerpPose(a, b, 2)).toEqual(b);
  });
});

const snap = (name: string) => ({ nodes: { [`item_${name}`]: { id: `item_${name}`, type: 'item', name, asset: { src: `https://x/${name}.glb`, name, dimensions: [1, 2, 3] } } } });
const shared = (over: Partial<SharedProject>): SharedProject => ({
  name: 'R', updatedAt: '', scan: { url: '', format: 'ply', scanToScene: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], scaleSource: 'none', bounds: { min: [0, 0, 0], max: [0, 0, 0] } },
  sceneSnapshot: snap('live'), activeVariantId: 'a', variants: [], viewpoints: [], heroImages: [], assets: [], ...over,
});

describe('variants and items', () => {
  it('falls back to the single scene when there are no variants', () => {
    const v = resolveVariants(shared({}));
    expect(v).toHaveLength(1);
    expect(v[0].sceneSnapshot).toEqual(snap('live'));
  });
  it('uses the live scene for the active variant, own snapshot for others, drops empty ones', () => {
    const v = resolveVariants(shared({ variants: [
      { id: 'a', name: 'A', sceneSnapshot: {} },
      { id: 'b', name: 'B', sceneSnapshot: snap('other') },
      { id: 'c', name: 'C', sceneSnapshot: {} },
    ] }));
    expect(v.map((x) => x.id)).toEqual(['a', 'b']);
    expect(v[0].sceneSnapshot).toEqual(snap('live'));
    expect(v[1].sceneSnapshot).toEqual(snap('other'));
  });
  it('lists items with a product link from metadata, asset ref or catalog, http(s) only', () => {
    const snapshot = { nodes: {
      i1: { id: 'i1', type: 'item', name: 'Chair', metadata: { productUrl: 'https://shop/chair' }, asset: { src: 'https://x/c.glb', dimensions: [0.5, 0.9, 0.5] } },
      i2: { id: 'i2', type: 'item', name: 'Sofa', asset: { src: 'https://x/s.glb', dimensions: [2, 1, 1] } },
      i3: { id: 'i3', type: 'item', name: 'Bad', metadata: { productUrl: 'javascript:alert(1)' }, asset: { src: 'https://x/b.glb', dimensions: [1, 1, 1] } },
      i4: { id: 'i4', type: 'item', name: 'Lamp', asset: { src: 'http://api/samples/models/lamp.glb', dimensions: [1, 1, 1] } },
      w: { id: 'w', type: 'wall' },
    } };
    const assets = [{ id: 'a', name: 'Sofa', url: 'https://x/s.glb', dimensions: { width: 2, height: 1, depth: 1 }, categories: [], productUrl: 'https://shop/sofa' }];
    const catalog = catalogProductLinks({ assets: [{ modelUrl: '/samples/models/lamp.glb', productUrl: 'https://shop/lamp' }, { modelUrl: '/x.glb' }] });
    const items = listItems(snapshot, assets, catalog);
    expect(items.map((i) => [i.name, i.productUrl])).toEqual([['Chair', 'https://shop/chair'], ['Sofa', 'https://shop/sofa'], ['Bad', null], ['Lamp', 'https://shop/lamp']]);
    expect(safeWebUrl('ftp://x')).toBeNull();
  });
});
