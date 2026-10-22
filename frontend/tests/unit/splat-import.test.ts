// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ConversionJobStatus, RoomStructureResult } from '@/lib/contracts';
import { conversionMessage, importFormat, importSplat, ObjectsStageError, pointsToPly, pollConversion, type ImportProgress } from '@/lib/scan/splatImport';

const RESULT: RoomStructureResult = {
  interpretation: {
    provenance: 'auto',
    floor: { normal: [0, 1, 0], constant: 0, provenance: 'auto' },
    ceilingHeight: 2.6,
    outline: [[0, 0], [5, 0], [5, 4], [0, 4]],
    walls: [],
    openings: [],
    detections: [],
  },
  scanToScene: [1, 0, 0, 0, 0, 1, 0, 0.7, 0, 0, 1, 0, 0, 0, 0, 1],
  gravityConfidence: 0.9,
  manhattan: true,
};

function job(status: ConversionJobStatus['status'], extra: Partial<ConversionJobStatus> = {}): ConversionJobStatus {
  const done = status === 'completed';
  return {
    jobId: 'job1', projectId: 'p1', scanAssetId: 'a.ply', pointsAssetId: 'a.ply', status,
    stage: done ? 'ready' : 'structure',
    stages: [
      { name: 'uploaded', status: 'completed' },
      { name: 'structure', status: done ? 'completed' : status === 'failed' ? 'failed' : 'running', detail: 'Fitting' },
      { name: 'objects', status: 'pending' },
      { name: 'ready', status: done ? 'completed' : 'pending' },
    ],
    result: done ? RESULT : null,
    ...extra,
  };
}

const noWait = () => Promise.resolve();

describe('pollConversion', () => {
  it('polls until completed and reports every status', async () => {
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(job('running'))
      .mockResolvedValueOnce(job('completed'));
    const updates: string[] = [];
    const done = await pollConversion(job('running'), { fetchStatus, wait: noWait, onUpdate: (j) => updates.push(j.stage) });
    expect(done.result?.scanToScene).toEqual(RESULT.scanToScene);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(updates).toEqual(['structure', 'structure', 'ready']);
  });

  it('rejects with the job error on failure', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(job('failed', { error: 'Too few points' }));
    await expect(pollConversion(job('running'), { fetchStatus, wait: noWait })).rejects.toThrow('Too few points');
  });

  it('keeps the room structure when only the GPU objects stage failed', async () => {
    const failed = job('failed', { result: RESULT, stage: 'objects', error: 'Cannot reach the GPU worker' });
    failed.stages[1].status = 'completed';
    failed.stages[2] = { name: 'objects', status: 'failed', detail: 'GPU worker unreachable.' };
    const error = await pollConversion(job('running'), { fetchStatus: vi.fn().mockResolvedValue(failed), wait: noWait }).catch((e) => e);
    expect(error).toBeInstanceOf(ObjectsStageError);
    expect(error.message).toBe('Cannot reach the GPU worker');
    expect(error.job.result).toEqual(RESULT);
    expect(conversionMessage({ ...failed, status: 'running' })).toBe('GPU worker unreachable.');
  });

  it('rejects a completed job without a result', async () => {
    await expect(pollConversion(job('completed', { result: null }), { wait: noWait })).rejects.toThrow('without a room structure');
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    const fetchStatus = vi.fn();
    const wait = () => { controller.abort(); return Promise.resolve(); };
    await expect(pollConversion(job('running'), { fetchStatus, wait, signal: controller.signal })).rejects.toThrow('cancelled');
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('times out', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(job('running'));
    await expect(pollConversion(job('running'), { fetchStatus, wait: noWait, timeoutMs: -1 })).rejects.toThrow('timed out');
  });
});

describe('importSplat', () => {
  const uploaded = (filename: string) => ({ url: `http://api/assets/${filename}`, filename, size: 1 });

  it('sends a .ply straight to the conversion job', async () => {
    const upload = vi.fn().mockResolvedValue(uploaded('hash.ply'));
    const decode = vi.fn();
    const start = vi.fn().mockResolvedValue(job('running'));
    const poll = vi.fn().mockImplementation(async (_j, opts) => { opts.onUpdate(job('running')); return job('completed'); });
    const phases: ImportProgress['phase'][] = [];
    const out = await importSplat('p1', new Blob(['x']), 'room.ply', (p) => phases.push(p.phase), { upload, decode, start, poll });
    expect(decode).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith('p1', 'hash.ply', undefined);
    expect(out).toMatchObject({ format: 'ply', scan: { filename: 'hash.ply' } });
    expect(phases).toEqual(['uploading', 'converting', 'converting', 'ready']);
  });

  it('decodes .spz/.sog to a points PLY stored beside the scan', async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce(uploaded('scan.spz'))
      .mockResolvedValueOnce(uploaded('points.ply'));
    const decode = vi.fn().mockResolvedValue({ positions: new Float32Array([1, 2, 3]), opacity: new Float32Array([0.5]) });
    const start = vi.fn().mockResolvedValue(job('running'));
    const poll = vi.fn().mockResolvedValue(job('completed'));
    const phases: ImportProgress['phase'][] = [];
    await importSplat('p1', new Blob(['x']), 'room.spz', (p) => phases.push(p.phase), { upload, decode, start, poll });
    expect(upload.mock.calls[1][2]).toBe('points.ply');
    expect(start).toHaveBeenCalledWith('p1', 'scan.spz', 'points.ply');
    expect(phases).toEqual(['uploading', 'decoding', 'converting', 'ready']);
  });

  it('reports failures and rejects unsupported files', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('Asset exceeds the upload limit.'));
    const messages: ImportProgress[] = [];
    await expect(importSplat('p1', new Blob(['x']), 'room.ply', (p) => messages.push(p), { upload })).rejects.toThrow('upload limit');
    expect(messages.at(-1)).toEqual({ phase: 'failed', message: 'Asset exceeds the upload limit.' });
    expect(() => importFormat('chair.glb')).toThrow('Unsupported scan file');
  });
});

describe('pointsToPly', () => {
  it('writes a binary little-endian x/y/z/opacity PLY', async () => {
    const blob = pointsToPly({ positions: new Float32Array([1, 2, 3, 4, 5, 6]), opacity: new Float32Array([0.25, 0.75]) });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const headerEnd = text.indexOf('end_header\n') + 'end_header\n'.length;
    expect(text.slice(0, headerEnd)).toContain('element vertex 2');
    const body = new Float32Array(bytes.slice(headerEnd).buffer);
    expect(Array.from(body)).toEqual([1, 2, 3, 0.25, 4, 5, 6, 0.75]);
  });
});
