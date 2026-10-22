import { ConversionJobStatusSchema, type ConversionJobStatus, type ScanFormat } from '@/lib/contracts';
import { API_BASE, uploadProjectAsset, type UploadedAsset } from '@/lib/projects/api';

/**
 * Splat import: upload the scan to the project asset store, make sure the backend has PLY points
 * for it, run the conversion job and poll it until the room structure is ready.
 */

export type ImportableFormat = Extract<ScanFormat, 'ply' | 'sog' | 'spz'>;
export const IMPORT_ACCEPT = '.ply,.sog,.spz';
/** The room-structure fit voxel-downsamples anyway; this only bounds the points upload. */
export const MAX_POINTS = 2_000_000;

export type ImportPhase = 'uploading' | 'decoding' | 'converting' | 'ready' | 'failed';
export interface ImportProgress {
  phase: ImportPhase;
  message: string;
  job?: ConversionJobStatus;
}

export interface SplatPoints {
  positions: Float32Array;
  opacity: Float32Array;
}

export interface ImportedScan {
  scan: UploadedAsset;
  format: ImportableFormat;
  job: ConversionJobStatus;
}

export function importFormat(filename: string): ImportableFormat {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'ply' || ext === 'sog' || ext === 'spz') return ext;
  throw new Error('Unsupported scan file. Use a .ply, .sog or .spz Gaussian splat.');
}

/** Binary little-endian PLY with x, y, z, opacity (activated, 0..1) per point. */
export function pointsToPly({ positions, opacity }: SplatPoints): Blob {
  const count = opacity.length;
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\nproperty float x\nproperty float y\nproperty float z\nproperty float opacity\nend_header\n`;
  const body = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    body[i * 4] = positions[i * 3];
    body[i * 4 + 1] = positions[i * 3 + 1];
    body[i * 4 + 2] = positions[i * 3 + 2];
    body[i * 4 + 3] = opacity[i];
  }
  return new Blob([header, body.buffer], { type: 'application/octet-stream' });
}

/** Decodes splat centers with Spark, the same decoder that renders the scan, so frames match. */
export async function decodeSplatPoints(file: Blob, filename: string, maxPoints = MAX_POINTS): Promise<SplatPoints> {
  const { PackedSplats } = await import('@sparkjsdev/spark');
  const splats = new PackedSplats({ fileBytes: new Uint8Array(await file.arrayBuffer()), fileName: filename });
  await splats.initialized;
  try {
    const stride = Math.max(1, Math.ceil(splats.numSplats / maxPoints));
    const count = Math.ceil(splats.numSplats / stride);
    const positions = new Float32Array(count * 3);
    const opacity = new Float32Array(count);
    splats.forEachSplat((index: number, center: { x: number; y: number; z: number }, _scales: unknown, _quaternion: unknown, alpha: number) => {
      if (index % stride) return;
      const i = index / stride;
      positions[i * 3] = center.x;
      positions[i * 3 + 1] = center.y;
      positions[i * 3 + 2] = center.z;
      opacity[i] = alpha;
    });
    if (!count) throw new Error('The scan contains no splats.');
    return { positions, opacity };
  } finally {
    splats.dispose();
  }
}

async function requestJson(response: Response): Promise<ConversionJobStatus> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : `Conversion request failed (${response.status})`;
    throw new Error(detail);
  }
  return ConversionJobStatusSchema.parse(body);
}

export async function startConversion(projectId: string, scanAssetId: string, pointsAssetId?: string): Promise<ConversionJobStatus> {
  return requestJson(await fetch(`${API_BASE}/api/room-structure/conversions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, scanAssetId, ...(pointsAssetId ? { pointsAssetId } : {}) }),
  }));
}

/** Re-runs a failed objects stage (worker offline, tunnel expired, timeout); the scan upload resumes. */
export async function retryObjects(jobId: string): Promise<ConversionJobStatus> {
  return requestJson(await fetch(`${API_BASE}/api/room-structure/conversions/${encodeURIComponent(jobId)}/objects/retry`, { method: 'POST' }));
}

