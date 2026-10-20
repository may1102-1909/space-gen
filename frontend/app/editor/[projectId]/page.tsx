'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { applySceneSnapshot, getSceneDocument, useScene } from '@pascal-app/core';
import { ScenePanel } from '@/components/panels/ScenePanel';
import { ChatPanel } from '@/components/panels/ChatPanel';
import { EditorLayout } from '@/components/layout/EditorLayout';
import { useSpaceGenStore } from '@/lib/store';
import { loadProject, saveProject, type ProjectDocument } from '@/lib/projects/api';

const SceneViewer = dynamic(() => import('@/components/viewer/SceneViewer'), { ssr: false });

export default function ProjectEditorPage() {
  const params = useParams<{ projectId: string }>();
  const [document, setDocument] = useState<ProjectDocument | null>(null);
  const [status, setStatus] = useState<'loading' | 'saved' | 'unsaved' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentRef = useRef<ProjectDocument | null>(null);
  const dirty = useRef(false);
  const generation = useRef(0);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const saveNowRef = useRef<(() => Promise<void>) | null>(null);
  const selectedObjectId = useSpaceGenStore(s => s.selectedObjectId);
  const setSelectedObjectId = useSpaceGenStore(s => s.setSelectedObjectId);
  const clearActiveModel = useSpaceGenStore(s => s.clearActiveModel);

  useEffect(() => {
    let alive = true;
    loaded.current = false;
    loadProject(params.projectId).then(doc => {
      if (!alive) return;
      documentRef.current = doc;
      setDocument(doc);
      if (doc.manifest.sceneSnapshot && Object.keys(doc.manifest.sceneSnapshot).length) {
        applySceneSnapshot(doc.manifest.sceneSnapshot as Parameters<typeof applySceneSnapshot>[0], { origin: 'load' });
      } else {
        useScene.getState().clearScene();
      }
      clearActiveModel();
      setStatus('saved');
      loaded.current = true;
    }).catch((e: Error) => { if (alive) { setError(e.message); setStatus('error'); } });
    return () => { alive = false; loaded.current = false; if (timer.current) clearTimeout(timer.current); };
  }, [params.projectId, clearActiveModel]);

  useEffect(() => {
    const saveNow = async (): Promise<void> => {
      if (!loaded.current || !documentRef.current) return;
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
            const next = await saveProject({ ...base, manifest: { ...base.manifest, sceneSnapshot: getSceneDocument() } });
            documentRef.current = next;
            setDocument(next);
            if (generation.current === savedGeneration) dirty.current = false;
          } catch (e) {
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

  if (!document) return <main className="flex min-h-screen items-center justify-center bg-background text-text-muted">{status === 'error' ? error : 'Loading project…'}</main>;
  const label = status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved changes' : status === 'error' ? 'Save failed' : 'Saved';
  return <EditorLayout>
    <div className="absolute left-3 top-3 z-50 flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow"><Link href="/projects" className="text-accent">Projects</Link><span className="font-medium">{document.manifest.name}</span><span aria-live="polite" className={status === 'error' ? 'text-red-500' : 'text-text-muted'}>{label}</span><button onClick={() => void saveNowRef.current?.()} className="rounded bg-accent px-3 py-1 text-white">Save</button>{error && <span role="alert" className="text-red-500">{error}</span>}</div>
    <div className="w-[280px] border-r border-border bg-surface flex flex-col shrink-0 h-full overflow-hidden"><ScenePanel /></div>
    <div className="flex-1 bg-background relative overflow-hidden h-full"><SceneViewer selectedId={selectedObjectId} onSelectObject={setSelectedObjectId} /></div>
    <div className="w-[380px] border-l border-border bg-surface flex flex-col shrink-0 h-full overflow-hidden"><ChatPanel /></div>
  </EditorLayout>;
}
