import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('001 Splat Rendering Decision - Prototype E2E Verification', () => {
  test('prototype page loads, dual canvas mounts, HUD telemetry displays, and candidate switching functions', async ({
    page,
  }) => {
    // 1. Navigate to splat prototype page
    await page.goto('/splat-prototype', { waitUntil: 'domcontentloaded' });

    // 2. Expect Decision HUD to mount
    await expect(page.locator('text=Splat & Pascal Integration')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('FPS', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Splats', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Format', { exact: true })).toBeVisible({ timeout: 15000 });

    // 3. Expect 3D Canvas element(s) to mount
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 20000 });

    // 4. Test candidate option switching to Option A (triggers diagnostic failure display)
    const optAButton = page.getByRole('button', { name: /\(a\) Spark inside WebGPURenderer/i });
    await expect(optAButton).toBeVisible();
    await optAButton.click();
    await expect(page.locator('text=Evaluation Diagnostic Failure')).toBeVisible({ timeout: 5000 });
    const msgA = await page.locator('text=Evaluation Diagnostic Failure').locator('..').locator('p').textContent();
    console.log('Diagnostic message for Option A:', msgA);

    // Verify "Dismiss Error" button works
    const dismissButton = page.getByRole('button', { name: 'Dismiss Error' });
    await expect(dismissButton).toBeVisible();
    await dismissButton.click();
    await expect(page.locator('text=Evaluation Diagnostic Failure')).not.toBeVisible({ timeout: 5000 });

    // 5. Switch back to Option C (Recommended Dual-Canvas)
    const optCButton = page.getByRole('button', { name: /\(c\) Dual-Canvas Synced/i });
    await expect(optCButton).toBeVisible();
    await optCButton.click();
    await expect(page.locator('text=Evaluation Diagnostic Failure')).not.toBeVisible({ timeout: 5000 });

    // 6. Test Interactive Depth Mode toggle
    const behindButton = page.getByRole('button', { name: 'Behind Scan Wall' });
    await expect(behindButton).toBeVisible();
    await behindButton.click();

    const frontButton = page.getByRole('button', { name: 'In Front (Room)' });
    await expect(frontButton).toBeVisible();
    await frontButton.click();

    // 7. Settle frames and capture screenshot evidence
    await page.waitForTimeout(2000);

    const docScreenshotsDir = path.resolve(__dirname, '../../../docs/decisions');
    if (!fs.existsSync(docScreenshotsDir)) {
      fs.mkdirSync(docScreenshotsDir, { recursive: true });
    }
    const docScreenshotPath = path.join(docScreenshotsDir, 'splat-prototype-screenshot.png');
    await page.screenshot({ path: docScreenshotPath, fullPage: true });
    expect(fs.existsSync(docScreenshotPath)).toBe(true);

    const e2eScreenshotDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(e2eScreenshotDir)) {
      fs.mkdirSync(e2eScreenshotDir, { recursive: true });
    }
    const e2eScreenshotPath = path.join(e2eScreenshotDir, 'splat-prototype-screenshot.png');
    await page.screenshot({ path: e2eScreenshotPath, fullPage: true });
    expect(fs.existsSync(e2eScreenshotPath)).toBe(true);
  });
});
