'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { applySceneSnapshot, clearSceneHistory, getSceneDocument, useScene, type AnyNode, type AnyNodeId } from '@pascal-app/core';
import { ScenePanel } from '@/components/panels/ScenePanel';
import { ChatPanel } from '@/components/panels/ChatPanel';
import { InterpretationReviewPanel } from '@/components/panels/InterpretationReviewPanel';
import { EditorLayout } from '@/components/layout/EditorLayout';
import { useSpaceGenStore } from '@/lib/store';
import type { AssetRef, MaskRegion } from '@/lib/contracts';
import { loadProject, ProjectConflictError, saveProject, type ProjectDocument } from '@/lib/projects/api';
import { deriveInterpretationFromScene } from '@/lib/pascal/scanConverter';

const SceneViewer = dynamic(() => import('@/components/viewer/SceneViewer'), { ssr: false });

type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

interface ScanNodeLike {
  id: string;
  type: 'scan';
  metadata?: { maskRegions?: MaskRegion[] } & Record<string, unknown>;
}

function findScanNode(): ScanNodeLike | undefined {
  return Object.values(useScene.getState().nodes).find((node) => node?.type === 'scan') as ScanNodeLike | undefined;
}

/** Replace the Pascal scene with a saved project document. */
function applyProjectDocument(doc: ProjectDocument) {
  if (doc.manifest.sceneSnapshot && Object.keys(doc.manifest.sceneSnapshot).length) {
    applySceneSnapshot(doc.manifest.sceneSnapshot as Parameters<typeof applySceneSnapshot>[0], { origin: 'load' });
  } else {
    useScene.getState().clearScene();
  }
  const scanNode = findScanNode();
  if (scanNode && doc.manifest.maskRegions.length > 0 && !scanNode.metadata?.maskRegions?.length) {
    useScene.getState().updateNode(scanNode.id as AnyNodeId, {
      metadata: { ...scanNode.metadata, maskRegions: doc.manifest.maskRegions },
    } as Partial<AnyNode>);
  }
  // The loaded state is the undo baseline; the mask patch above must not be an undoable step.
  clearSceneHistory();
}

