import { test, expect } from '@playwright/test';
import fs from 'fs';
import { screenshotPath } from './support/artifacts';

test.describe('001 Splat Rendering Decision - Prototype E2E Verification', () => {
  test('prototype page loads, dual canvas mounts, HUD telemetry displays, and candidate switching functions', async ({
    page,
  }) => {
    // Each candidate attempt can take up to its 60-frame budget (slow on software GL).
    test.slow();
    page.on('console', (msg) => {
      if (/webgpu|spark|THREE\./i.test(msg.text()) && msg.type() !== 'info') console.log(`[browser ${msg.type()}]`, msg.text().slice(0, 300));
    });
    // 1. Navigate to splat prototype page
    await page.goto('/splat-prototype', { waitUntil: 'domcontentloaded' });

    // 2. Expect Decision HUD to mount
    await expect(page.locator('text=Splat & Pascal Integration')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('FPS', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Splats', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Format', { exact: true })).toBeVisible({ timeout: 15000 });

    // 3. Expect 3D Canvas element(s) to mount and the real scan to load (no placeholder telemetry).
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('161,576')).toBeVisible({ timeout: 60000 });

    // 4. Candidates (a) and (b) are attempted for real; record what the browser reports.
    const attempt = page.getByRole('status', { name: 'Candidate attempt' });
    for (const name of [/\(a\) Spark inside WebGPURenderer/i, /\(b\) Force Pascal/i]) {
      await page.getByRole('button', { name }).click();
      const control = attempt.locator('[data-candidate="webgl-control"]');
      await expect(control).toContainText('Result:', { timeout: 150000 });
      for (const run of await attempt.locator('[data-candidate]').all()) {
        console.log(`${name} →`, (await run.innerText()).replace(/\s+/g, ' '));
      }
      // The harness is valid only if Spark on a classic WebGLRenderer actually draws.
      await expect(control).toContainText('rendered');
    }

    // 5. Switch back to Option C (Recommended Dual-Canvas)
    const optCButton = page.getByRole('button', { name: /\(c\) Dual-Canvas Synced/i });
    await expect(optCButton).toBeVisible();
    await optCButton.click();
    await expect(attempt).toBeHidden();

    // 6. Test Interactive Depth Mode toggle
    const behindButton = page.getByRole('button', { name: 'Behind Scan Wall' });
    await expect(behindButton).toBeVisible();
    await behindButton.click();

    const frontButton = page.getByRole('button', { name: 'In Front (Room)' });
    await expect(frontButton).toBeVisible();
    await frontButton.click();

    // 7. Settle frames and capture screenshot evidence
    await page.waitForTimeout(2000);

    const file = screenshotPath('splat-prototype-screenshot.png');
    await page.screenshot({ path: file, fullPage: true });
    expect(fs.existsSync(file)).toBe(true);
  });
});
