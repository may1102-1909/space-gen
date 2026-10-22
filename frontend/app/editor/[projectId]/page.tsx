'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { applySceneSnapshot, clearSceneHistory, getSceneDocument, useScene, type AnyNode, type AnyNodeId } from '@pascal-app/core';
import { ScenePanel } from '@/components/panels/ScenePanel';
import { ChatPanel } from '@/components/panels/ChatPanel';
import { InterpretationReviewPanel } from '@/components/panels/InterpretationReviewPanel';
import { DrawingsPanel } from '@/components/panels/DrawingsPanel';
import { ShareDialog } from '@/components/share/ShareDialog';
import { EditorLayout } from '@/components/layout/EditorLayout';
import { useSpaceGenStore } from '@/lib/store';
import type { AssetRef, MaskRegion, Viewpoint } from '@/lib/contracts';
import { API_BASE, loadProject, ProjectConflictError, saveProject, type ProjectDocument } from '@/lib/projects/api';
import { applySegmentedObjects, segmentedAssetRefs } from '@/lib/scan/segmentedObjects';
import { deriveInterpretationFromScene } from '@/lib/pascal/scanConverter';
import { nodeViews } from '@/lib/pascal/nodes';
import { editHistoryHost, readEditHistory } from '@/lib/pascal/sceneBridge';
import { clearProposalPreviews, withoutProposalGhosts } from '@/lib/pascal/proposalPreview';
import { replaceScanNode, setScanAlignment } from '@/lib/pascal/scanNodes';
import type { ImportedScan } from '@/lib/scan/splatImport';
import { VariantBar } from '@/components/variants/VariantBar';
import { VariantCompare } from '@/components/variants/VariantCompare';
import { activeVariant, createVariant, deleteVariant, duplicateVariant, normalizeVariants, renameVariant, switchVariant, type Snapshot, type VariantSet } from '@/lib/variants/variants';

