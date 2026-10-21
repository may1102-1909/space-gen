import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Screenshot output. Defaults to the gitignored test-results/screenshots. Regenerate tracked docs
 * evidence explicitly, e.g. `E2E_SCREENSHOT_DIR=../docs/phase1 npx playwright test phase1`.
 */
export const SCREENSHOT_DIR = path.resolve(
  process.env.E2E_SCREENSHOT_DIR || path.join(__dirname, '..', '..', '..', 'test-results', 'screenshots'),
);

export function screenshotPath(name: string): string {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return path.join(SCREENSHOT_DIR, name);
}

/** Fails with an actionable message when the app was built without the e2e hooks. */
export async function waitForE2EHooks(page: Page): Promise<void> {
  try {
    await page.waitForFunction(() => Boolean(window.__spacegenE2E), undefined, { timeout: 20000 });
  } catch {
    throw new Error('window.__spacegenE2E is missing: build the app with `npm run build:e2e` before running Playwright.');
  }
}
