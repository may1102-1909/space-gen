/**
 * The single display formatter for scan-derived lengths. Scan geometry is an estimate, so values
 * are never shown as exact. Swap this one function to change every measurement label.
 */
export function formatMeasurementEstimate(meters: number): string {
  return `≈ ${meters.toFixed(2)} m`;
}
