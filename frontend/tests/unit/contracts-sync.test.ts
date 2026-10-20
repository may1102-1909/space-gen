import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ProjectManifestSchema,
  EditProposalSchema,
  RoomInterpretationSchema,
  ScanAssetSchema,
  MaskRegionSchema,
  AssetRefSchema,
} from '@/lib/contracts';

describe('Contracts Schema & Parity Unit Tests (Frontend / Zod)', () => {
  const fixturePath = path.resolve(__dirname, '../fixtures/realistic_room.json');
  const rawFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  it('validates the canonical realistic room fixture without schema errors', () => {
    const manifest = ProjectManifestSchema.parse(rawFixture);

    expect(manifest.schemaVersion).toBe('1.0.0');
    expect(manifest.id).toBe('proj_living_room_01');
    expect(manifest.name).toBe('Modern Living & Dining Room');

    // 1. Scan asset checks
    expect(manifest.scan.format).toBe('sog');
    expect(manifest.scan.scanToScene).toHaveLength(16);
    expect(manifest.scan.scaleSource).toBe('sensor');

    // 2. Room interpretation checks (2 doors, 1 window, 6 detections)
    const { interpretation } = manifest;
    expect(interpretation.provenance).toBe('auto');
    expect(interpretation.walls).toHaveLength(4);

    const doors = interpretation.openings.filter((o) => o.kind === 'door');
    const windows = interpretation.openings.filter((o) => o.kind === 'window');
    expect(doors).toHaveLength(2);
    expect(windows).toHaveLength(1);
    expect(interpretation.openings).toHaveLength(3);

    expect(interpretation.detections).toHaveLength(6);
    for (const det of interpretation.detections) {
      expect(det.provenance).toBe('auto');
      expect(det.obb.center).toHaveLength(3);
      expect(det.obb.size).toHaveLength(3);
      expect(typeof det.obb.yaw).toBe('number');
      expect(det.confidence).toBeGreaterThanOrEqual(0);
      expect(det.confidence).toBeLessThanOrEqual(1);
    }

    // 3. Mask regions check
    expect(manifest.maskRegions).toHaveLength(6);

    // 4. Measured GLB asset references check
    expect(manifest.assets).toHaveLength(5);
    for (const asset of manifest.assets) {
      expect(asset.format).toBe('glb');
      expect(asset.dimensions.width).toBeGreaterThan(0);
      expect(asset.dimensions.height).toBeGreaterThan(0);
      expect(asset.dimensions.depth).toBeGreaterThan(0);
    }

    // 5. Variants and active variant
    expect(manifest.variants).toHaveLength(1);
    expect(manifest.activeVariantId).toBe('var_baseline');
  });

  it('completes a round-trip serialization and re-parsing losslessly', () => {
    const parsed1 = ProjectManifestSchema.parse(rawFixture);
    const serialized = JSON.stringify(parsed1);
    const parsed2 = ProjectManifestSchema.parse(JSON.parse(serialized));

    expect(parsed2).toEqual(parsed1);
  });

  it('validates EditProposal schema for all operations (replace, add, move, remove)', () => {
    const validProposal = {
      id: 'prop_sofa_replace_01',
      op: 'replace' as const,
      targetNodeId: 'item_sofa_01',
      asset: {
        source: 'catalog' as const,
        url: '/assets/models/designer_sofa.glb',
        dimensions: { width: 2.3, height: 0.95, depth: 1.0 },
      },
      transform: {
        position: [4.0, 0.0, 4.5] as [number, number, number],
        rotationY: 0.0,
        scale: [1.0, 1.0, 1.0] as [number, number, number],
      },
      rationale: 'Replace scanned sofa with high-fidelity catalog asset within boundary.',
      validation: {
        ok: true,
        violations: [],
      },
      status: 'pending' as const,
    };

    const parsed = EditProposalSchema.parse(validProposal);
    expect(parsed.id).toBe('prop_sofa_replace_01');
    expect(parsed.op).toBe('replace');
    expect(parsed.validation.ok).toBe(true);

    // Remove op without asset or transform
    const removeProposal = {
      id: 'prop_remove_02',
      op: 'remove' as const,
      targetNodeId: 'item_chair_left',
      rationale: 'Clear walkway near balcony door.',
      validation: {
        ok: false,
        violations: [
          {
            rule: 'MIN_CLEARANCE',
            severity: 'warning' as const,
            detail: 'Removing armchair increases clearance to 1.8m.',
            nodeIds: ['item_chair_left', 'door_balcony'],
          },
        ],
      },
      status: 'pending' as const,
    };

    const parsedRemove = EditProposalSchema.parse(removeProposal);
    expect(parsedRemove.op).toBe('remove');
    expect(parsedRemove.validation.violations).toHaveLength(1);
    expect(parsedRemove.validation.violations[0].severity).toBe('warning');
  });

  it('rejects invalid contracts schemas with strict errors', () => {
    // Missing required scanToScene 16-number matrix
    const invalidScan = {
      url: '/scan.sog',
      format: 'sog',
      scanToScene: [1, 0, 0], // Only 3 elements instead of 16
      scaleSource: 'sensor',
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    };
    expect(() => ScanAssetSchema.parse(invalidScan)).toThrow();

    // Invalid opening kind
    const invalidOpening = {
      id: 'open_1',
      wallId: 'wall_1',
      kind: 'skylight', // Invalid kind
      offset: 1,
      width: 1,
      height: 2,
      sill: 0,
      confidence: 0.9,
      provenance: 'auto',
    };
    expect(() => RoomInterpretationSchema.shape.openings.element.parse(invalidOpening)).toThrow();
  });
});
