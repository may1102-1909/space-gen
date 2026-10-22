import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { screenshotPath, waitForE2EHooks } from './support/artifacts';
import { API_URL, getProject } from './support/projects';

// N1: upload a splat → conversion job → review → build editable room → save → reload, on the real backend.
const BACKEND_DIR = path.join(__dirname, '..', '..', '..', 'backend');
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

type SnapshotNode = { type: string; url?: string; metadata?: { scanToScene?: number[]; interpretation?: { kind: string } } };

/** The T10 synthetic "rectangle" room (5 x 4 x 2.6 m, tilted 8°, yawed 27°) as a renderable 3DGS PLY. */
function syntheticRoomPly(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spacegen-splat-')), 'synthetic-room.ply');
  execFileSync('python', ['-m', 'tests.synthetic_rooms', file], { cwd: BACKEND_DIR });
  return file;
}

async function openProject(page: Page, id: string) {
  await page.goto(`/editor/${id}`, { waitUntil: 'domcontentloaded' });
  await waitForE2EHooks(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

async function frameRoom(page: Page) {
  await page.waitForFunction(() => (window.__spacegenSplat?.numSplats() ?? 0) > 0, undefined, { timeout: 60000 });
  const bounds = await page.evaluate(() => window.__spacegenSplat!.bounds());
  expect(bounds).not.toBeNull();
  const { min, max } = bounds!;
  const center: [number, number, number] = [(min[0] + max[0]) / 2, 0.8, (min[2] + max[2]) / 2];
  const eye: [number, number, number] = [center[0] + 1.5, 9, center[2] + 8];
  await page.evaluate(([p, t]) => window.__spacegenE2E!.setCamera(p, t), [eye, center]);
  await page.waitForTimeout(1500);
}

test('splat import: upload .ply → conversion → review 4 walls → build editable room → save → reload', async ({ page, request }) => {
  test.slow();
  const created = await request.post(`${API_URL}/api/projects`, { data: { name: 'Splat import room' } });
  expect(created.status(), await created.text()).toBe(201);
  const projectId = (await created.json()).manifest.id as string;
  const ply = syntheticRoomPly();

  // 1. Import: upload to the project asset store and run the conversion job.
  await openProject(page, projectId);
  await page.getByTitle(/Convert Scan to Editable Space/).click();
  const dialog = page.getByRole('dialog', { name: 'Import scan' });
  await dialog.getByLabel('Splat file').setInputFiles(ply);
  await dialog.getByRole('button', { name: 'Upload & convert' }).click();
  await expect(dialog).toBeHidden({ timeout: 90000 });

  // 2. Review mode opens with the backend's interpretation, auto-levelled.
  const review = page.getByRole('region', { name: 'Scan review' });
  await expect(review).toContainText('4 walls');
  await expect(page.getByRole('button', { name: 'Review scan' })).toHaveAttribute('aria-pressed', 'true');
  await frameRoom(page);

  // 3. Build editable room → Pascal walls/slab/openings.
  await review.getByRole('button', { name: 'Build editable room from scan' }).click();
  const rows = review.getByRole('list', { name: 'Review items' }).locator('li');
  await expect(rows.filter({ hasText: /^Wall / })).toHaveCount(4);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: screenshotPath('splat-import.png') });

  // 4. Save and check what the backend persisted.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const saved = await getProject(request, projectId);
  const nodes = Object.values(saved.manifest.sceneSnapshot.nodes as Record<string, SnapshotNode>);
  const walls = nodes.filter((n) => n.type === 'wall' && n.metadata?.interpretation?.kind === 'wall');
  expect(walls).toHaveLength(4);
  expect(nodes.filter((n) => n.type === 'slab')).toHaveLength(1);
  const scans = nodes.filter((n) => n.type === 'scan');
  expect(scans).toHaveLength(1);
  expect(scans[0].url!.startsWith(`${API_URL}/api/projects/${projectId}/assets/`), scans[0].url).toBe(true);
  expect(scans[0].url!.endsWith('.ply')).toBe(true);
  expect(scans[0].metadata!.scanToScene, 'auto-level applied the suggested scanToScene').not.toEqual(IDENTITY);
  expect(saved.manifest.scan.url).toBe(scans[0].url);
  expect(saved.manifest.scan.format).toBe('ply');
  expect(saved.manifest.interpretation.walls).toHaveLength(4);
  expect((await request.get(scans[0].url!)).status()).toBe(200);

  // 5. Reload: the editable room is still there and the scan renders.
  await openProject(page, projectId);
  await page.getByRole('button', { name: 'Review scan' }).click();
  await expect(page.getByRole('region', { name: 'Scan review' }).getByRole('list', { name: 'Review items' }).locator('li').filter({ hasText: /^Wall / })).toHaveCount(4);
  await page.waitForFunction(() => (window.__spacegenSplat?.numSplats() ?? 0) > 0, undefined, { timeout: 60000 });
});
