import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';
import { ProjectManifestSchema, type ProjectManifest } from '@/lib/contracts';

/** The FastAPI backend that playwright.config.ts starts on a throwaway DATA_DIR. */
export const API_URL = process.env.E2E_API_URL || 'http://127.0.0.1:8765';

export const CHAIR_GLB = path.join(__dirname, '..', '..', '..', 'public', 'samples', 'models', 'chair.glb');

/**
 * Dense, unoccluded spot in the (unaligned) sample scan; the origin of that scan is empty space.
 * Dimensions are chair.glb's measured bounds, so the mask matches the rendered proxy.
 */
export const DETECTED_CHAIR = {
  position: [0.5, 0, -4.5] as [number, number, number],
  dimensions: [0.92, 0.93, 0.86] as [number, number, number],
  obb: { center: [0.5, 0.465, -4.5] as [number, number, number], size: [0.92, 0.93, 0.86] as [number, number, number], yaw: 0 },
};

export interface StoredProject {
  manifest: ProjectManifest;
  revision: number;
}

export async function getProject(request: APIRequestContext, id: string): Promise<StoredProject> {
  const response = await request.get(`${API_URL}/api/projects/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  const body = await response.json();
  return { manifest: ProjectManifestSchema.parse(body.manifest), revision: body.revision };
}

export async function putProject(request: APIRequestContext, manifest: ProjectManifest, revision: number): Promise<StoredProject> {
  const response = await request.put(`${API_URL}/api/projects/${manifest.id}`, { data: manifest, headers: { 'If-Match': `"${revision}"` } });
  expect(response.ok(), await response.text()).toBe(true);
  const body = await response.json();
  return { manifest: ProjectManifestSchema.parse(body.manifest), revision: body.revision };
}

/**
 * Creates a project holding the sample scan and one detected chair (a Pascal item linked to an
 * interpretation detection), with the chair's proxy GLB stored in the project's asset store.
 */
export async function createPhase1Fixture(request: APIRequestContext, id: string): Promise<StoredProject> {
  const now = new Date().toISOString();
  const manifest: ProjectManifest = {
    schemaVersion: '1.0.0',
    id,
    name: 'Phase 1 fixture room',
    scan: {
      url: '/Hurstville_Museum_Gallery.sog',
      format: 'sog',
      scanToScene: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      scaleSource: 'none',
      bounds: { min: [-4.97, -1.45, -8.34], max: [2.63, 2.4, 0.39] },
    },
    interpretation: {
      provenance: 'auto',
      floor: { normal: [0, 1, 0], constant: 0, provenance: 'auto' },
      ceilingHeight: 2.5,
      outline: [],
      walls: [],
      openings: [],
      detections: [{ id: 'det_chair_01', category: 'chair', label: 'Detected Chair', obb: DETECTED_CHAIR.obb, confidence: 0.9, maskRegionId: null, status: 'auto', provenance: 'auto' }],
    },
    maskRegions: [],
    sceneSnapshot: {},
    assets: [],
    history: [],
    variants: [{ id: 'default', name: 'Default', sceneSnapshot: {}, createdAt: now }],
    activeVariantId: 'default',
  };
  const created = await request.post(`${API_URL}/api/projects`, { data: manifest });
  expect(created.status(), await created.text()).toBe(201);

  const upload = await request.post(`${API_URL}/api/projects/${id}/assets`, {
    multipart: { file: { name: 'detected-chair.glb', mimeType: 'model/gltf-binary', buffer: fs.readFileSync(CHAIR_GLB) } },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const chairSrc = new URL((await upload.json()).url, API_URL).href;

  const scanNode = {
    object: 'node', id: 'scan_fixture', type: 'scan', name: 'Room scan', parentId: null, url: manifest.scan.url,
    visible: true, opacity: 100, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, layers: { model: false },
    metadata: { format: 'sog', scanToScene: manifest.scan.scanToScene, maskRegions: [] },
  };
  const chairNode = {
    object: 'node', id: 'item_detected_chair', type: 'item', name: 'Detected Chair', parentId: null, visible: true,
    position: DETECTED_CHAIR.position, rotation: [0, 0, 0], scale: [1, 1, 1], children: [],
    metadata: { detectionId: 'det_chair_01' },
    asset: {
      id: 'asset_detected_chair', name: 'Detected Chair', category: 'chair', thumbnail: '', source: 'library', src: chairSrc,
      dimensions: DETECTED_CHAIR.dimensions, offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    },
  };
  return putProject(request, {
    ...manifest,
    sceneSnapshot: {
      nodes: { [scanNode.id]: scanNode, [chairNode.id]: chairNode },
      rootNodeIds: [scanNode.id, chairNode.id],
      collections: {},
      materials: {},
      installedPlugins: [],
    },
  }, 1);
}