export default function ProjectEditorPage() {
  const params = useParams<{ projectId: string }>();
  const [document, setDocument] = useState<ProjectDocument | null>(null);
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [error, setError] = useState('');
  const [reviewMode, setReviewMode] = useState(false);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentRef = useRef<ProjectDocument | null>(null);
  const dirty = useRef(false);
  const generation = useRef(0);
  const conflictRevision = useRef<number | null>(null);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const saveNowRef = useRef<(() => Promise<void>) | null>(null);
  const selectedObjectId = useSpaceGenStore(s => s.selectedObjectId);
  const setSelectedObjectId = useSpaceGenStore(s => s.setSelectedObjectId);
  const clearActiveModel = useSpaceGenStore(s => s.clearActiveModel);

  const adoptDocument = useCallback((doc: ProjectDocument) => {
    loaded.current = false; // applying the snapshot must not count as a user edit
    documentRef.current = doc;
    setDocument(doc);
    applyProjectDocument(doc);
    clearActiveModel();
    dirty.current = false;
    conflictRevision.current = null;
    setError('');
    setStatus('saved');
    loaded.current = true;
  }, [clearActiveModel]);

  useEffect(() => {
    let alive = true;
    loaded.current = false;
    loadProject(params.projectId).then(doc => {
      if (alive) adoptDocument(doc);
    }).catch((e: Error) => { if (alive) { setError(e.message); setStatus('error'); } });
    return () => { alive = false; loaded.current = false; if (timer.current) clearTimeout(timer.current); };
  }, [params.projectId, adoptDocument]);

  useEffect(() => {
    const saveNow = async (): Promise<void> => {
      if (!loaded.current || !documentRef.current || conflictRevision.current !== null) return;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (saveInFlight.current) return saveInFlight.current;
      const operation = (async () => {
        do {
          if (timer.current) { clearTimeout(timer.current); timer.current = null; }
          const base = documentRef.current;
          if (!base) return;
          const savedGeneration = generation.current;
          setStatus('saving'); setError('');
          try {
            const nodes = useScene.getState().nodes;
            const maskRegions = findScanNode()?.metadata?.maskRegions || base.manifest.maskRegions || [];
            const interpretation = deriveInterpretationFromScene(nodes, base.manifest.interpretation) || base.manifest.interpretation;
            const next = await saveProject({
              ...base,
              manifest: {
                ...base.manifest,
                maskRegions,
                interpretation,
                sceneSnapshot: getSceneDocument() as unknown as Record<string, unknown>,
              },
            });
            documentRef.current = next;
            setDocument(next);
            if (generation.current === savedGeneration) dirty.current = false;
          } catch (e) {
            if (e instanceof ProjectConflictError) {
              // Stop autosave: the user decides between the server copy and this tab's copy.
              conflictRevision.current = e.currentRevision;
              setError(e.message); setStatus('conflict');
              return;
            }
            setError((e as Error).message); setStatus('error');
            return;
          }
        } while (dirty.current);
        setStatus('saved');
      })();
      saveInFlight.current = operation;
      try { await operation; } finally { if (saveInFlight.current === operation) saveInFlight.current = null; }
    };
    saveNowRef.current = saveNow;
    const scheduleSave = (delay = 3000) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { timer.current = null; void saveNowRef.current?.(); }, delay);
    };
    const unsubscribe = useScene.subscribe(() => {
      if (!loaded.current) return;
      generation.current += 1;
      dirty.current = true;
      if (conflictRevision.current !== null) return;
      setStatus('unsaved');
      scheduleSave();
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      saveNowRef.current = null;
    };
  }, []);

  const reloadLatest = async () => {
    try {
      adoptDocument(await loadProject(params.projectId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const overwrite = async () => {
    const base = documentRef.current;
    const revision = conflictRevision.current;
    if (!base || revision === null) return;
    // Rebase this tab's copy onto the server's revision so the next save replaces it.
    documentRef.current = { ...base, revision };
    conflictRevision.current = null;
    dirty.current = true;
    await saveNowRef.current?.();
  };

  const handleAssetUploaded = useCallback((asset: AssetRef) => {
    const base = documentRef.current;
    if (!base) return;
    const assets = [...base.manifest.assets.filter((existing) => existing.url !== asset.url), asset];
    documentRef.current = { ...base, manifest: { ...base.manifest, assets } };
  }, []);

  if (!document) return <main className="flex min-h-screen items-center justify-center bg-background text-text-muted">{status === 'error' ? error : 'Loading project…'}</main>;
  const label = status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved changes' : status === 'error' ? 'Save failed' : status === 'conflict' ? 'Conflict' : 'Saved';
  return <EditorLayout>
    <div className="absolute left-3 top-3 z-50 flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow"><Link href="/projects" className="text-accent">Projects</Link><span className="font-medium">{document.manifest.name}</span><span aria-live="polite" className={status === 'error' || status === 'conflict' ? 'text-red-500' : 'text-text-muted'}>{label}</span><button onClick={() => void saveNowRef.current?.()} disabled={status === 'conflict'} className="rounded bg-accent px-3 py-1 text-white disabled:opacity-50">Save</button><button aria-pressed={reviewMode} onClick={() => setReviewMode(v => !v)} className={`rounded border px-3 py-1 ${reviewMode ? 'border-accent text-accent' : 'border-border'}`}>Review scan</button>{error && status !== 'conflict' && <span role="alert" className="text-red-500">{error}</span>}</div>
    {status === 'conflict' && (
      <div role="alertdialog" aria-label="Save conflict" className="absolute left-1/2 top-16 z-50 w-[420px] -translate-x-1/2 rounded-lg border border-red-500/50 bg-surface p-4 text-sm shadow-xl">
        <p className="font-medium text-red-400">This project was saved elsewhere.</p>
        <p className="mt-1 text-text-muted">{error} Reload the latest version (discarding this tab&apos;s unsaved changes) or overwrite it with this tab&apos;s version.</p>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => void reloadLatest()} className="rounded border border-border px-3 py-1">Reload latest</button>
          <button onClick={() => void overwrite()} className="rounded bg-red-600 px-3 py-1 text-white">Overwrite</button>
        </div>
      </div>
    )}
    <div className="w-[280px] border-r border-border bg-surface flex flex-col shrink-0 h-full overflow-hidden"><ScenePanel projectId={params.projectId} onAssetUploaded={handleAssetUploaded} /></div>
    <div className="flex-1 bg-background relative overflow-hidden h-full"><SceneViewer selectedId={selectedObjectId} onSelectObject={setSelectedObjectId} reviewMode={reviewMode} /></div>
    <div className="w-[380px] border-l border-border bg-surface flex flex-col shrink-0 h-full overflow-hidden">{reviewMode ? <InterpretationReviewPanel interpretation={document.manifest.interpretation} scan={document.manifest.scan} maskRegions={document.manifest.maskRegions} /> : <ChatPanel />}</div>
  </EditorLayout>;
}
