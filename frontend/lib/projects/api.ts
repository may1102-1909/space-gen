import { ProjectManifestSchema, type ProjectManifest } from '@/lib/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface ProjectDocument {
  manifest: ProjectManifest;
  revision: number;
  updatedAt: string;
}

async function parseResponse(response: Response): Promise<ProjectDocument> {
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail ?? `Project request failed (${response.status})`);
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
