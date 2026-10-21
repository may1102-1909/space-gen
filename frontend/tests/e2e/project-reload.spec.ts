import { expect, test } from '@playwright/test';
import { screenshotPath } from './support/artifacts';

test('reopening a project restores the Pascal item transform', async ({ page }) => {
  const id = 'fixture-room';
  let manifest = {
    schemaVersion: '1.0.0', id, name: 'Transform fixture',
    scan: { url: '', format: 'ply', scanToScene: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], scaleSource: 'none', bounds: { min: [0, 0, 0], max: [0, 0, 0] } },
    interpretation: { provenance: 'auto', floor: { normal: [0, 1, 0], constant: 0, provenance: 'auto' }, ceilingHeight: 2.5, outline: [], walls: [], openings: [], detections: [] },
    maskRegions: [], assets: [], history: [], variants: [], activeVariantId: 'default',
    sceneSnapshot: { nodes: { item_fixture: { id: 'item_fixture', type: 'item', name: 'Saved Chair', category: 'chair', position: [1.25, 0, -2.5], rotation: [0, 0.4, 0], dimensions: [0.8, 0.9, 0.7], asset: { id: 'asset_fixture', src: '/chair.glb', name: 'Saved Chair', dimensions: [0.8, 0.9, 0.7] } } }, rootNodeIds: ['item_fixture'], collections: {}, materials: {}, installedPlugins: [] },
  };
  let revision = 1;
  let putCount = 0;
  await page.route(`**/api/projects/${id}`, async route => {
    if (route.request().method() === 'PUT') {
      putCount += 1;
      const nextManifest = route.request().postDataJSON();
      if (putCount === 1) await new Promise(resolve => setTimeout(resolve, 500));
      manifest = nextManifest;
      revision += 1;
      await route.fulfill({ json: { manifest, revision, updatedAt: new Date().toISOString() }, headers: { ETag: `"${revision}"` } });
      return;
    }
    await route.fulfill({ json: { manifest, revision, updatedAt: new Date().toISOString() }, headers: { ETag: `"${revision}"` } });
  });
  await page.goto(`/editor/${id}`);
  await expect(page.getByText('Saved Chair', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Saved Chair chair/ }).click();
  await expect(page.locator('input[type="number"]').nth(0)).toHaveValue('1.25');
  await expect(page.locator('input[type="number"]').nth(2)).toHaveValue('-2.5');

  await page.locator('input[type="number"]').nth(0).fill('3.75');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => putCount).toBe(1);
  await page.locator('input[type="number"]').nth(0).fill('4.5');
  await page.locator('input[type="number"]').nth(0).blur();
  await expect.poll(() => putCount, { timeout: 10000 }).toBe(2);
  await expect.poll(() => revision).toBe(3);
  await expect(page.locator('input[type="number"]').nth(0)).toHaveValue('4.5');

  await page.reload();
  await expect(page.getByText('Saved Chair', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Saved Chair chair/ }).click();
  await expect(page.locator('input[type="number"]').nth(0)).toHaveValue('4.5');
  await expect(page.locator('input[type="number"]').nth(2)).toHaveValue('-2.5');
  await page.screenshot({ path: screenshotPath('project-reload.png'), fullPage: true });
});
