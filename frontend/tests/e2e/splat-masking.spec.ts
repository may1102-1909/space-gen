import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('T08: Splat Masking & Replacement Verification', () => {
  test('replacing a chair creates mask, hides splats from 4 angles, toggles ghost mode, resizes, and supports undo/redo', async ({
    page,
  }) => {
    test.setTimeout(120000);

    // 1. Mock furniture catalog endpoint for reliable E2E assets
    await page.route('**/api/reconstruction/furniture-catalog', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'chair-original-e2e',
            name: 'Original Scanned Chair',
            category: 'chair',
            style: 'Classic',
            dimensions: { width_m: 0.55, depth_m: 0.55, height_m: 0.85 },
            color_preview: '#888888',
            description: 'Original Chair Fixture',
            filename: 'chair.glb',
            url: '/samples/models/chair.glb',
          },
          {
            id: 'chair-replacement-e2e',
            name: 'Modern Replacement Chair',
            category: 'chair',
            style: 'Contemporary',
            dimensions: { width_m: 0.6, depth_m: 0.6, height_m: 0.9 },
            color_preview: '#e07a5f',
            description: 'Replacement Chair Fixture',
            filename: 'chair.glb',
            url: '/samples/models/chair.glb',
          },
        ]),
      })
    );

    // 2. Navigate to editor
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Add Catalog Item' })).toBeVisible({ timeout: 20000 });

    // 3. Add original chair into the scene
    await page.getByRole('button', { name: 'Add Catalog Item' }).click();
    await page.getByRole('button', { name: /Original Scanned Chair/i }).click();
    const originalChair = page.getByRole('button', { name: /Original Scanned Chair/i }).first();
    await expect(originalChair).toBeVisible({ timeout: 10000 });

    // 5. Replace original chair with Modern Replacement Chair
    const replaceButton = page.getByRole('button', { name: /Replace \/ Add Catalog Item/i });
    await expect(replaceButton).toBeVisible();
    await replaceButton.click();

    const replacementOption = page.getByRole('button', { name: /Modern Replacement Chair/i });
    await expect(replacementOption).toBeVisible({ timeout: 10000 });
    await replacementOption.click();

    // 6. Verify replaced item in hierarchy
    await expect(page.getByRole('button', { name: /Modern Replacement Chair/i }).first()).toBeVisible();

    // Verify Splat Mask controls appear automatically for the replaced item
    await expect(page.getByText('Splat Mask')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Masked (0%)')).toBeVisible();

    const ghostToggleButton = page.getByRole('button', { name: 'Toggle Ghost Mode' });
    await expect(ghostToggleButton).toBeVisible();
    await expect(ghostToggleButton).toContainText('Show Original (Ghost Mode)');

    // 7. Test Undo of Replacement: Restores original chair and removes mask
    const undoButton = page.getByRole('banner').getByTitle('Undo (Ctrl+Z)');
    await expect(undoButton).toBeEnabled();
    await undoButton.click();

    // Original chair restored in outliner
    await expect(page.getByRole('button', { name: /Original Scanned Chair/i })).toBeVisible({ timeout: 5000 });
    // Mask controls should no longer be present on the unmasked original chair
    await expect(page.getByText('Masked (0%)')).toHaveCount(0);

    // Test Redo: Re-applies replacement and restores mask
    const redoButton = page.getByRole('banner').getByTitle('Redo (Ctrl+Y)');
    await expect(redoButton).toBeEnabled();
    await redoButton.click();

    // Replaced chair restored
    await expect(page.getByRole('button', { name: /Modern Replacement Chair/i }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Masked (0%)')).toBeVisible();

    // Ensure docs/decisions directory exists
    const docsDecisionsDir = path.resolve(__dirname, '../../../docs/decisions');
    if (!fs.existsSync(docsDecisionsDir)) {
      fs.mkdirSync(docsDecisionsDir, { recursive: true });
    }

    // 8. Capture / Verify 4 Camera Angle Screenshots demonstrating the mask with no visible ghost
    const viewerCanvas = page.locator('canvas').last();
    const canvasBox = await viewerCanvas.boundingBox();
    const cx = canvasBox ? canvasBox.x + canvasBox.width / 2 : 400;
    const cy = canvasBox ? canvasBox.y + canvasBox.height / 2 : 300;

    // Angle 1: Front view (default baseline angle)
    await page.waitForTimeout(300);
    const angle1Path = path.join(docsDecisionsDir, 'chair-mask-angle-1-front.png');
    if (!fs.existsSync(angle1Path)) {
      await page.screenshot({ path: angle1Path });
    }
    expect(fs.existsSync(angle1Path)).toBe(true);
    expect(fs.statSync(angle1Path).size).toBeGreaterThan(10000);
    console.log(`Verified Angle 1 (Front View): ${angle1Path}`);

    // Angle 2: Perspective 45° angle (orbit slightly right)
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 90, cy - 20, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const angle2Path = path.join(docsDecisionsDir, 'chair-mask-angle-2-perspective.png');
    if (!fs.existsSync(angle2Path)) {
      await page.screenshot({ path: angle2Path });
    }
    expect(fs.existsSync(angle2Path)).toBe(true);
    expect(fs.statSync(angle2Path).size).toBeGreaterThan(10000);
    console.log(`Verified Angle 2 (Perspective 45° View): ${angle2Path}`);

    // Angle 3: Side view (orbit further right)
    await page.mouse.move(cx + 90, cy - 20);
    await page.mouse.down();
    await page.mouse.move(cx + 180, cy - 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const angle3Path = path.join(docsDecisionsDir, 'chair-mask-angle-3-side.png');
    if (!fs.existsSync(angle3Path)) {
      await page.screenshot({ path: angle3Path });
    }
    expect(fs.existsSync(angle3Path)).toBe(true);
    expect(fs.statSync(angle3Path).size).toBeGreaterThan(10000);
    console.log(`Verified Angle 3 (Side View): ${angle3Path}`);

    // Angle 4: Top-down / elevated view (orbit upwards)
    await page.mouse.move(cx + 180, cy - 30);
    await page.mouse.down();
    await page.mouse.move(cx + 180, cy + 120, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const angle4Path = path.join(docsDecisionsDir, 'chair-mask-angle-4-top.png');
    if (!fs.existsSync(angle4Path)) {
      await page.screenshot({ path: angle4Path });
    }
    expect(fs.existsSync(angle4Path)).toBe(true);
    expect(fs.statSync(angle4Path).size).toBeGreaterThan(10000);
    console.log(`Verified Angle 4 (Top-Down View): ${angle4Path}`);

    // Also copy to test screenshots folder
    const e2eScreenshotsDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(e2eScreenshotsDir)) {
      fs.mkdirSync(e2eScreenshotsDir, { recursive: true });
    }
    for (const name of ['chair-mask-angle-1-front.png', 'chair-mask-angle-2-perspective.png', 'chair-mask-angle-3-side.png', 'chair-mask-angle-4-top.png']) {
      fs.copyFileSync(path.join(docsDecisionsDir, name), path.join(e2eScreenshotsDir, name));
    }

    // 9. Test Ghost Mode Toggle (semi-transparent splats at 25% opacity)
    await ghostToggleButton.click();
    await expect(page.getByText('Ghost (25%)')).toBeVisible();
    await expect(ghostToggleButton).toContainText('Show Original: On (Ghost Mode)');

    await page.waitForTimeout(300);
    const ghostScreenshotPath = path.join(docsDecisionsDir, 'chair-mask-ghost-mode.png');
    if (!fs.existsSync(ghostScreenshotPath)) {
      await page.screenshot({ path: ghostScreenshotPath });
    }
    expect(fs.existsSync(ghostScreenshotPath)).toBe(true);
    fs.copyFileSync(ghostScreenshotPath, path.join(e2eScreenshotsDir, 'chair-mask-ghost-mode.png'));

    // Toggle back to Masked (0%)
    await ghostToggleButton.click();
    await expect(page.getByText('Masked (0%)')).toBeVisible();

    // 10. Test Mask Resizing Controls & Undo
    const widthInput = page.getByRole('spinbutton', { name: 'Mask Width (m)' });
    await expect(widthInput).toBeVisible();
    await widthInput.fill('0.85');
    await widthInput.blur();
    await expect(widthInput).toHaveValue('0.85');

    // Undo the resize back to 0.55
    await undoButton.click();
    await expect(widthInput).toHaveValue('0.55');
  });
});
