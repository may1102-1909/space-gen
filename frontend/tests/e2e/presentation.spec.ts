import { test, expect, type Page } from '@playwright/test';
import { screenshotPath, waitForE2EHooks } from './support/artifacts';
import { API_URL, createPhase1Fixture, getProject } from './support/projects';

// T17: designer creates a share link, a fresh browser context opens the read-only tour, revoke kills it.
type Vec3 = [number, number, number];
const ENTRY: [Vec3, Vec3] = [[0.5, 1.4, -2.9], [0.5, 0.5, -4.5]];
const CHAIR: [Vec3, Vec3] = [[2.0, 1.2, -3.0], [0.5, 0.5, -4.5]];

const camera = (page: Page) => page.evaluate(() => window.__spacegenE2E!.getCamera());
const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.05;

test('share link: designer creates → client tours read-only in a fresh context → revoke → 404', async ({ page, browser, request }) => {
  test.slow();
  const projectId = `present-${Date.now()}`;
  await createPhase1Fixture(request, projectId);

  // Designer: save two viewpoints and create a link.
  await page.goto(`/editor/${projectId}`, { waitUntil: 'domcontentloaded' });
  await waitForE2EHooks(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share' });
  for (const [name, [position, target]] of [['Entry', ENTRY], ['Chair corner', CHAIR]] as const) {
    await page.evaluate(([p, t]) => window.__spacegenE2E!.setCamera(p, t), [position, target] as [Vec3, Vec3]);
    await dialog.getByLabel('Viewpoint name').fill(name);
    await dialog.getByRole('button', { name: 'Save current view' }).click();
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();
  }
  await dialog.getByLabel('Link label').fill('Client A');
  await dialog.getByRole('button', { name: 'Create link' }).click();
  const url = await dialog.getByLabel('Presentation link').inputValue();
  expect(url).toMatch(/\/p\/[A-Za-z0-9_-]{43}$/);
  await expect.poll(async () => (await getProject(request, projectId)).manifest.viewpoints?.length, { timeout: 15000 }).toBe(2);
  const token = url.split('/p/')[1];

  // Client: a brand-new context shares no storage with the designer.
  const clientContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const client = await clientContext.newPage();
  await client.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForE2EHooks(client);
  await client.waitForFunction(() => (window.__spacegenSplat?.numSplats() ?? 0) > 0, undefined, { timeout: 60000 });
  await expect(client.getByTestId('tour-position')).toHaveText('Viewpoint 1 of 2');
  await expect(client.getByTestId('tour-name')).toHaveText('Entry');
  await expect.poll(async () => near((await camera(client)).position, ENTRY[0])).toBe(true);
  await expect(client.getByRole('complementary', { name: 'Items' })).toContainText('Detected Chair');
  await client.screenshot({ path: screenshotPath('presentation.png') });

  await client.getByRole('button', { name: 'Next viewpoint' }).click();
  await expect(client.getByTestId('tour-position')).toHaveText('Viewpoint 2 of 2');
  await expect.poll(async () => near((await camera(client)).position, CHAIR[0]), { timeout: 10000 }).toBe(true);
  await client.getByRole('button', { name: 'Previous viewpoint' }).click();
  await expect(client.getByTestId('tour-name')).toHaveText('Entry');
  await client.getByRole('button', { name: 'Play tour' }).click();
  await expect(client.getByTestId('tour-name')).toHaveText('Chair corner', { timeout: 15000 });

  // No editing surface: no undo/save/upload/toolbars, and the token cannot write.
  for (const name of ['Undo', 'Save', 'Upload GLB', 'Share', 'Drawings']) {
    await expect(client.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(client.getByTitle('Undo (Ctrl+Z)')).toHaveCount(0);
  expect((await clientContext.request.put(`${API_URL}/api/share/${token}`, { data: {} })).status()).toBe(405);
  expect((await clientContext.request.delete(`${API_URL}/api/projects/${projectId}/shares/x`)).status()).not.toBe(500);

  // Revoke from the designer; the link stops working.
  await dialog.getByRole('button', { name: 'Revoke' }).click();
  await expect(dialog.getByText('Revoked')).toBeVisible();
  expect((await request.get(`${API_URL}/api/share/${token}`)).status()).toBe(404);
  await client.reload({ waitUntil: 'domcontentloaded' });
  await expect(client.getByText('This link is no longer available.')).toBeVisible();
  await clientContext.close();
});
