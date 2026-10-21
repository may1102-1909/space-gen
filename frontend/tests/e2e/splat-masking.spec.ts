import { test, expect, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { screenshotPath, waitForE2EHooks } from './support/artifacts';
import { captureSplatRegion, diffPngs, screenshotSplatOnly } from './support/pixels';

// The chair is moved to (0.5, 0, -4.5): dense splats in the unaligned sample scan with unoccluded lines of sight
// (the scene origin is empty space in that scan), with the fixture's 0.55 x 0.85 x 0.55 m footprint.
const CHAIR_OBB = { center: [0.5, 0.425, -4.5] as [number, number, number], size: [0.55, 0.85, 0.55] as [number, number, number], yaw: 0 };
const TARGET: [number, number, number] = [0.5, 0.425, -4.5];
const CLOSE_VIEW: [[number, number, number], [number, number, number]] = [[0.5, 1.4, -2.9], TARGET];

// Mask must visibly remove splats; undo must restore the pre-replace frame within render noise.
const MASK_MIN_CHANGED = 0.05;
const RESTORE_MAX_CHANGED = 0.01;

async function setCamera(page: Page, [position, target]: [[number, number, number], [number, number, number]]) {
  await page.evaluate(([p, t]) => window.__spacegenE2E!.setCamera(p, t), [position, target] as const);
}

async function maskRegionRect(page: Page) {
  const rect = await page.evaluate((obb) => window.__spacegenE2E!.projectObb(obb), CHAIR_OBB);
  const viewport = page.viewportSize()!;
  expect(rect.width, 'mask box must project to a usable on-screen area').toBeGreaterThan(40);
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
  return rect;
}

test.describe('T08: Splat Masking & Replacement Verification', () => {
  test('replacing a chair masks the splat inside its OBB; undo restores it; redo re-applies; ghost and resize work', async ({ page }) => {
    test.slow();

    await page.route('**/api/reconstruction/furniture-catalog', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'chair-original-e2e', name: 'Original Scanned Chair', category: 'chair', style: 'Classic', dimensions: { width_m: 0.55, depth_m: 0.55, height_m: 0.85 }, color_preview: '#888888', description: 'Original Chair Fixture', filename: 'chair.glb', url: '/samples/models/chair.glb' },
          { id: 'chair-replacement-e2e', name: 'Modern Replacement Chair', category: 'chair', style: 'Contemporary', dimensions: { width_m: 0.6, depth_m: 0.6, height_m: 0.9 }, color_preview: '#e07a5f', description: 'Replacement Chair Fixture', filename: 'chair.glb', url: '/samples/models/chair.glb' },
        ]),
      })
    );

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForE2EHooks(page);

    // 1. Load the sample room scan so there is a splat to mask.
    await page.getByRole('button', { name: 'Import / Scenes' }).click({ force: true });
    await page.getByRole('button', { name: /import 3d model/i }).click({ force: true });
    await page.getByRole('button', { name: 'Load verified sample room scan' }).click({ force: true });
    await expect(page.getByText('Room scan')).toBeVisible();

    // 2. Place the original chair (selected after placement).
    await page.getByRole('button', { name: 'Add Catalog Item' }).click();
    await page.getByRole('button', { name: /Original Scanned Chair/i }).click();
    await expect(page.getByRole('button', { name: /Replace \/ Add Catalog Item/i })).toBeVisible();
    for (const [axis, value] of [['X', '0.5'], ['Z', '-4.5']] as const) {
      const input = page.getByRole('spinbutton', { name: `Pos ${axis} (m)` });
      await input.fill(value);
      await input.blur();
      await expect(input).toHaveValue(value);
    }

    await page.waitForFunction(() => (window.__spacegenSplat?.numSplats() ?? 0) > 0, undefined, { timeout: 60000 });
    const splatsInBox = await page.evaluate((obb) => window.__spacegenSplat!.countInside(obb), CHAIR_OBB);
    expect(splatsInBox, 'precondition: the chair OBB must contain scanned splats').toBeGreaterThan(1000);
    expect(await page.evaluate(() => window.__spacegenSplat!.editCount())).toBe(0);

    await setCamera(page, CLOSE_VIEW);
    await page.waitForTimeout(2000); // first sort for the new viewpoint
    const rect = await maskRegionRect(page);
    const before = await captureSplatRegion(page, rect);
    await screenshotSplatOnly(page, 'chair-mask-splat-only-before.png');

    // 3. Replace → mask applied in the same undo step.
    await page.getByRole('button', { name: /Replace \/ Add Catalog Item/i }).click();
    await page.getByRole('button', { name: /Modern Replacement Chair/i }).click();
    await expect(page.getByRole('button', { name: /Modern Replacement Chair/i }).first()).toBeVisible();
    await expect(page.getByText('Splat Mask')).toBeVisible();
    await expect(page.getByText('Masked (0%)')).toBeVisible();
    expect(await page.evaluate(() => window.__spacegenSplat!.editCount())).toBe(1);

    const masked = await captureSplatRegion(page, rect);
    await screenshotSplatOnly(page, 'chair-mask-splat-only-after.png');
    const maskedDiff = await diffPngs(page, before, masked);
    console.log('replace vs before', maskedDiff);
    expect(maskedDiff.changedFraction, 'mask must remove splat pixels inside the OBB').toBeGreaterThan(MASK_MIN_CHANGED);

    // 4. Undo restores the original chair and the unmasked splat.
    const undo = page.getByRole('banner').getByTitle('Undo (Ctrl+Z)');
    const redo = page.getByRole('banner').getByTitle('Redo (Ctrl+Y)');
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(page.getByRole('button', { name: /Original Scanned Chair/i }).first()).toBeVisible();
    await expect(page.getByText('Masked (0%)')).toHaveCount(0);
    expect(await page.evaluate(() => window.__spacegenSplat!.editCount())).toBe(0);
    const undone = await captureSplatRegion(page, rect);
    const undoDiff = await diffPngs(page, before, undone);
    console.log('undo vs before', undoDiff);
    expect(undoDiff.changedFraction, 'undo must restore the unmasked splat').toBeLessThan(RESTORE_MAX_CHANGED);

    // 5. Redo re-applies replacement and mask.
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(page.getByRole('button', { name: /Modern Replacement Chair/i }).first()).toBeVisible();
    await expect(page.getByText('Masked (0%)')).toBeVisible();
    const redone = await captureSplatRegion(page, rect);
    const redoDiff = await diffPngs(page, before, redone);
    console.log('redo vs before', redoDiff);
    expect(redoDiff.changedFraction).toBeGreaterThan(MASK_MIN_CHANGED);
    expect((await diffPngs(page, masked, redone)).changedFraction, 'redo matches the first masked frame').toBeLessThan(RESTORE_MAX_CHANGED);

    // 6. Four distinct camera angles of the masked chair (full composited frame).
    const angles: Array<[string, [[number, number, number], [number, number, number]]]> = [
      ['chair-mask-angle-1-front.png', CLOSE_VIEW],
      ['chair-mask-angle-2-perspective.png', [[1.63, 1.4, -3.37], TARGET]],
      ['chair-mask-angle-3-side.png', [[2.1, 1.4, -4.5], TARGET]],
      ['chair-mask-angle-4-back-left.png', [[-0.63, 1.4, -3.37], TARGET]],
    ];
    const hashes = new Set<string>();
    for (const [name, view] of angles) {
      await setCamera(page, view);
      await page.waitForTimeout(800);
      const file = screenshotPath(name);
      await page.screenshot({ path: file });
      hashes.add(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    }
    expect(hashes.size, 'each angle screenshot must differ').toBe(angles.length);

    // 7. Ghost mode shows the original at 25%: a partial change between unmasked and fully masked.
    await setCamera(page, CLOSE_VIEW);
    const ghostToggle = page.getByRole('button', { name: 'Toggle Ghost Mode' });
    await ghostToggle.click();
    await expect(page.getByText('Ghost (25%)')).toBeVisible();
    const ghost = await captureSplatRegion(page, rect);
    await page.screenshot({ path: screenshotPath('chair-mask-ghost-mode.png') });
    const ghostDiff = await diffPngs(page, before, ghost);
    console.log('ghost vs before', ghostDiff);
    expect(ghostDiff.meanAbsDiff).toBeGreaterThan(0);
    expect(ghostDiff.meanAbsDiff, 'ghost keeps more of the original than a full mask').toBeLessThan(maskedDiff.meanAbsDiff);
    await ghostToggle.click();
    await expect(page.getByText('Masked (0%)')).toBeVisible();

    // 8. Mask resize is undoable.
    const widthInput = page.getByRole('spinbutton', { name: 'Mask Width (m)' });
    await expect(widthInput).toHaveValue('0.55');
    await widthInput.fill('0.85');
    await widthInput.blur();
    await expect(widthInput).toHaveValue('0.85');
    await undo.click();
    await expect(widthInput).toHaveValue('0.55');
  });
});
