import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { screenshotPath } from './support/artifacts';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/realistic_room.json'), 'utf-8'));

test('fixture project -> Drawings: dimensioned plan, elevations, SVG export', async ({ page }) => {
  test.setTimeout(120000);
  // Tall enough for the whole 1:50 sheet in the screenshot.
  await page.setViewportSize({ width: 1500, height: 1400 });
  const id = fixture.id as string;
  let manifest = { ...fixture, sceneSnapshot: {} };
  let revision = 1;
  await page.route('**/*.sog', (route) => route.abort());
  await page.route(`**/api/projects/${id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      manifest = route.request().postDataJSON();
      revision += 1;
    }
    await route.fulfill({ json: { manifest, revision, updatedAt: new Date().toISOString() }, headers: { ETag: `"${revision}"` } });
  });

  await page.goto(`/editor/${id}`);
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review scan' }).click();
  await page.getByRole('button', { name: 'Build editable room from scan' }).click();
  await expect(page.getByRole('region', { name: 'Scan review' }).getByTestId('status-wall_north')).toBeVisible();

  await page.getByRole('button', { name: 'Drawings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Drawings' });
  const sheet = panel.getByTestId('drawing-sheet');
  await expect(sheet.locator('svg[data-drawing="plan"]')).toBeVisible();
  await expect(sheet.locator('[data-kind="wall"]')).toHaveCount(4);
  await expect(sheet.locator('[data-kind="opening"]')).toHaveCount(3);
  await expect(sheet.locator('[data-kind="opening"][data-id="door_main"]')).toHaveAttribute('data-center', '2.0000');
  await expect(sheet.locator('[data-kind="room"]')).toContainText('m² (±');
  await expect(sheet.locator('[data-role="accuracy-note"]')).toContainText('Dimensions estimated ±');
  await expect(sheet.locator('svg')).toHaveAttribute('width', /mm$/);
  await sheet.screenshot({ path: screenshotPath('drawings-plan.png') });

  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export SVG' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/plan-1-50\.svg$/);
  const svg = fs.readFileSync((await file.path())!, 'utf-8');
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg.match(/data-kind="wall"/g)).toHaveLength(4);

  // 1:100 halves the sheet's drawing size.
  const wide50 = parseFloat((await sheet.locator('svg').getAttribute('width'))!);
  await panel.getByLabel('Scale').selectOption('100');
  await expect.poll(async () => parseFloat((await sheet.locator('svg').getAttribute('width'))!)).toBeLessThan(wide50);
  await panel.getByLabel('Scale').selectOption('50');

  await panel.getByRole('tab', { name: 'Elevations' }).click();
  await panel.getByLabel('Elevation wall').selectOption({ label: 'Wall north' });
  await expect(sheet.locator('svg[data-drawing="elevation"]')).toBeVisible();
  await expect(sheet.locator('[data-kind="opening"][data-id="window_north"]')).toHaveAttribute('data-sill', '0.9000');
  await sheet.screenshot({ path: screenshotPath('drawings-elevation.png') });
});
