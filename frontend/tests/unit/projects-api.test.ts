import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listProjects, createProject, loadProject, saveProject, type ProjectDocument } from '@/lib/projects/api';

describe('Project API client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const validManifest: ProjectDocument['manifest'] = {
    schemaVersion: '1.0.0',
    id: 'proj_123',
    name: 'Sample Project',
    scan: {
      url: '/scans/room.ply',
      format: 'ply',
      scanToScene: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      scaleSource: 'none',
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    },
    interpretation: {
      provenance: 'auto',
      floor: { normal: [0, 1, 0], constant: 0, provenance: 'auto' },
      ceilingHeight: 2.5,
      outline: [],
      walls: [],
      openings: [],
      detections: [],
    },
    maskRegions: [],
    sceneSnapshot: {},
    assets: [],
    history: [],
    variants: [],
    activeVariantId: 'default',
  };

  const sampleDoc: ProjectDocument = {
    manifest: validManifest,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('lists projects successfully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [sampleDoc],
    });

    const result = await listProjects();
    expect(result).toHaveLength(1);
    expect(result[0].manifest.id).toBe('proj_123');
    expect(result[0].revision).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects'),
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('creates a project with POST', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleDoc,
    });

    const result = await createProject('New Living Room');
    expect(result.manifest.name).toBe('Sample Project');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Living Room' }),
      })
    );
  });

  it('loads a single project by id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleDoc,
    });

    const result = await loadProject('proj_123');
    expect(result.manifest.id).toBe('proj_123');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/proj_123'),
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('saves project with If-Match revision header', async () => {
    const updatedDoc: ProjectDocument = {
      ...sampleDoc,
      revision: 2,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => updatedDoc,
    });

    const result = await saveProject(sampleDoc);
    expect(result.revision).toBe(2);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/proj_123'),
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': '"1"',
        },
        body: JSON.stringify(sampleDoc.manifest),
      })
    );
  });

  it('throws an error on conflict or failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: { message: 'Revision conflict', revision: 2 } }),
    });

    await expect(saveProject(sampleDoc)).rejects.toThrow();
  });
});
