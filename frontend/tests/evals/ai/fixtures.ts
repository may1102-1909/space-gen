/**
 * Fixture rooms for the spatial-agent evals: the canonical realistic_room scan fixture and
 * two synthetic rooms built from Pascal nodes, plus a merged public + backend catalog.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import catalogManifest from '@/public/catalog/catalogManifest.json';
import { RoomInterpretationSchema, type RoomInterpretation } from '@/lib/contracts';
import { catalogFromBackend, catalogFromPublicManifest, mergeCatalogs, type CatalogEntry } from '@/lib/ai/catalog';
import realisticRoom from '../../fixtures/realistic_room.json';

export interface FixtureRoom {
  id: string;
  nodes: Record<string, unknown>;
  /** Present for scanned rooms; synthetic rooms derive it from Pascal wall/door/slab nodes. */
  interpretation?: RoomInterpretation;
}

const backendCatalogPath = path.resolve(__dirname, '../../../../backend/data/furniture_catalog/catalog.json');

export function loadEvalCatalog(): CatalogEntry[] {
  const backend = JSON.parse(readFileSync(backendCatalogPath, 'utf-8'));
  return mergeCatalogs(catalogFromPublicManifest(catalogManifest), catalogFromBackend(backend, 'http://localhost:8000'));
}

/** realistic_room.json: Pascal snapshot with asset dimensions filled from the manifest's asset list (as createItemNode stores them). */
export function realisticFixture(): FixtureRoom {
  const dims = new Map(realisticRoom.assets.map((a) => [a.url, a.dimensions]));
  const nodes: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(realisticRoom.sceneSnapshot as Record<string, Record<string, unknown>>)) {
    const asset = raw.asset as { src?: string } | undefined;
    const d = asset?.src ? dims.get(asset.src) : undefined;
    nodes[id] = d ? { ...raw, asset: { ...asset, dimensions: [d.width, d.height, d.depth] } } : raw;
  }
  return { id: 'realistic_room', nodes, interpretation: RoomInterpretationSchema.parse(realisticRoom.interpretation) };
}

type V3 = [number, number, number];

function pascalRoom(id: string, w: number, d: number, extra: Record<string, unknown>[]): FixtureRoom {
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, d],
    [0, d],
  ];
  const wallIds = ['wall_n', 'wall_e', 'wall_s', 'wall_w'];
  const nodes: Record<string, unknown> = {
    level_1: { id: 'level_1', type: 'level', name: 'Level', height: 2.7, elevation: 0 },
    slab_1: { id: 'slab_1', type: 'slab', parentId: 'level_1', polygon: corners },
  };
  corners.forEach((c, i) => {
    nodes[wallIds[i]] = { id: wallIds[i], type: 'wall', parentId: 'level_1', start: c, end: corners[(i + 1) % 4], thickness: 0.2, height: 2.7 };
  });
  for (const n of extra) nodes[n.id as string] = n;
  return { id, nodes };
}

const item = (id: string, name: string, category: string, src: string, position: V3, dimensions: V3, yaw = 0) => ({
  id,
  type: 'item',
  name,
  parentId: 'level_1',
  position,
  rotation: [0, yaw, 0],
  scale: [1, 1, 1],
  asset: { src, category, dimensions },
});

/** 5 x 4 m dining room; the south door's center is 1.0 m from the west corner. */
export function diningFixture(): FixtureRoom {
  return pascalRoom('synthetic_dining', 5, 4, [
    { id: 'door_1', type: 'door', wallId: 'wall_s', offset: 4.0, width: 0.9, height: 2.1 },
    item('item_dining_table', 'Oak Dining Table', 'dining_table', '/samples/models/dining_table.glb', [2.5, 0, 2], [1.8, 0.75, 0.9]),
    item('item_chair_1', 'Dining Chair 1', 'chair', '/samples/models/chair.glb', [2.0, 0, 1.15], [0.55, 0.85, 0.55], 0),
    item('item_sideboard', 'Low Sideboard', 'storage', '/samples/models/sideboard.glb', [3.6, 0, 3.6], [1.4, 0.8, 0.45], Math.PI),
  ]);
}

/** 4.2 x 3.8 m bedroom with the bed against the north wall and an armchair in the south-west corner. */
export function bedroomFixture(): FixtureRoom {
  return pascalRoom('synthetic_bedroom', 4.2, 3.8, [
    { id: 'door_1', type: 'door', wallId: 'wall_e', offset: 3.0, width: 0.85, height: 2.1 },
    { id: 'window_1', type: 'window', wallId: 'wall_n', offset: 3.3, width: 1.0, height: 1.2, elevation: 0.9 },
    item('item_bed', 'Queen Bed', 'bed', '/samples/models/bed.glb', [1.6, 0, 1.2], [1.6, 0.6, 2.05]),
    item('item_armchair', 'Reading Armchair', 'armchair', '/samples/models/chair.glb', [0.75, 0, 3.05], [0.8, 0.85, 0.8], 0.6),
  ]);
}

/** Minimal valid GLB (JSON chunk only) whose single box mesh spans `size`, optionally authored in other units. */
export function boxGlb(size: V3, unitsPerMeter = 1): Uint8Array {
  const [w, h, d] = size.map((v) => v * unitsPerMeter);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ children: [1], translation: [0, 0, 0] }, { mesh: 0, translation: [0, h / 2, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ componentType: 5126, count: 8, type: 'VEC3', min: [-w / 2, -h / 2, -d / 2], max: [w / 2, h / 2, d / 2] }],
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, body.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

export function glbDataUrl(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `data:model/gltf-binary;base64,${btoa(bin)}`;
}

/** 1x1 PNG; the fake model's vision answer comes from the case, a real model would need a real photo. */
export const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
