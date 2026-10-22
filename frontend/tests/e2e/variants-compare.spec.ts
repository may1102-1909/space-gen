import { test, expect, type Page } from '@playwright/test';
import { screenshotPath, waitForE2EHooks } from './support/artifacts';
import { createPhase1Fixture, getProject, putProject } from './support/projects';

// T16: variants share one scan; each has its own Pascal snapshot and edit history.
type SnapNode = { type: string; name: string; position: number[]; metadata?: Record<string, unknown> };
const itemX = (snapshot: Record<string, unknown>) =>
  Object.values((snapshot.nodes ?? {}) as Record<string, SnapNode>).find((n) => n.type === 'item')!.position[0];

async function openProject(page: Page, id: string) {
  await page.goto(`/editor/${id}`, { waitUntil: 'domcontentloaded' });
  await waitForE2EHooks(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

test('variants: create B from A, move an item, compare, save, reload', async ({ page, request }) => {
  test.slow();
  const id = `variants-${Date.now()}`;
  const fixture = await createPhase1Fixture(request, id);
  // Seed A with one EditRecord on the scan node so the history timeline has something to show.
  const snapshot = fixture.manifest.sceneSnapshot as { nodes: Record<string, SnapNode> };
  snapshot.nodes.scan_fixture.metadata!.editHistory = [{ id: 'edit_seed', timestamp: '2026-01-01T00:00:00.000Z', op: 'add', targetNodeId: 'item_detected_chair', description: 'Added Detected Chair: seeded' }];
  await putProject(request, { ...fixture.manifest, sceneSnapshot: snapshot }, fixture.revision);

  await openProject(page, id);
  await expect(page.getByLabel('Active variant')).toHaveValue('default');
  await expect(page.getByRole('button', { name: 'Compare' })).toBeDisabled();

  // Create B from A (becomes active), then move the chair in B only.
  await page.getByRole('button', { name: 'New from current' }).click();
  await expect(page.getByLabel('Active variant').locator('option:checked')).toHaveText('Variant 2');
  await page.getByRole('button', { name: /Detected Chair/ }).click();
  await page.getByRole('spinbutton', { name: 'Pos X (m)' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Pos X (m)' }).blur();

  // Switching to A shows the original position; back to B shows the move.
  await page.getByLabel('Active variant').selectOption({ label: 'Default' });
  await page.getByRole('button', { name: /Detected Chair/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Pos X (m)' })).toHaveValue('0.5');
  await expect(page.getByRole('banner').getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  await page.getByLabel('Active variant').selectOption({ label: 'Variant 2' });
  await page.getByRole('button', { name: /Detected Chair/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Pos X (m)' })).toHaveValue('2');

  // Compare: moved diff with a formatted distance, swipe slider, synced cameras, history.
  await page.getByRole('button', { name: 'Compare' }).click();
  const compare = page.getByTestId('compare-view');
  await expect(compare.getByLabel('Variant A')).toHaveValue(/.+/);
  await expect(compare.getByTestId('diff-moved')).toContainText(/Moved Detected Chair by ≈ 1\.5.* m \(±\d+ cm est\.\)/);
  await expect(compare.getByTestId('compare-pane')).toHaveCount(2);

  await expect.poll(() => page.evaluate(() => Object.keys(window.__spacegenCompareCameras ?? {}).length)).toBe(2);
  const cams = () => page.evaluate(() => Object.values(window.__spacegenCompareCameras!).map((f) => f()));
  const before = (await cams())[0];
  const left = await compare.getByTestId('compare-pane').first().boundingBox();
  await page.mouse.move(left!.x + left!.width / 2, left!.y + left!.height / 2);
  await page.mouse.down();
  await page.mouse.move(left!.x + left!.width / 2 + 40, left!.y + left!.height / 2 + 10, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => { const [x, y] = await cams(); return x.every((v, i) => Math.abs(v - y[i]) < 1e-4); }).toBe(true);
  expect((await cams())[0], 'drag moved the camera').not.toEqual(before);

  await compare.getByRole('tab', { name: 'History' }).click();
  await expect(compare.getByTestId('history-column')).toHaveCount(2);
  await expect(compare.getByText('Added Detected Chair: seeded')).toHaveCount(2);
  await compare.getByRole('tab', { name: 'Differences' }).click();

  await compare.getByRole('tab', { name: 'Swipe' }).click();
  await expect(compare.getByTestId('swipe-slider')).toBeVisible();
  await expect(compare.getByTestId('compare-pane')).toHaveCount(1);
  await compare.getByTestId('swipe-slider').fill('35');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: screenshotPath('variants-compare.png') });
  await compare.getByRole('button', { name: 'Close' }).click();

  // Save → persisted manifest holds both variants with their own positions.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const saved = await getProject(request, id);
  expect(saved.manifest.variants.map((v) => v.name)).toEqual(['Default', 'Variant 2']);
  expect(saved.manifest.activeVariantId).toBe(saved.manifest.variants[1].id);
  expect(saved.manifest.variants.map((v) => itemX(v.sceneSnapshot))).toEqual([0.5, 2]);
  expect(itemX(saved.manifest.sceneSnapshot)).toBe(2);

  // Reload: active variant restored; the other still holds its own position.
  await openProject(page, id);
  await expect(page.getByLabel('Active variant').locator('option:checked')).toHaveText('Variant 2');
  await page.getByRole('button', { name: /Detected Chair/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Pos X (m)' })).toHaveValue('2');
  await page.getByLabel('Active variant').selectOption({ label: 'Default' });
  await page.getByRole('button', { name: /Detected Chair/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Pos X (m)' })).toHaveValue('0.5');

  // Blank variant has no furniture; delete returns to a single variant.
  await page.getByRole('button', { name: 'New blank' }).click();
  await expect(page.getByRole('button', { name: /Detected Chair/ })).toHaveCount(0);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByLabel('Active variant').locator('option')).toHaveCount(2);
});
