'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, X } from 'lucide-react';
import type { Viewpoint } from '@/lib/contracts';
import { createShare, listShares, presentationUrl, revokeShare, type ShareLink } from '@/lib/presentation/api';
import { readCamera } from '@/lib/presentation/cameraReader';

interface ShareDialogProps {
  projectId: string;
  viewpoints: Viewpoint[];
  onClose: () => void;
  onAddViewpoint: (viewpoint: Viewpoint) => void;
  onRemoveViewpoint: (id: string) => void;
}

/** Designer side of sharing: manage read-only client links and the saved viewpoints of the guided tour. */
export function ShareDialog({ projectId, viewpoints, onClose, onAddViewpoint, onRemoveViewpoint }: ShareDialogProps) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [fresh, setFresh] = useState<Record<string, string>>({}); // share id -> url, only for links created in this dialog
  const [label, setLabel] = useState('');
  const [viewName, setViewName] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const refresh = useCallback(() => listShares(projectId).then(setLinks).catch((e: Error) => setError(e.message)), [projectId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (work: () => Promise<void>) => {
    setError('');
    try { await work(); } catch (e) { setError((e as Error).message); }
  };

  const create = () => run(async () => {
    const link = await createShare(projectId, label.trim());
    setFresh((f) => ({ ...f, [link.id]: presentationUrl(link.token) }));
    setLabel('');
    await refresh();
  });

  const copy = (id: string, url: string) => run(async () => {
    await navigator.clipboard.writeText(url);
    setCopied(id);
  });

  const revoke = (id: string) => run(async () => {
    await revokeShare(projectId, id);
    setFresh((f) => { const { [id]: _gone, ...rest } = f; return rest; });
    await refresh();
  });

  const addViewpoint = () => {
    const camera = readCamera();
    if (!camera) { setError('The 3D view is not ready yet.'); return; }
    onAddViewpoint({ id: `vp_${Date.now().toString(36)}`, name: viewName.trim() || `Viewpoint ${viewpoints.length + 1}`, position: camera.position, target: camera.target, fov: camera.fov });
    setViewName('');
  };

  return (
    <div role="dialog" aria-label="Share" aria-modal="true" className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20">
      <div className="max-h-[80vh] w-[560px] overflow-y-auto rounded-lg border border-border bg-surface p-5 text-sm shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Share with your client</h2>
          <button aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        {error && <p role="alert" className="mb-3 text-red-500">{error}</p>}

        <section aria-label="Share links" className="mb-6">
          <p className="mb-2 text-text-muted">Anyone with a link can view this design (read-only). A link is shown once, when created; revoke it any time.</p>
          <div className="mb-3 flex gap-2">
            <input aria-label="Link label" placeholder="Label (optional)" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-1.5" />
            <button onClick={() => void create()} className="rounded bg-accent px-3 py-1.5 text-white">Create link</button>
          </div>
          <ul className="flex flex-col gap-2">
            {links.map((link) => (
              <li key={link.id} data-testid="share-link" className="rounded border border-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span>{link.label || 'Untitled link'} <span className="text-xs text-text-muted">{new Date(link.createdAt).toLocaleString()}</span></span>
                  {link.revokedAt ? <span className="text-xs text-text-muted">Revoked</span> : <button onClick={() => void revoke(link.id)} className="rounded border border-border px-2 py-1 text-xs">Revoke</button>}
                </div>
                {!link.revokedAt && fresh[link.id] && (
                  <div className="mt-2 flex gap-2">
                    <input readOnly aria-label="Presentation link" value={fresh[link.id]} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs" />
                    <button onClick={() => void copy(link.id, fresh[link.id])} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"><Copy size={12} />{copied === link.id ? 'Copied' : 'Copy'}</button>
                    <a href={fresh[link.id]} target="_blank" rel="noopener noreferrer" className="rounded border border-border px-2 py-1 text-xs">Open</a>
                  </div>
                )}
              </li>
            ))}
            {links.length === 0 && <li className="text-text-muted">No links yet.</li>}
          </ul>
        </section>

        <section aria-label="Tour viewpoints">
          <h3 className="mb-2 font-medium">Tour viewpoints</h3>
          <p className="mb-2 text-text-muted">Orbit to a good angle, then save it. Clients step through these in order.</p>
          <div className="mb-3 flex gap-2">
            <input aria-label="Viewpoint name" placeholder={`Viewpoint ${viewpoints.length + 1}`} value={viewName} maxLength={80} onChange={(e) => setViewName(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-1.5" />
            <button onClick={addViewpoint} className="rounded border border-accent px-3 py-1.5 text-accent">Save current view</button>
          </div>
          <ol className="flex flex-col gap-1">
            {viewpoints.map((v) => (
              <li key={v.id} className="flex items-center justify-between rounded border border-border px-2 py-1">
                <span>{v.name}</span>
                <button aria-label={`Remove viewpoint ${v.name}`} onClick={() => onRemoveViewpoint(v.id)}><X size={14} /></button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
