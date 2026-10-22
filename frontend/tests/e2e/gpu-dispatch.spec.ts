import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { screenshotPath, waitForE2EHooks } from './support/artifacts';
import { API_URL, getProject } from './support/projects';

// N2/N3 on the real backend with GPU_WORKER_MODE=fake (playwright.config.ts): import a synthetic splat
// with a sofa, table and lamp → structure → objects (in-process worker, CPU pipeline, real GLBs) →
// Pascal items with masks → move one → save → reload.
const BACKEND_DIR = path.join(__dirname, '..', '..', '..', 'backend');

type SnapshotNode = {
  type: string;
  name?: string;
  position?: number[];
  asset?: { src: string; dimensions: number[] };
  metadata?: { maskRegionId?: string; segmentedObject?: { id: string; label: string }; maskRegions?: { id: string; enabled: boolean }[] };
};

function syntheticFurnishedRoomPly(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spacegen-objects-')), 'furnished-room.ply');
  execFileSync('python', ['-m', 'gpu_worker.synthetic', file], { cwd: BACKEND_DIR });
  return file;
}

async function openProject(page: Page, id: string) {
  await page.goto(`/editor/${id}`, { waitUntil: 'domcontentloaded' });
  await waitForE2EHooks(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

function nodesOf(manifest: { sceneSnapshot: Record<string, unknown> }) {
  return Object.values(manifest.sceneSnapshot.nodes as Record<string, SnapshotNode>);
}

test('gpu dispatch (fake worker): splat import → objects stage → Pascal items with masks → move → save → reload', async ({ page, request }) => {
  test.slow();
  const created = await request.post(`${API_URL}/api/projects`, { data: { name: 'Furnished room' } });
  expect(created.status(), await created.text()).toBe(201);
  const projectId = (await created.json()).manifest.id as string;

  await openProject(page, projectId);
  await page.getByTitle(/Convert Scan to Editable Space/).click();
  const dialog = page.getByRole('dialog', { name: 'Import scan' });
  await dialog.getByLabel('Splat file').setInputFiles(syntheticFurnishedRoomPly());
  await dialog.getByRole('button', { name: 'Upload & convert' }).click();

  // The objects stage reports live progress from the worker.
  await expect(dialog.getByTestId('stage-objects')).toHaveAttribute('data-status', 'running', { timeout: 60000 });
  await expect(dialog.getByTestId('objects-detail')).toContainText(/Segmenting on GPU|Downloading \d+\/3 meshes/, { timeout: 90000 });
  await expect(dialog).toBeHidden({ timeout: 180000 });

  // One Pascal item per separated object, listed in the scene panel.
  await expect(page.getByText('Furniture (3)')).toBeVisible();
  const sofaRow = page.getByRole('button', { name: /^Sofa/ });
  await expect(sofaRow).toBeVisible();
  await page.getByRole('button', { name: /^Table/ }).waitFor();
  await page.getByRole('button', { name: /^Lamp/ }).waitFor();

  await page.waitForFunction(() => (window.__spacegenSplat?.numSplats() ?? 0) > 0, undefined, { timeout: 60000 });
  await page.evaluate(() => window.__spacegenE2E!.setCamera([1.5, 5.5, 6.5], [0, 0.4, 0.3]));

  // Move the sofa with the existing item tools.
  await sofaRow.click();
  const x = page.getByRole('spinbutton', { name: 'Pos X (m)' });
  await expect(x).toBeVisible();
  const originalX = Number(await x.inputValue());
  const movedX = Math.round((originalX + 0.5) * 100) / 100;
  await x.fill(String(movedX));
  await x.blur();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: screenshotPath('gpu-dispatch-objects.png') });

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const saved = await getProject(request, projectId);
  const items = nodesOf(saved.manifest).filter((n) => n.type === 'item' && n.metadata?.segmentedObject);
  expect(items.map((n) => n.metadata!.segmentedObject!.label).sort()).toEqual(['lamp', 'sofa', 'table']);
  const masks = saved.manifest.maskRegions;
  for (const item of items) {
    expect(item.asset!.src.startsWith(`${API_URL}/api/projects/${projectId}/assets/`)).toBe(true);
    expect(item.asset!.src.endsWith('.glb')).toBe(true);
    expect((await request.get(item.asset!.src)).status()).toBe(200);
    expect(masks.find((m) => m.id === item.metadata!.maskRegionId)?.enabled).toBe(true);
  }
  const sofa = items.find((n) => n.metadata!.segmentedObject!.label === 'sofa')!;
  expect(sofa.position![0]).toBeCloseTo(movedX, 2);
  expect(sofa.asset!.dimensions[0]).toBeGreaterThan(1.8); // the synthetic sofa is 2.0 m wide
  expect(saved.manifest.assets.filter((a) => a.source === 'segmented')).toHaveLength(3);

  // Reload: items, the move and the masks persist.
  await openProject(page, projectId);
  await expect(page.getByText('Furniture (3)')).toBeVisible();
  await page.getByRole('button', { name: /^Sofa/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Pos X (m)' })).toHaveValue(String(movedX));
  const reloaded = await getProject(request, projectId);
  expect(reloaded.manifest.maskRegions).toHaveLength(3);
});
