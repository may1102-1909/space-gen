'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, Sparkles, UploadCloud, X, XCircle } from 'lucide-react';
import type { ConversionStage } from '@/lib/contracts';
import {
  conversionMessage,
  IMPORT_ACCEPT,
  importSplat,
  ObjectsStageError,
  pollConversion,
  retryObjects,
  type ImportedScan,
  type ImportProgress,
} from '@/lib/scan/splatImport';

interface ScanToEditableModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  /** Called once the room structure is ready; the caller loads it into the project. */
  onImported: (imported: ImportedScan) => void;
}

const STAGE_LABELS: Record<ConversionStage['name'], string> = {
  uploaded: 'Scan uploaded',
  structure: 'Walls, floor & openings',
  objects: 'Separate objects',
  ready: 'Ready to review',
};

function StageIcon({ status }: { status: ConversionStage['status'] }) {
  if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-400" />;
  if (status === 'running') return <Loader2 size={14} className="animate-spin text-accent" />;
  if (status === 'failed') return <XCircle size={14} className="text-red-400" />;
  return <Circle size={14} className="text-text-muted" />;
}

/** Upload a Gaussian splat and convert it into a reviewable RoomInterpretation. */
export function ScanToEditableModal({ isOpen, onClose, projectId, onImported }: ScanToEditableModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  // Room structure is ready but the GPU objects stage failed: retry it or keep the room without objects.
  const [objectsFailed, setObjectsFailed] = useState<ImportedScan | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = progress !== null && progress.phase !== 'failed' && progress.phase !== 'ready';

  useEffect(() => () => abortRef.current?.abort(), []);
  if (!isOpen) return null;

  const close = () => {
    abortRef.current?.abort();
    setProgress(null);
    setObjectsFailed(null);
    onClose();
  };

  const finish = (imported: ImportedScan) => {
    onImported(imported);
    setProgress(null);
    setObjectsFailed(null);
    setFile(null);
    onClose();
  };

  const track = async (work: (signal: AbortSignal) => Promise<ImportedScan>) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setObjectsFailed(null);
    try {
      const imported = await work(controller.signal);
      if (!controller.signal.aborted) finish(imported);
    } catch (error) {
      // Progress already shows the failure; an objects-stage failure also offers retry / continue.
      if (error instanceof ObjectsStageError && error.imported) setObjectsFailed(error.imported);
    }
  };

  const run = async () => file && track((signal) => importSplat(projectId, file, file.name, setProgress, { signal }));

  const retry = (failed: ImportedScan) => track(async (signal) => {
    const restarted = await retryObjects(failed.job.jobId);
    const job = await pollConversion(restarted, {
      signal,
      onUpdate: (update) => setProgress({ phase: 'converting', message: conversionMessage(update), job: update }),
    }).catch((error) => {
      if (error instanceof ObjectsStageError) error.imported = { ...failed, job: error.job };
      setProgress({ phase: 'failed', message: (error as Error).message, job: (error as ObjectsStageError).job });
      throw error;
    });
    return { ...failed, job };
  });

  const stages = progress?.job?.stages;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-label="Import scan" className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-surface p-6 text-text-primary shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-accent/25 bg-accent/15 text-accent">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Convert Scan to Editable Space</h3>
              <p className="text-xs text-text-muted">Upload a Gaussian splat; walls, floor and openings become editable Pascal nodes; with the GPU worker on, furniture becomes movable items.</p>
            </div>
          </div>
          <button onClick={close} aria-label="Close" className="rounded-lg p-1 text-text-muted hover:bg-surface-elevated hover:text-text-primary">
            <X size={16} />
          </button>
        </div>

        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface-elevated/30 p-5 text-xs hover:bg-surface-elevated/50">
          <UploadCloud size={20} className="text-accent" />
          <span className="font-medium">{file ? file.name : 'Choose a .ply, .sog or .spz splat'}</span>
          {file && <span className="text-text-muted">{(file.size / 1e6).toFixed(1)} MB · replaces this project&apos;s scan</span>}
          <input
            type="file"
            accept={IMPORT_ACCEPT}
            aria-label="Splat file"
            className="sr-only"
            disabled={busy}
            onChange={(e) => { setFile(e.target.files?.[0] || null); setProgress(null); }}
          />
        </label>

        {progress && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-surface-elevated/40 p-3 text-xs" aria-live="polite">
            <p data-testid="import-message" className={progress.phase === 'failed' ? 'text-red-400' : 'text-text-secondary'} role={progress.phase === 'failed' ? 'alert' : undefined}>
              {progress.message}
            </p>
            {stages && (
              <ol aria-label="Conversion stages" className="space-y-1">
                {stages.map((stage) => (
                  <li key={stage.name} data-testid={`stage-${stage.name}`} data-status={stage.status} className="flex items-center gap-2">
                    <StageIcon status={stage.status} />
                    <span>{STAGE_LABELS[stage.name]}</span>
                    {stage.name === 'objects' && stage.detail && <span data-testid="objects-detail" className="text-text-muted">· {stage.detail}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {objectsFailed && (
          <div className="flex items-center justify-end gap-2.5 text-xs">
            <button onClick={() => finish({ ...objectsFailed, job: { ...objectsFailed.job, objects: [], surfaces: [] } })} className="rounded-xl border border-border px-4 py-2 font-medium text-text-secondary hover:bg-surface-elevated">
              Continue without objects
            </button>
            <button onClick={() => void retry(objectsFailed)} className="rounded-xl bg-accent px-4 py-2 font-medium text-white hover:bg-accent-light">
              Retry objects
            </button>
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 border-t border-border pt-2">
          <button onClick={close} className="rounded-xl px-4 py-2 text-xs font-medium text-text-secondary hover:bg-surface-elevated hover:text-text-primary">
            Cancel
          </button>
          <button
            onClick={() => void run()}
            disabled={!file || busy}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-xs font-medium text-white shadow-lg shadow-accent/25 hover:bg-accent-light disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            <span>{busy ? 'Converting…' : 'Upload & convert'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ScanToEditableModal;
