import { test, expect } from '@playwright/test';
import fs from 'fs';
import { screenshotPath } from './support/artifacts';

test.describe('T05: Scan Alignment & Splat Layer Integration', () => {
  test('mounts dual-canvas, loads scan, executes alignment workflow, and captures before/after screenshots', async ({
    page,
  }) => {
    test.setTimeout(90000);

    // 1. Navigate to main editor
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // 2. Expect both background Splat Canvas (WebGL2) and foreground Pascal Canvas (WebGPU)
    const canvases = page.locator('canvas');
    await expect(canvases.first()).toBeVisible({ timeout: 20000 });
    await expect(canvases.nth(1)).toBeVisible({ timeout: 20000 });

    // 3. Open Import / Scenes modal to load the verified room scan
    const importModalBtn = page.getByRole('button', { name: 'Import / Scenes' });
    await expect(importModalBtn).toBeVisible({ timeout: 10000 });
    await importModalBtn.click({ force: true });

    // Switch to "Import 3D Model" tab
    const importModelTab = page.getByRole('button', { name: /import 3d model/i });
    await expect(importModelTab).toBeVisible({ timeout: 5000 });
    await importModelTab.click({ force: true });

    // Click "Load verified sample room scan"
    const loadSampleButton = page.getByRole('button', { name: 'Load verified sample room scan' });
    await expect(loadSampleButton).toBeVisible({ timeout: 5000 });
    await loadSampleButton.click({ force: true });

    // 4. Wait for scan asset to mount and settle render
    await page.waitForTimeout(1500);

    const beforeScreenshotPath = screenshotPath('scan-before-alignment.png');
    await page.screenshot({ path: beforeScreenshotPath, fullPage: true });
    expect(fs.existsSync(beforeScreenshotPath)).toBe(true);

    // 5. Open Scan Alignment Tool from toolbar
    const alignScanButton = page.getByRole('button', { name: 'Align Scan' });
    await expect(alignScanButton).toBeVisible({ timeout: 10000 });
    await alignScanButton.click({ force: true });

    // Verify ScanAlignmentTool panel is mounted
    await expect(page.locator('text=Align room scan')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'floor', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'scale', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'wall', exact: true })).toBeVisible();

    // 6. Test Stage Switching and Wall Alignment
    // Switch to wall stage to test Y-axis rotation and wall squaring
    await page.getByRole('button', { name: 'wall', exact: true }).click({ force: true });
    await expect(page.locator('text=Pick 2 points along a wall to square up')).toBeVisible({ timeout: 5000 });

    // Click Quick Step Rotation "+90° Y"
    const rotatePlus90 = page.getByRole('button', { name: '+90° Y' });
    await expect(rotatePlus90).toBeVisible();
    await rotatePlus90.click({ force: true });

    // Verify confirmation feedback
    await expect(page.getByText(/Rotated scan/)).toBeVisible({ timeout: 10000 });

    // 7. Settle render and capture AFTER ALIGNMENT screenshot
    await page.waitForTimeout(1000);
    const afterScreenshotPath = screenshotPath('scan-after-alignment.png');
    await page.screenshot({ path: afterScreenshotPath, fullPage: true });
    expect(fs.existsSync(afterScreenshotPath)).toBe(true);

    // 8. Test Undo (Ctrl+Z)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // Close alignment tool by toggling toolbar button
    await alignScanButton.click({ force: true });
    await expect(page.locator('text=Align room scan')).not.toBeVisible({ timeout: 5000 });
  });
});
