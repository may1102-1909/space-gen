import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { screenshotPath, waitForE2EHooks } from './support/artifacts';

// Scripted FPS measurement for ADR 001 on public/Hurstville_Museum_Gallery.sog. This records numbers;
// it is not a performance gate (headless software GL in CI renders at a few FPS).

async function measureFps(page: Page, seconds: number): Promise<{ fps: number; p95FrameMs: number }> {
  return page.evaluate((duration) => new Promise<{ fps: number; p95FrameMs: number }>((resolve) => {
    const frames: number[] = [];
    let last = performance.now();
    const start = last;
    const tick = (now: number) => {
      frames.push(now - last);
      last = now;
      if (now - start < duration * 1000) requestAnimationFrame(tick);
      else {
        const sorted = [...frames].sort((a, b) => a - b);
        resolve({ fps: frames.length / ((now - start) / 1000), p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] });
      }
    };
    requestAnimationFrame(tick);
  }), seconds);
}

async function rendererInfo(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
}

test('measure FPS with the 161,576-splat sample scan (prototype and editor)', async ({ page }) => {
  test.slow();
  const results: Record<string, unknown> = { renderer: '', softwareGl: Boolean(process.env.E2E_SOFTWARE_GL), viewport: page.viewportSize() };

  await page.goto('/splat-prototype', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('161,576')).toBeVisible({ timeout: 60000 });
  results.renderer = await rendererInfo(page);
  await page.waitForTimeout(2000);
  results.prototype = await measureFps(page, 5);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForE2EHooks(page);
  await page.getByRole('button', { name: 'Import / Scenes' }).click({ force: true });
  await page.getByRole('button', { name: /import 3d model/i }).click({ force: true });
  await page.getByRole('button', { name: 'Load verified sample room scan' }).click({ force: true });
  await page.waitForFunction(() => (window.__spacegenSplat?.numSplats() ?? 0) > 0, undefined, { timeout: 60000 });
  results.splats = await page.evaluate(() => window.__spacegenSplat!.numSplats());
  await page.waitForTimeout(2000);
  results.editor = await measureFps(page, 5);

  console.log('FPS results', JSON.stringify(results));
  fs.writeFileSync(screenshotPath(`fps-${process.env.E2E_SOFTWARE_GL ? 'software' : 'gpu'}.json`), JSON.stringify(results, null, 2));
  expect(results.splats).toBe(161576);
  expect((results.editor as { fps: number }).fps).toBeGreaterThan(0);
});
