import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';

describe('api.getFurnitureCatalog', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('keeps frontend-hosted models on the page origin and prefixes backend models with the API base', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'sample', url: '/samples/models/chair.glb' },
        { id: 'backend', url: '/api/reconstruction/furniture-catalog/sofa.glb' },
        { id: 'absolute', url: 'https://cdn.example.com/table.glb' },
      ],
    });

    const [sample, backend, absolute] = await api.getFurnitureCatalog();
    expect(sample.url).toBe(`${window.location.origin}/samples/models/chair.glb`);
    expect(backend.url).toMatch(/^https?:\/\/[^/]+\/api\/reconstruction\/furniture-catalog\/sofa\.glb$/);
    expect(backend.url.startsWith(window.location.origin)).toBe(false);
    expect(absolute.url).toBe('https://cdn.example.com/table.glb');
  });
});
