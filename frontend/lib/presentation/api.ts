import { API_BASE } from '@/lib/projects/api';
import { SharedProjectSchema, type SharedProject } from './model';

export class ShareNotFoundError extends Error {
  constructor() {
    super('This link is no longer available.');
    this.name = 'ShareNotFoundError';
  }
}

/** Read-only view of a shared project. 404 means unknown or revoked. */
export async function loadSharedProject(token: string): Promise<SharedProject> {
  const response = await fetch(`${API_BASE}/api/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (response.status === 404) throw new ShareNotFoundError();
  if (!response.ok) throw new Error(`Could not load the presentation (${response.status})`);
  return SharedProjectSchema.parse(await response.json());
}

export interface ShareLink {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

async function failure(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  return new Error(typeof body?.detail === 'string' ? body.detail : `Share request failed (${response.status})`);
}

const sharesUrl = (projectId: string) => `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/shares`;

export async function listShares(projectId: string): Promise<ShareLink[]> {
  const response = await fetch(sharesUrl(projectId), { cache: 'no-store' });
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** The token is only ever returned here; the server keeps just its hash. */
export async function createShare(projectId: string, label: string): Promise<ShareLink & { token: string }> {
  const response = await fetch(sharesUrl(projectId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function revokeShare(projectId: string, shareId: string): Promise<void> {
  const response = await fetch(`${sharesUrl(projectId)}/${encodeURIComponent(shareId)}`, { method: 'DELETE' });
  if (!response.ok) throw await failure(response);
}

export const presentationUrl = (token: string) => `${window.location.origin}/p/${token}`;
