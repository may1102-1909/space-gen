import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/realistic_room.json'), 'utf-8'));

test('user fixes a wrong wall and a misplaced detection, saves, reloads, and the corrections persist', async ({ page }) => {
  test.setTimeout(120000);
  const id = fixture.id as string;
  // The fixture's sceneSnapshot is not a Pascal document; start from the interpretation alone.
  let manifest = { ...fixture, sceneSnapshot: {} };
  let revision = 1;
  const puts: any[] = [];
  // The splat is an unchanged background layer (ADR 001); software-GL splat sorting starves the
  // main thread in CI, so this UI test runs without downloading it.
  await page.route('**/*.sog', (route) => route.abort());
  await page.route(`**/api/projects/${id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      manifest = route.request().postDataJSON();
      puts.push(manifest);
      revision += 1;
    }
    await route.fulfill({ json: { manifest, revision, updatedAt: new Date().toISOString() }, headers: { ETag: `"${revision}"` } });
  });

  await page.goto(`/editor/${id}`);
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review scan' }).click();
  await page.getByRole('button', { name: 'Build editable room from scan' }).click();

  const review = page.getByRole('region', { name: 'Scan review' });
  await expect(review.getByTestId('trust-warning')).toContainText('10 scan elements are unreviewed');
  // Low-confidence, unreviewed items come first.
  await expect(review.getByRole('list', { name: 'Review items' }).locator('li').first()).toContainText('Low-profile TV Media Console');

  // 1. Wrong wall: the east wall was placed 40 cm too far out.
  await review.getByRole('button', { name: 'Select Wall wall_east' }).click();
  await review.getByLabel('Wall start X').fill('7.6');
  await review.getByLabel('Wall start X').press('Enter');
  await review.getByLabel('Wall end X').fill('7.6');
  await review.getByLabel('Wall end X').press('Enter');
  await expect(review.getByTestId('status-wall_east')).toHaveText('corrected · user');
  // Shared corners follow, so the north wall is corrected too.
  await expect(review.getByTestId('status-wall_north')).toHaveText('corrected · user');

  // 2. Misplaced detection: drag the TV console box in the plan overlay.
  const box = review.getByTestId('plan-detection-det_tv_console');
  const bounds = (await box.boundingBox())!;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 10, cy + 20, { steps: 6 });
  await page.mouse.move(cx + 20, cy + 40, { steps: 6 });
  await page.mouse.up();
  await expect(review.getByTestId('status-det_tv_console')).toHaveText('corrected · user');
  const centerZ = review.getByLabel('Box center Z');
  const draggedZ = Number(await centerZ.inputValue());
  const draggedX = Number(await review.getByLabel('Box center X').inputValue());
  expect(draggedZ).toBeGreaterThan(0.6);

  // Corrections are Pascal temporal steps: undo restores, redo re-applies.
  await page.getByRole('banner').getByTitle('Undo (Ctrl+Z)').click();
  await expect(centerZ).toHaveValue('0.4');
  await page.getByRole('banner').getByTitle('Redo (Ctrl+Y)').click();
  await expect(centerZ).toHaveValue(String(draggedZ));

  // A verified-only action for a correct element.
  await review.getByRole('button', { name: 'Verify Dining Table 6-Seater' }).click();
  await expect(review.getByTestId('status-det_dining_table')).toHaveText('verified');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => puts.length).toBeGreaterThan(0);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  const saved = puts[puts.length - 1];
  const east = saved.interpretation.walls.find((w: any) => w.id === 'wall_east');
  expect(east).toMatchObject({ start: [7.6, 0, 0], end: [7.6, 0, 6], status: 'corrected', provenance: 'user' });
  expect(saved.interpretation.outline).toContainEqual([7.6, 0]);
  const tv = saved.interpretation.detections.find((d: any) => d.id === 'det_tv_console');
  expect(tv).toMatchObject({ status: 'corrected', provenance: 'user' });
  expect(tv.obb.center).toEqual([draggedX, 0.3, draggedZ]);
  expect(saved.maskRegions.find((m: any) => m.id === 'mask_tv_console').obb.center).toEqual([draggedX, 0.3, draggedZ]);
  expect(saved.interpretation.provenance).toBe('user');

  await page.reload();
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review scan' }).click();
  const reloaded = page.getByRole('region', { name: 'Scan review' });
  await expect(reloaded.getByRole('button', { name: 'Build editable room from scan' })).toHaveCount(0);
  await expect(reloaded.getByTestId('status-wall_east')).toHaveText('corrected · user');
  await expect(reloaded.getByTestId('status-det_tv_console')).toHaveText('corrected · user');
  await expect(reloaded.getByTestId('status-det_dining_table')).toHaveText('verified');
  await reloaded.getByRole('button', { name: 'Select Wall wall_east' }).click();
  await expect(reloaded.getByLabel('Wall start X')).toHaveValue('7.6');
  await expect(reloaded.getByLabel('Wall end X')).toHaveValue('7.6');
  await reloaded.getByRole('button', { name: 'Select Low-profile TV Media Console' }).click();
  await expect(reloaded.getByLabel('Box center Z')).toHaveValue(String(draggedZ));
  await expect(reloaded.getByLabel('Box center X')).toHaveValue(String(draggedX));

  await reloaded.getByRole('button', { name: 'Select Wall wall_east' }).click();
  const shot = path.resolve(__dirname, '../../../docs/interpretation-review.png');
  await page.screenshot({ path: shot, animations: 'disabled', timeout: 30000 });
  fs.copyFileSync(shot, path.join(__dirname, 'screenshots', 'interpretation-review.png'));
});
