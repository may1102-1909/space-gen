import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { screenshotPath, waitForE2EHooks } from './support/artifacts';
import { captureSplatRegion, diffPngs } from './support/pixels';
import { API_URL, CHAIR_GLB, DETECTED_CHAIR, createPhase1Fixture, getProject } from './support/projects';

// T09: the Phase 1 loop against the real FastAPI backend (started by playwright.config.ts).
test.use({ video: 'on' });

const VIEW: [[number, number, number], [number, number, number]] = [[0.5, 1.4, -2.9], DETECTED_CHAIR.obb.center];
const MASK_MIN_CHANGED = 0.05;
const RESTORE_MAX_CHANGED = 0.01;

async function frameView(page: Page) {
  await page.evaluate(([p, t]) => window.__spacegenE2E!.setCamera(p, t), VIEW);
  await page.waitForTimeout(1500);
  return page.evaluate((obb) => window.__spacegenE2E!.projectObb(obb), DETECTED_CHAIR.obb);
}

async function openProject(page: Page, id: string) {
  await page.goto(`/editor/${id}`, { waitUntil: 'domcontentloaded' });
  await waitForE2EHooks(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.waitForFunction(() => (window.__spacegenSplat?.numSplats() ?? 0) > 0, undefined, { timeout: 60000 });
}

const editCount = (page: Page) => page.evaluate(() => window.__spacegenSplat!.editCount());

test('phase 1: select detected chair → replace with GLB → mask → undo/redo → save → reload', async ({ page, request }) => {
  test.slow();
  const projectId = `phase1-${Date.now()}`;
  await createPhase1Fixture(request, projectId);

  // 1. Open the fixture project.
  await openProject(page, projectId);
  expect(await page.evaluate((obb) => window.__spacegenSplat!.countInside(obb), DETECTED_CHAIR.obb), 'precondition: scanned splats inside the chair OBB').toBeGreaterThan(1000);
  const rect = await frameView(page);
  await page.screenshot({ path: screenshotPath('phase1-01-open.png') });

  // 2. Select the detected chair.
  await page.getByRole('button', { name: /Detected Chair/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Pos X (m)' })).toHaveValue('0.5');
  await expect(page.getByRole('spinbutton', { name: 'Pos Z (m)' })).toHaveValue('-4.5');
  const before = await captureSplatRegion(page, rect);
  await page.screenshot({ path: screenshotPath('phase1-02-selected.png') });

  // 3. Replace it with an uploaded GLB → stored via POST /api/projects/{id}/assets, mask applied.
  await page.getByLabel('Upload GLB').setInputFiles({ name: 'Modern Chair.glb', mimeType: 'model/gltf-binary', buffer: fs.readFileSync(CHAIR_GLB) });
  await expect(page.getByRole('button', { name: /Modern Chair/ }).first()).toBeVisible();
  await expect(page.getByText('Masked (0%)')).toBeVisible();
  expect(await editCount(page)).toBe(1);
  const masked = await captureSplatRegion(page, rect);
  const maskedDiff = await diffPngs(page, before, masked);
  console.log('replace vs before', maskedDiff);
  expect(maskedDiff.changedFraction).toBeGreaterThan(MASK_MIN_CHANGED);
  await page.screenshot({ path: screenshotPath('phase1-03-replaced-masked.png') });

  // 4. Undo → detected chair back, mask gone. 5. Redo → replacement and mask back.
  const undo = page.getByRole('banner').getByTitle('Undo (Ctrl+Z)');
  const redo = page.getByRole('banner').getByTitle('Redo (Ctrl+Y)');
  await undo.click();
  await expect(page.getByRole('button', { name: /Detected Chair/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Modern Chair/ })).toHaveCount(0);
  expect(await editCount(page)).toBe(0);
  expect((await diffPngs(page, before, await captureSplatRegion(page, rect))).changedFraction).toBeLessThan(RESTORE_MAX_CHANGED);
  await page.screenshot({ path: screenshotPath('phase1-04-undo.png') });
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(page.getByRole('button', { name: /Modern Chair/ }).first()).toBeVisible();
  expect(await editCount(page)).toBe(1);
  await expect(redo).toBeDisabled();

  // 6. Save and verify what the backend persisted.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const saved = await getProject(request, projectId);
  const items = Object.values(saved.manifest.sceneSnapshot.nodes as Record<string, { type: string; name: string; position: number[]; asset?: { src: string; dimensions: number[] } }>).filter((n) => n.type === 'item');
  expect(items).toHaveLength(1);
  const [item] = items;
  expect(item.name).toBe('Modern Chair');
  expect(item.position).toEqual(DETECTED_CHAIR.position);
  expect(item.asset!.src.startsWith(`${API_URL}/api/projects/${projectId}/assets/`), item.asset!.src).toBe(true);
  expect(item.asset!.src.startsWith('blob:')).toBe(false);
  const assetRef = saved.manifest.assets.find((a) => a.url === item.asset!.src);
  expect(assetRef, 'AssetRef recorded for the uploaded GLB').toBeTruthy();
  expect(assetRef!.source).toBe('upload');
  expect(assetRef!.dimensions.width).toBeGreaterThan(0);
  const glb = await request.get(item.asset!.src);
  expect(glb.status()).toBe(200);
  expect(glb.headers()['content-type']).toContain('model/gltf-binary');
  expect(saved.manifest.maskRegions).toHaveLength(1);
  expect(saved.manifest.maskRegions[0].obb).toEqual(DETECTED_CHAIR.obb);

  // 7. Reload: same placement, same mask, item visible.
  await openProject(page, projectId);
  await page.getByRole('button', { name: /Modern Chair/ }).first().click();
  await expect(page.getByRole('spinbutton', { name: 'Pos X (m)' })).toHaveValue('0.5');
  await expect(page.getByRole('spinbutton', { name: 'Pos Z (m)' })).toHaveValue('-4.5');
  await expect(page.getByText('Masked (0%)')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Mask Width (m)' })).toHaveValue(String(DETECTED_CHAIR.dimensions[0]));
  expect(await editCount(page)).toBe(1);
  const reloadRect = await frameView(page);
  const reloadedSplat = await captureSplatRegion(page, reloadRect);
  expect((await diffPngs(page, masked, reloadedSplat)).changedFraction, 'reloaded mask matches the saved one').toBeLessThan(RESTORE_MAX_CHANGED);
  // The replacement GLB is drawn: the composited frame differs from the splat layer alone.
  const composited = await page.screenshot({ clip: { x: Math.round(reloadRect.x), y: Math.round(reloadRect.y), width: Math.round(reloadRect.width), height: Math.round(reloadRect.height) } });
  expect((await diffPngs(page, reloadedSplat, composited)).changedFraction, 'replacement item visible after reload').toBeGreaterThan(0.02);
  // Undo history starts at the loaded state.
  await expect(page.getByRole('banner').getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  await page.screenshot({ path: screenshotPath('phase1-05-reloaded.png') });

  await page.close();
  await page.video()?.saveAs(screenshotPath('phase1-editor-loop.webm'));
});
