import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listProjects,
  createProject,
  loadProject,
  saveProject,
  uploadProjectAsset,
  uploadedAssetRef,
  ProjectConflictError,
  type ProjectDocument,
} from '@/lib/projects/api';
import { AssetRefSchema } from '@/lib/contracts';

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

  it('surfaces a 409 as ProjectConflictError carrying the server revision', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: { message: 'Project revision conflict; current revision is 5.', revision: 5 } }),
    });

    const error = await saveProject(sampleDoc).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectConflictError);
    expect((error as ProjectConflictError).currentRevision).toBe(5);
    expect((error as Error).message).toBe('Project revision conflict; current revision is 5.');
  });

  it('never reports an object detail as "[object Object]"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: { message: 'Bad manifest' } }) });
    await expect(loadProject('proj_123')).rejects.toThrow('Bad manifest');
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
    await expect(loadProject('proj_123')).rejects.toThrow('Project request failed (500)');
  });

  it('uploads a GLB as multipart and returns an absolute asset URL plus a valid AssetRef', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ filename: `${'a'.repeat(64)}.glb`, size: 3, url: `/api/projects/proj_123/assets/${'a'.repeat(64)}.glb` }),
    });

    const uploaded = await uploadProjectAsset('proj_123', new Blob([new Uint8Array([1, 2, 3])]), 'chair.glb');
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toMatch(/\/api\/projects\/proj_123\/assets$/);
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(uploaded.url).toMatch(/^https?:\/\/.+\/api\/projects\/proj_123\/assets\/a{64}\.glb$/);

    const ref = uploadedAssetRef(uploaded, 'chair', [0.5, 0.8, 0.45]);
    expect(AssetRefSchema.parse(ref)).toEqual(ref);
    expect(ref).toMatchObject({ id: `asset_${'a'.repeat(64)}`, source: 'upload', format: 'glb', url: uploaded.url, dimensions: { width: 0.5, height: 0.8, depth: 0.45 } });
  });

  it('maps a 413 upload rejection to its message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 413, json: async () => ({ detail: 'Asset exceeds the 10-byte upload limit.' }) });
    await expect(uploadProjectAsset('proj_123', new Blob(['x']), 'big.glb')).rejects.toThrow('Asset exceeds the 10-byte upload limit.');
  });
});
