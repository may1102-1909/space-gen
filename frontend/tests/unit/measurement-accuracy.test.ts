import { describe, expect, it } from 'vitest';
import {
  ERROR_TABLE,
  errorCm,
  formatDimensions,
  formatMeasurement,
  scaleSourceOf,
  type ErrorTable,
} from '@/lib/measurement/accuracy';

const table: ErrorTable = {
  version: 1,
  basis: 'test',
  scaleSources: {
    none: { relativePct: 12, samples: 10, rooms: 3 },
    sensor: { relativePct: 1.5, samples: 10, rooms: 3 },
  },
};

describe('measurement accuracy formatting', () => {
  it('scales the bound with the value and rounds it up to whole cm', () => {
    expect(errorCm(2.4, 'sensor', table)).toBe(4); // 3.6 cm -> 4
    expect(errorCm(0.2, 'sensor', table)).toBe(1); // floor of 1 cm
    expect(errorCm(3, 'none', table)).toBe(36);
  });

  it('falls back to 15% when the table has no row for the scale source', () => {
    expect(errorCm(2, 'user_measurement', table)).toBe(30);
  });

  it('never prints a bare number', () => {
    expect(formatMeasurement(2.35, 'sensor', table)).toBe('≈ 2.35 m (±4 cm est.)');
    // Decimetre-level uncertainty drops the centimetre digit.
    expect(formatMeasurement(3.04, 'none', table)).toBe('≈ 3.0 m (±37 cm est.)');
  });

  it('formats dimensions with the bound of the largest side', () => {
    expect(formatDimensions([1.2, 0.8, 0.45], 'sensor', table)).toBe('≈ 1.20 × 0.80 × 0.45 m (±2 cm est.)');
  });

  it('treats a missing or unknown scale source as unscaled', () => {
    expect(scaleSourceOf(undefined)).toBe('none');
    expect(scaleSourceOf({ metadata: { scaleSource: 'guess' } })).toBe('none');
    expect(scaleSourceOf({ metadata: { scaleSource: 'sensor' } })).toBe('sensor');
  });

  it('ships a measured table for every scale source', () => {
    expect(Object.keys(ERROR_TABLE.scaleSources).sort()).toEqual(['none', 'sensor', 'user_measurement']);
  });
});
