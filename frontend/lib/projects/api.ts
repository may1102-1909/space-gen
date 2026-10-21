import { ProjectManifestSchema, type AssetRef, type ProjectManifest } from '@/lib/contracts';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface ProjectDocument {
  manifest: ProjectManifest;
  revision: number;
  updatedAt: string;
}

/** The server holds a newer revision than the one this save was based on (HTTP 409). */
export class ProjectConflictError extends Error {
  constructor(readonly currentRevision: number, message = `Project was changed elsewhere (server revision ${currentRevision}).`) {
    super(message);
    this.name = 'ProjectConflictError';
  }
}

async function errorFor(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  const detail = body?.detail;
  if (response.status === 409 && typeof detail?.revision === 'number') {
    return new ProjectConflictError(detail.revision, typeof detail.message === 'string' ? detail.message : undefined);
  }
  if (typeof detail === 'string') return new Error(detail);
  if (typeof detail?.message === 'string') return new Error(detail.message);
  return new Error(`Project request failed (${response.status})`);
}

async function parseResponse(response: Response): Promise<ProjectDocument> {
  if (!response.ok) throw await errorFor(response);
  const body = await response.json();
  return { ...body, manifest: ProjectManifestSchema.parse(body.manifest) };
}

export async function listProjects(): Promise<ProjectDocument[]> {
  const response = await fetch(`${API_BASE}/api/projects`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load projects');
  return (await response.json()).map((item: unknown) => {
    const parsed = item as ProjectDocument;
    return { ...parsed, manifest: ProjectManifestSchema.parse(parsed.manifest) };
  });
}

export async function createProject(name: string): Promise<ProjectDocument> {
  return parseResponse(await fetch(`${API_BASE}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }));
}

export async function loadProject(id: string): Promise<ProjectDocument> {
  return parseResponse(await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}`, { cache: 'no-store' }));
}

export async function saveProject(document: ProjectDocument): Promise<ProjectDocument> {
  return parseResponse(await fetch(`${API_BASE}/api/projects/${encodeURIComponent(document.manifest.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': `"${document.revision}"` }, body: JSON.stringify(document.manifest),
  }));
}

export interface UploadedAsset {
  /** Absolute URL usable as a Pascal item.asset.src (Pascal sends app-relative paths to its CDN). */
  url: string;
  filename: string;
  size: number;
}

/** Stores a GLB in the project's content-addressed asset store (POST /api/projects/{id}/assets). */
export async function uploadProjectAsset(projectId: string, file: Blob, filename: string): Promise<UploadedAsset> {
  const form = new FormData();
  form.append('file', file, filename);
  const response = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/assets`, { method: 'POST', body: form });
  if (!response.ok) throw await errorFor(response);
  const body = (await response.json()) as { url: string; filename: string; size: number };
  return { url: new URL(body.url, API_BASE).href, filename: body.filename, size: body.size };
}

/** Manifest AssetRef for an uploaded GLB with its measured, meter-space dimensions. */
export function uploadedAssetRef(asset: UploadedAsset, name: string, dimensions: [number, number, number]): AssetRef {
  return {
    id: `asset_${asset.filename.replace(/\.[^.]+$/, '')}`,
    name,
    source: 'upload',
    url: asset.url,
    format: 'glb',
    dimensions: { width: dimensions[0], height: dimensions[1], depth: dimensions[2] },
    categories: ['custom'],
    thumbnail: null,
  };
}