const liveScene = () => getSceneDocument() as unknown as Snapshot;

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
  // Pending previews belong to the document being replaced (and block snapshot loads).
  clearProposalPreviews();
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
  // Older documents keep EditRecords only in the manifest; mirror them into the scene.
  const historyHost = editHistoryHost();
  if (historyHost && doc.manifest.history.length > 0 && !readEditHistory()?.length) {
    useScene.getState().updateNode(historyHost.id as AnyNodeId, {
      metadata: { ...(historyHost.metadata as Record<string, unknown> | undefined), editHistory: doc.manifest.history },
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
  const [drawingsOpen, setDrawingsOpen] = useState(false);
  const [compare, setCompare] = useState<VariantSet | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
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
            const nodes = withoutProposalGhosts(useScene.getState().nodes);
            const maskRegions = findScanNode()?.metadata?.maskRegions || base.manifest.maskRegions || [];
            const interpretation = deriveInterpretationFromScene(nodeViews(nodes), base.manifest.interpretation) || base.manifest.interpretation;
            const scene = getSceneDocument() as unknown as Snapshot;
            const variants = normalizeVariants(base.manifest, scene);
            const next = await saveProject({
              ...base,
              manifest: {
                ...base.manifest,
                variants: variants.variants,
                activeVariantId: variants.activeVariantId,
                maskRegions,
                interpretation,
                history: readEditHistory(nodes) ?? base.manifest.history,
                sceneSnapshot: scene,
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

  /** Applies a variant operation: persists the set in the manifest and, when the active variant changed, loads its scene. */
  const applyVariantSet = useCallback((set: VariantSet, previousActive: string) => {
    const base = documentRef.current;
    if (!base) return;
    const snapshot = activeVariant(set).sceneSnapshot;
    const manifest = { ...base.manifest, variants: set.variants, activeVariantId: set.activeVariantId };
    if (set.activeVariantId === previousActive) {
      documentRef.current = { ...base, manifest };
      setDocument(documentRef.current);
    } else {
      const nodes = (snapshot.nodes ?? {}) as Record<string, { type?: string; metadata?: { maskRegions?: MaskRegion[] } }>;
      const maskRegions = Object.values(nodes).find((n) => n?.type === 'scan')?.metadata?.maskRegions ?? [];
      // Switching reuses the load path: undo history is cleared (see clearSceneHistory in applyProjectDocument).
      adoptDocument({ ...base, manifest: { ...manifest, sceneSnapshot: snapshot, maskRegions, history: readEditHistory(nodes) ?? [] } });
    }
    dirty.current = true;
    generation.current += 1;
    setStatus('unsaved');
    void saveNowRef.current?.();
  }, [adoptDocument]);

  const variantOp = (op: (set: VariantSet, scene: Snapshot) => VariantSet) => {
    const base = documentRef.current;
    if (!base || status === 'conflict') return;
    const scene = liveScene();
    const current = normalizeVariants(base.manifest, scene);
    try { applyVariantSet(op(current, scene), current.activeVariantId); } catch (e) { setError((e as Error).message); }
  };
  // Viewpoints live in the manifest, not the Pascal scene, so they need an explicit save.
  const changeViewpoints = useCallback((update: (current: Viewpoint[]) => Viewpoint[]) => {
    const base = documentRef.current;
    if (!base) return;
    const next = { ...base, manifest: { ...base.manifest, viewpoints: update(base.manifest.viewpoints ?? []) } };
    documentRef.current = next;
    setDocument(next);
    dirty.current = true;
    generation.current += 1;
    void saveNowRef.current?.();
  }, []);

  const handleAssetUploaded = useCallback((asset: AssetRef) => {
    const base = documentRef.current;
    if (!base) return;
    const assets = [...base.manifest.assets.filter((existing) => existing.url !== asset.url), asset];
    documentRef.current = { ...base, manifest: { ...base.manifest, assets } };
  }, []);

  const handleScanImported = useCallback(({ scan, format, job }: ImportedScan) => {
    const base = documentRef.current;
    if (!base || !job.result) return;
    const { interpretation, scanToScene } = job.result;
    const objects = job.objects ?? [];
    const meshAssets = segmentedAssetRefs(objects, API_BASE);
    // The manifest carries the new interpretation until "Build editable room" turns it into Pascal nodes.
    const next: ProjectDocument = {
      ...base,
      manifest: {
        ...base.manifest,
        scan: { ...base.manifest.scan, url: scan.url, format, scanToScene, scaleSource: 'none' },
        interpretation,
        maskRegions: [],
        assets: [...base.manifest.assets.filter((a) => !meshAssets.some((m) => m.url === a.url)), ...meshAssets],
      },
    };
    documentRef.current = next;
    setDocument(next);
    const scanId = replaceScanNode(scan.url, format);
    // Auto-level: the suggested placement is its own undo step; the alignment tool fine-tunes it.
    setScanAlignment(scanId, scanToScene);
    // GPU-separated objects become Pascal items with masks hiding their splats: one more undo step.
    if (objects.length || job.surfaces?.length) applySegmentedObjects(objects, API_BASE, job.surfaces ?? []);
    setReviewMode(true);
  }, []);

  if (!document) return <main className="flex min-h-screen items-center justify-center bg-background text-text-muted">{status === 'error' ? error : 'Loading project…'}</main>;
  const label = status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved changes' : status === 'error' ? 'Save failed' : status === 'conflict' ? 'Conflict' : 'Saved';
  return <EditorLayout onShare={() => setShareOpen(true)}>
    <div className="absolute left-3 top-3 z-50 flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow"><Link href="/projects" className="text-accent">Projects</Link><span className="font-medium">{document.manifest.name}</span><span aria-live="polite" className={status === 'error' || status === 'conflict' ? 'text-red-500' : 'text-text-muted'}>{label}</span><button onClick={() => void saveNowRef.current?.()} disabled={status === 'conflict'} className="rounded bg-accent px-3 py-1 text-white disabled:opacity-50">Save</button><button aria-pressed={reviewMode} onClick={() => setReviewMode(v => !v)} className={`rounded border px-3 py-1 ${reviewMode ? 'border-accent text-accent' : 'border-border'}`}>Review scan</button><button onClick={() => setDrawingsOpen(true)} className="rounded border border-border px-3 py-1">Drawings</button>{error && status !== 'conflict' && <span role="alert" className="text-red-500">{error}</span>}</div>
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
    {compare && (() => {
      const other = compare.variants.find((v) => v.id !== compare.activeVariantId) ?? compare.variants[0];
      return <VariantCompare variants={compare.variants} initialA={other.id} initialB={compare.activeVariantId} scan={document.manifest.scan} onClose={() => setCompare(null)} />;
    })()}
    {shareOpen && <ShareDialog projectId={params.projectId} viewpoints={document.manifest.viewpoints ?? []} onClose={() => setShareOpen(false)} onAddViewpoint={(vp) => changeViewpoints((all) => [...all, vp])} onRemoveViewpoint={(id) => changeViewpoints((all) => all.filter((v) => v.id !== id))} />}
    {drawingsOpen && <DrawingsPanel projectName={document.manifest.name} onClose={() => setDrawingsOpen(false)} />}
    <div className="w-[280px] border-r border-border bg-surface flex flex-col shrink-0 h-full overflow-hidden"><div className="border-b border-border p-2"><VariantBar
      variants={document.manifest.variants.length ? document.manifest.variants : normalizeVariants(document.manifest, {}).variants}
      activeId={document.manifest.activeVariantId}
      onSwitch={(id) => variantOp((set, scene) => switchVariant(set, scene, id))}
      onCreate={(from) => variantOp((set, scene) => createVariant(set, scene, { from, name: `Variant ${set.variants.length + 1}` }))}
      onDuplicate={() => variantOp((set, scene) => duplicateVariant(set, scene, set.activeVariantId))}
      onRename={(name) => variantOp((set, scene) => renameVariant(set, scene, set.activeVariantId, name))}
      onDelete={() => { if (window.confirm('Delete this variant? This cannot be undone.')) variantOp((set, scene) => deleteVariant(set, scene, set.activeVariantId)); }}
      onCompare={() => { const base = documentRef.current; if (base) setCompare(normalizeVariants(base.manifest, liveScene())); }}
    /></div><ScenePanel projectId={params.projectId} onAssetUploaded={handleAssetUploaded} /></div>
    <div className="flex-1 bg-background relative overflow-hidden h-full"><SceneViewer selectedId={selectedObjectId} onSelectObject={setSelectedObjectId} reviewMode={reviewMode} projectId={params.projectId} onScanImported={handleScanImported} /></div>
    <div className="w-[380px] border-l border-border bg-surface flex flex-col shrink-0 h-full overflow-hidden">{reviewMode ? <InterpretationReviewPanel interpretation={document.manifest.interpretation} scan={document.manifest.scan} maskRegions={document.manifest.maskRegions} /> : <ChatPanel projectId={params.projectId} onAssetUploaded={handleAssetUploaded} onOpenReview={() => setReviewMode(true)} />}</div>
  </EditorLayout>;
}
