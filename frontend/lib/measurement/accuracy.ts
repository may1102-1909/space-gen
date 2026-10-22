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

/** "≈ 48.0 m² (±2.2 m² est.)": a length error of p% is roughly a 2p% area error. */
export function formatArea(squareMeters: number, scaleSource: ScaleSource, table: ErrorTable = ERROR_TABLE): string {
  const pct = table.scaleSources[scaleSource]?.relativePct ?? FALLBACK_RELATIVE_PCT;
  const err = Math.max(0.1, Math.ceil(Math.abs(squareMeters) * 2 * pct * 0.1) / 10);
  return `≈ ${squareMeters.toFixed(1)} m² (±${err.toFixed(1)} m² est.)`;
}

/** "≈ 1.20 × 0.80 × 0.45 m (±3 cm est.)", the bound taken from the largest dimension. */
export function formatDimensions(dims: readonly number[], scaleSource: ScaleSource, table: ErrorTable = ERROR_TABLE): string {
  const err = errorCm(Math.max(...dims.map(Math.abs)), scaleSource, table);
  return `≈ ${dims.map((d) => value(d, err)).join(' × ')} m (±${err} cm est.)`;
}
