import { ScaleSourceSchema, type ScaleSource } from '@/lib/contracts/scan';
import measuredTable from './errorTable.json';

/** Written by `python -m scripts.accuracy_report --frontend-table` (backend/); see docs/accuracy.md. */
export interface ErrorTable {
  version: number;
  basis: string;
  scaleSources: Partial<Record<ScaleSource, { relativePct: number; samples: number; rooms: number }>>;
}

export const ERROR_TABLE = measuredTable as ErrorTable;
// Used only when the table has no row for a scaleSource; matches the worst case of having no scale anchor.
const FALLBACK_RELATIVE_PCT = 15;

/** The project's scale provenance, from the scan node; unknown counts as unscaled. */
export function scaleSourceOf(scanNode: { metadata?: { scaleSource?: unknown } } | null | undefined): ScaleSource {
  const parsed = ScaleSourceSchema.safeParse(scanNode?.metadata?.scaleSource);
  return parsed.success ? parsed.data : 'none';
}

export function errorCm(meters: number, scaleSource: ScaleSource, table: ErrorTable = ERROR_TABLE): number {
  const pct = table.scaleSources[scaleSource]?.relativePct ?? FALLBACK_RELATIVE_PCT;
  return Math.max(1, Math.ceil(Math.abs(meters) * pct));
}

function value(meters: number, errCm: number): string {
  return meters.toFixed(errCm >= 10 ? 1 : 2);
}

/** "≈ 2.35 m (±4 cm est.)": a scan-derived length is never shown as exact. */
export function formatMeasurement(meters: number, scaleSource: ScaleSource, table: ErrorTable = ERROR_TABLE): string {
  const err = errorCm(meters, scaleSource, table);
  return `≈ ${value(meters, err)} m (±${err} cm est.)`;
}

/** "≈ 1.20 × 0.80 × 0.45 m (±3 cm est.)", the bound taken from the largest dimension. */
export function formatDimensions(dims: readonly number[], scaleSource: ScaleSource, table: ErrorTable = ERROR_TABLE): string {
  const err = errorCm(Math.max(...dims.map(Math.abs)), scaleSource, table);
  return `≈ ${dims.map((d) => value(d, err)).join(' × ')} m (±${err} cm est.)`;
}
