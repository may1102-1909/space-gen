import { test, expect } from '@playwright/test';
import fs from 'fs';
import { screenshotPath } from './support/artifacts';

test.describe('SpaceGen 3D Editor Smoke Test', () => {
  test('editor page loads, 3D canvas renders, and no console errors occur', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore benign external favicon or minor WebGL warning logs if any
        if (!text.includes('favicon.ico')) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push(`[Unhandled Page Error]: ${err.message}\nStack: ${err.stack}`);
    });

    // 1. Navigate to editor root
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // 2. Expect layout panels to be visible
    await expect(page.locator('text=Spatial AI Co-Pilot')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('text=Scene Hierarchy')).toBeVisible({ timeout: 20000 });

    // 3. Expect 3D Editor floating toolbar CAD tools to be mounted
    await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Wall', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Slab', exact: true })).toBeVisible({ timeout: 15000 });

    // 4. Expect dual-canvas architecture: background WebGL2 canvas (Spark) & foreground WebGPU canvas (Pascal)
    const canvases = page.locator('canvas');
    await expect(canvases.first()).toBeVisible({ timeout: 20000 });
    await expect(canvases.nth(1)).toBeVisible({ timeout: 20000 });

    // 5. Allow frames to settle and verify no console errors
    await page.waitForTimeout(2000);
    expect(consoleErrors, `Console errors detected during smoke test: ${consoleErrors.join('\n')}`).toEqual([]);

    // 6. Capture screenshot for PR visual proof
    const file = screenshotPath('editor-smoke.png');
    await page.screenshot({ path: file, fullPage: true });
    expect(fs.existsSync(file)).toBe(true);
  });
});
