'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createProject, listProjects, type ProjectDocument } from '@/lib/projects/api';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectDocument[]>([]);
  const [name, setName] = useState('My room');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => listProjects().then(setProjects).catch((e: Error) => setError(e.message));
  useEffect(() => { void refresh(); }, []);
  async function create() {
    setBusy(true); setError('');
    try { const doc = await createProject(name.trim()); window.location.assign(`/editor/${doc.manifest.id}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <main className="min-h-screen bg-background text-foreground p-8">
    <div className="mx-auto max-w-4xl">
      <header className="mb-8 flex items-end justify-between"><div><p className="text-sm text-text-muted">SpaceGen</p><h1 className="text-3xl font-semibold">Your spaces</h1></div></header>
      <section className="mb-8 rounded-xl border border-border bg-surface p-5"><h2 className="mb-3 font-medium">Start a project</h2><div className="flex gap-3"><input aria-label="Project name" className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2" value={name} onChange={e => setName(e.target.value)} /><button className="rounded bg-accent px-4 py-2 text-white disabled:opacity-50" disabled={busy || !name.trim()} onClick={() => void create()}>{busy ? 'Creating…' : 'New project'}</button></div></section>
      {error && <p role="alert" className="mb-4 text-red-500">{error}</p>}
      <h2 className="mb-3 font-medium">Recent projects</h2>
      <div className="grid gap-3">{projects.map(p => <Link key={p.manifest.id} href={`/editor/${p.manifest.id}`} className="rounded-xl border border-border bg-surface p-4 hover:border-accent"><span className="font-medium">{p.manifest.name}</span><span className="ml-3 text-sm text-text-muted">Saved {new Date(p.updatedAt).toLocaleString()}</span></Link>)}{projects.length === 0 && <p className="text-sm text-text-muted">No projects yet.</p>}</div>
    </div>
  </main>;
}
