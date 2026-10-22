import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useScene } from '@pascal-app/core';
import { ProjectManifestSchema } from '@/lib/contracts';
import { applyInterpretationToScene } from '@/lib/pascal/scanConverter';
import { updateNodeData } from '@/lib/pascal/nodes';
import { errorCm, formatArea, formatMeasurement } from '@/lib/measurement/accuracy';
import { extractDrawingModel } from '@/lib/drawings/model';
import { renderPlanSvg, wallChain } from '@/lib/drawings/plan';
import { elevationLayout, renderElevationSvg } from '@/lib/drawings/elevation';

const manifest = ProjectManifestSchema.parse(
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/realistic_room.json'), 'utf-8')),
);
const sheet = { scale: 50 as const, projectName: manifest.name, date: '2026-10-22' };
const model = () => extractDrawingModel(useScene.getState().nodes);
const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');
const values = (doc: Document, role: string, id?: string) =>
  [...doc.querySelectorAll(`[data-kind="dimension"][data-role="${role}"]${id ? `[data-for="${id}"]` : ''}`)].map((g) => Number(g.getAttribute('data-value')));

describe('drawings from the converted realistic_room scene', () => {
  beforeEach(() => {
    applyInterpretationToScene(manifest.interpretation, { scan: manifest.scan, maskRegions: manifest.maskRegions });
  });
  afterEach(() => {
    useScene.getState().clearScene();
    (useScene as any).temporal.getState().clear();
  });

  it('models four walls with lengths, interior sides and mitred outlines', () => {
    const m = model();
    expect(m.scaleSource).toBe('sensor');
    expect(m.levelName).toBe('Scanned level');
    expect(m.walls).toHaveLength(4);
    const byId = Object.fromEntries(m.walls.map((w) => [w.id, w]));
    expect(byId.wall_north.length).toBeCloseTo(8);
    expect(byId.wall_east.length).toBeCloseTo(6);
    expect(byId.wall_north.inward).toEqual([expect.closeTo(0), expect.closeTo(1)]);
    expect(byId.wall_east.inward).toEqual([expect.closeTo(-1), expect.closeTo(0)]);
    // 0.2 m walls on the centreline: outer extent 8.2 x 6.2, inside face 7.8 long.
    expect(m.bounds.minX).toBeCloseTo(-0.1);
    expect(m.bounds.maxX).toBeCloseTo(8.1);
    expect(m.bounds.maxZ).toBeCloseTo(6.1);
    expect(byId.wall_north.faceStart).toBeCloseTo(0.1);
    expect(byId.wall_north.faceEnd).toBeCloseTo(7.9);
  });

  it('hosts the three openings at their centre offsets', () => {
    const openings = model().walls.flatMap((w) => w.openings);
    expect(openings.map((o) => o.id).sort()).toEqual(['door_balcony', 'door_main', 'window_north']);
    const get = (id: string) => openings.find((o) => o.id === id)!;
    expect(get('door_main')).toMatchObject({ wallId: 'wall_south', kind: 'door', center: 2, width: 0.9 });
    expect(get('door_balcony')).toMatchObject({ wallId: 'wall_east', center: 1.5, width: 1.2 });
    expect(get('window_north').sill).toBeCloseTo(0.9);
    expect(get('window_north').center).toBeCloseTo(3);
    // Chain breaks are the jambs: centre ± width / 2.
    const north = model().walls.find((w) => w.id === 'wall_north')!;
    expect(wallChain(north)).toEqual([0, 2, 4, 8]);
  });

  it('renders a plan with walls, openings, dimensions and room area as estimates', () => {
    const svg = renderPlanSvg(model(), sheet);
    const doc = parse(svg);
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelectorAll('[data-kind="wall"]')).toHaveLength(4);
    const ops = [...doc.querySelectorAll('[data-kind="opening"]')];
    expect(ops).toHaveLength(3);
    expect(ops.find((o) => o.getAttribute('data-id') === 'door_main')!.getAttribute('data-center')).toBe('2.0000');

    expect(values(doc, 'wall-length').sort()).toEqual([6, 6, 8, 8]);
    expect(values(doc, 'chain', 'wall_north')).toEqual([2, 2, 4]);
    expect(values(doc, 'chain', 'wall_south').reduce((a, b) => a + b, 0)).toBeCloseTo(8);
    expect(values(doc, 'overall-width')[0]).toBeCloseTo(8.2);
    expect(values(doc, 'overall-depth')[0]).toBeCloseTo(6.2);
    expect(values(doc, 'opening-width').sort()).toEqual([0.9, 1.2, 2]);

    const room = doc.querySelector('[data-kind="room"]')!;
    expect(Number(room.getAttribute('data-area'))).toBeCloseTo(48);
    expect(room.textContent).toContain(formatArea(48, 'sensor'));

    // Never an exact number: labels come from the estimate formatter.
    expect(svg).toContain('≈ 8.0 m');
    expect(svg).toContain(`(±${errorCm(8, 'sensor')} cm est.)`);
    expect(doc.querySelector('[data-role="accuracy-note"]')!.textContent).toBe(
      `Dimensions estimated ±${errorCm(8.2, 'sensor')} cm from scan (scale source: sensor).`,
    );
    expect(svg).toContain('1:50');
    expect(doc.documentElement.textContent).toContain(manifest.name);
    expect(svg).toContain('width="');
    // 1:50 sheet in mm: the 8.2 m outline alone is 164 mm wide.
    expect(parseFloat(doc.documentElement.getAttribute('width')!)).toBeGreaterThan(164);
  });

  it('lays out each interior elevation from inside the room', () => {
    const m = model();
    const north = elevationLayout(m, m.walls.find((w) => w.id === 'wall_north')!);
    expect(north.faceLength).toBeCloseTo(7.8);
    expect(north.ceilingHeight).toBeCloseTo(2.8);
    expect(north.openings).toHaveLength(1);
    // Looking north from inside, west (wall start) is on the left: jamb at 2.0 - 0.1 m face inset.
    expect(north.openings[0].left).toBeCloseTo(1.9);
    expect(north.openings[0].right).toBeCloseTo(3.9);
    expect(north.openings[0].sill).toBeCloseTo(0.9);
    expect(north.openings[0].head).toBeCloseTo(2.3);

    // South wall runs east -> west, which is left -> right when facing it from inside.
    const south = elevationLayout(m, m.walls.find((w) => w.id === 'wall_south')!);
    expect(south.openings[0].left).toBeCloseTo(2 - 0.45 - 0.1);

    const doc = parse(renderElevationSvg(m, 'wall_north', sheet));
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(values(doc, 'face-length')[0]).toBeCloseTo(7.8);
    expect(values(doc, 'chain', 'wall_north').map((v) => Number(v.toFixed(3)))).toEqual([1.9, 2, 3.9]);
    expect(values(doc, 'sill', 'window_north')[0]).toBeCloseTo(0.9);
    expect(values(doc, 'head', 'window_north')[0]).toBeCloseTo(2.3);
    expect(values(doc, 'ceiling-height')[0]).toBeCloseTo(2.8);
    expect(doc.documentElement.textContent).toContain(formatMeasurement(2.8, 'sensor').split(' (')[0]);
  });

  it('follows scene edits and hides rejected walls', () => {
    updateNodeData('wall_east', { start: [7.6, 0], end: [7.6, 6] });
    updateNodeData('wall_north', { end: [7.6, 0] });
    const north = model().walls.find((w) => w.id === 'wall_north')!;
    expect(north.length).toBeCloseTo(7.6);
    updateNodeData('wall_west', { visible: false });
    expect(model().walls).toHaveLength(3);
  });
});