/** The room structure is ready but separating objects failed: the user can retry or keep the room without them. */
export class ObjectsStageError extends Error {
  imported?: ImportedScan;
  constructor(readonly job: ConversionJobStatus) {
    super(job.error || 'Separating objects failed.');
    this.name = 'ObjectsStageError';
  }
}

export function objectsStage(job: ConversionJobStatus | undefined) {
  return job?.stages.find((s) => s.name === 'objects');
}

/** The human-readable line for the stage currently running. */
export function conversionMessage(job: ConversionJobStatus): string {
  const objects = objectsStage(job);
  if (job.stage === 'objects' && objects?.detail) return objects.detail;
  return job.stages.find((s) => s.name === 'structure')?.detail || 'Converting…';
}

export async function fetchConversion(jobId: string): Promise<ConversionJobStatus> {
  return requestJson(await fetch(`${API_BASE}/api/room-structure/conversions/${encodeURIComponent(jobId)}`, { cache: 'no-store' }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onUpdate?: (job: ConversionJobStatus) => void;
  fetchStatus?: (jobId: string) => Promise<ConversionJobStatus>;
  wait?: (ms: number) => Promise<unknown>;
}

/** Polls until the job is completed (resolves) or failed (rejects with the job's error). */
export async function pollConversion(initial: ConversionJobStatus, options: PollOptions = {}): Promise<ConversionJobStatus> {
  // The backend bounds every stage itself (GPU job timeout, offline detection); this only guards a dead backend.
  const { intervalMs = 750, timeoutMs = 4 * 60 * 60_000, signal, onUpdate, fetchStatus = fetchConversion, wait = sleep } = options;
  const deadline = Date.now() + timeoutMs;
  let job = initial;
  for (;;) {
    onUpdate?.(job);
    if (job.status === 'completed') {
      if (!job.result) throw new Error('Conversion finished without a room structure.');
      return job;
    }
    if (job.status === 'failed') {
      if (job.result && objectsStage(job)?.status === 'failed') throw new ObjectsStageError(job);
      throw new Error(job.error || 'Conversion failed.');
    }
    if (Date.now() > deadline) throw new Error('Conversion timed out.');
    await wait(intervalMs);
    if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
    job = await fetchStatus(job.jobId);
  }
}

export interface ImportDeps {
  upload?: typeof uploadProjectAsset;
  decode?: typeof decodeSplatPoints;
  start?: typeof startConversion;
  poll?: typeof pollConversion;
}

/** Runs the whole import; progress is reported per phase plus every polled job status. */
export async function importSplat(
  projectId: string,
  file: Blob,
  filename: string,
  onProgress: (progress: ImportProgress) => void,
  { signal, ...deps }: ImportDeps & { signal?: AbortSignal } = {},
): Promise<ImportedScan> {
  const { upload = uploadProjectAsset, decode = decodeSplatPoints, start = startConversion, poll = pollConversion } = deps;
  const format = importFormat(filename);
  let scan: UploadedAsset | undefined;
  try {
    onProgress({ phase: 'uploading', message: `Uploading ${filename}…` });
    scan = await upload(projectId, file, filename);
    let pointsAssetId: string | undefined;
    if (format !== 'ply') {
      // The structure service reads PLY; decode .sog/.spz centers here and store them beside the scan.
      onProgress({ phase: 'decoding', message: 'Decoding splat points…' });
      const points = await decode(file, filename);
      pointsAssetId = (await upload(projectId, pointsToPly(points), 'points.ply')).filename;
    }
    onProgress({ phase: 'converting', message: 'Fitting walls, floor and openings…' });
    const job = await poll(await start(projectId, scan.filename, pointsAssetId), {
      signal,
      onUpdate: (update) => onProgress({ phase: 'converting', message: conversionMessage(update), job: update }),
    });
    onProgress({ phase: 'ready', message: 'Room ready to review.', job });
    return { scan, format, job };
  } catch (error) {
    if (error instanceof ObjectsStageError && scan) error.imported = { scan, format, job: error.job };
    onProgress({ phase: 'failed', message: (error as Error).message, job: (error as ObjectsStageError).job });
    throw error;
  }
}
