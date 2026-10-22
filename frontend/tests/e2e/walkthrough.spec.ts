import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import type { ProjectManifest } from '@/lib/contracts';
import { screenshotPath, waitForE2EHooks } from './support/artifacts';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/realistic_room.json'), 'utf-8'));
type Vec3 = [number, number, number];

// Fixture room: outline (0,0)-(8,6), ceiling 2.8 m.
const ROOM = { minX: 0, maxX: 8, minZ: 0, maxZ: 6, ceiling: 2.8 };

/**
 * Pointer lock cannot be granted headless, so mouse look is driven through window.__spacegenWalk.setLook
 * (E2E build only). Keyboard movement is real: Playwright key events reach the same KeyboardControls Pascal's
 * BVHEcctrl reads, no pointer lock needed.
 */
async function openBuiltRoom(page: Page, { loadSplat }: { loadSplat: boolean }) {
  const id = fixture.id as string;
  let manifest = { ...fixture, sceneSnapshot: {} } as ProjectManifest;
  let revision = 1;
  if (!loadSplat) await page.route('**/*.sog', (route) => route.abort());
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
  await page.getByRole('button', { name: 'Review scan' }).click();
  await waitForE2EHooks(page);
  return { puts: () => manifest };
}

const camera = (page: Page) => page.evaluate(() => window.__spacegenE2E!.getCamera());
const walk = (page: Page) => page.evaluate(() => window.__spacegenWalk!.state());
const inside = (p: Vec3) => p[0] >= ROOM.minX && p[0] <= ROOM.maxX && p[2] >= ROOM.minZ && p[2] <= ROOM.maxZ && p[1] >= 0.3 - 1e-3 && p[1] <= ROOM.ceiling;

async function zoomOutAndOrbit(page: Page) {
  const box = (await page.getByTestId('pascal-layer').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 25; i++) await page.mouse.wheel(0, 400);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy - 160, { steps: 8 });
  await page.mouse.up();
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
  // OrbitControls applies wheel/drag on the next frames.
  await page.waitForTimeout(800);
}

test('interior scenes confine the orbit camera; the Exterior override frees it', async ({ page }) => {
  test.slow();
  const saved = await openBuiltRoom(page, { loadSplat: false });
  await expect(page.getByRole('group', { name: 'Scene kind' }).getByRole('button', { name: 'Interior' })).toHaveAttribute('aria-pressed', 'true');

  // A camera that starts outside the room is moved to an interior viewpoint, not left outside.
  await page.evaluate(() => window.__spacegenE2E!.setCamera([30, 20, 30], [4, 1, 3]));
  await expect.poll(async () => inside((await camera(page)).position)).toBe(true);

  await zoomOutAndOrbit(page);
  const confined = await camera(page);
  expect(inside(confined.position), `camera ${confined.position} must stay inside the room`).toBe(true);
  expect(inside(confined.target), `target ${confined.target} must stay inside the room`).toBe(true);

  await page.getByRole('group', { name: 'Scene kind' }).getByRole('button', { name: 'Exterior' }).click();
  await expect(page.getByRole('group', { name: 'Scene kind' }).getByRole('button', { name: 'Exterior' })).toHaveAttribute('aria-pressed', 'true');
  // The override is stored in the manifest (saved with the next save).
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saved.puts().sceneKind).toBe('exterior');
  await page.evaluate(() => window.__spacegenE2E!.setCamera([4, 2, 3], [4, 1, 3]));
  await zoomOutAndOrbit(page);
  const free = await camera(page);
  expect(inside(free.position), `camera ${free.position} should be free to leave the room`).toBe(false);
});

test('Walk: collides with walls in every view mode, switches view modes, Esc restores the orbit camera', async ({ page }) => {
  test.slow();
  await openBuiltRoom(page, { loadSplat: false });
  const orbitBefore = await camera(page);
  const nav = page.getByRole('group', { name: 'Navigation' });
  const view = page.getByRole('group', { name: 'View mode' });

  // Splat only: walls are invisible but still collide.
  await view.getByRole('button', { name: 'Splat' }).click();
  await expect(page.getByTestId('pascal-layer')).toHaveCSS('opacity', '0');
  await expect(page.getByTestId('splat-layer')).toBeVisible();

  await nav.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByTestId('walk-hint')).toContainText('WASD');
  await expect(page.getByTestId('editor-toolbar-shell')).toHaveAttribute('inert', '');
  await page.waitForFunction(() => Boolean(window.__spacegenWalk), undefined, { timeout: 30000 });
  await expect.poll(async () => (await walk(page)).collider).toBe('scene');
  const spawn = await walk(page);
  expect(inside(spawn.eye)).toBe(true);
  expect(spawn.eye[1]).toBeGreaterThan(1.4);
  expect(spawn.fov).toBe(60);
  expect(spawn.near).toBeLessThanOrEqual(0.05);

  // Face north (-z) and hold W for ~1 s: moved forward.
  await page.evaluate(() => window.__spacegenWalk!.setLook(0, 0));
  await page.waitForTimeout(500); // let the capsule settle onto the floor
  const start = await walk(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  const moved = await walk(page);
  expect(start.eye[2] - moved.eye[2], 'W walks forward (-z at yaw 0)').toBeGreaterThan(0.1);
  expect(Math.abs(moved.eye[0] - start.eye[0])).toBeLessThan(0.2);

  // Keep walking into the north wall (z = 0): it stops before it.
  await page.waitForTimeout(6000);
  const atWall = await walk(page);
  await page.waitForTimeout(1000);
  const later = await walk(page);
  await page.keyboard.up('KeyW');
  expect(atWall.eye[2]).toBeGreaterThan(0.05);
  expect(atWall.eye[2]).toBeLessThan(1);
  expect(Math.abs(later.eye[2] - atWall.eye[2])).toBeLessThan(0.05);
  expect(inside(later.eye)).toBe(true);

  // The splat canvas follows the walking camera: view modes keep working while walking.
  // Pointer lock is granted in headless Chromium, so the mouse cannot reach the buttons: 1/2/3 switch view modes.
  await page.keyboard.press('Digit2');
  await expect(view.getByRole('button', { name: 'Mesh' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('splat-layer')).toBeHidden();
  await expect(page.getByTestId('pascal-layer')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('splat-layer')).toBeVisible();
  await expect(page.getByTestId('pascal-layer')).toHaveCSS('opacity', '1');

  // Esc leaves Walk and restores the previous orbit camera.
  await page.keyboard.press('Escape');
  await expect(nav.getByRole('button', { name: 'Orbit' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('editor-toolbar-shell')).not.toHaveAttribute('inert', '');
  await expect.poll(async () => (await camera(page)).position[2]).toBeCloseTo(orbitBefore.position[2], 1);
  const restored = await camera(page);
  for (let i = 0; i < 3; i++) {
    expect(restored.position[i]).toBeCloseTo(orbitBefore.position[i], 1);
    expect(restored.target[i]).toBeCloseTo(orbitBefore.target[i], 1);
  }
});

test('Walk without a built room falls back to a floor and shows the wall-collision hint', async ({ page }) => {
  test.slow();
  const id = fixture.id as string;
  await page.route('**/*.sog', (route) => route.abort());
  await page.route(`**/api/projects/${id}`, (route) =>
    route.fulfill({ json: { manifest: { ...fixture, sceneSnapshot: {} }, revision: 1, updatedAt: new Date().toISOString() }, headers: { ETag: '"1"' } }),
  );
  await page.goto(`/editor/${id}`);
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
  await waitForE2EHooks(page);
  await expect(page.getByRole('group', { name: 'Scene kind' }).getByRole('button', { name: 'Exterior' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Navigation' }).getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByTestId('no-walls-hint')).toHaveText('Build the editable room (Review scan) to enable wall collisions');
  await page.waitForFunction(() => Boolean(window.__spacegenWalk), undefined, { timeout: 30000 });
  await expect.poll(async () => (await walk(page)).collider).toBe('floor-only');
  await expect.poll(async () => (await walk(page)).eye[1]).toBeGreaterThan(1.3);
});

test('walkthrough screenshots (splat and mesh)', async ({ page }) => {
  test.slow();
  await openBuiltRoom(page, { loadSplat: true });
  await page.getByRole('group', { name: 'Navigation' }).getByRole('button', { name: 'Walk' }).click();
  await page.waitForFunction(() => Boolean(window.__spacegenWalk), undefined, { timeout: 30000 });
  await page.evaluate(() => window.__spacegenWalk!.setLook(0.6, 0));
  await page.waitForTimeout(3000);
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: screenshotPath('walkthrough-splat.png') });
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: screenshotPath('walkthrough-mesh.png') });
});

test('presentation viewer keeps clients inside the room and offers Walk', async ({ page, browser, request }) => {
  test.slow();
  const projectId = `walk-share-${Date.now()}`;
  const api = process.env.E2E_API_URL || 'http://127.0.0.1:8765';
  const now = new Date().toISOString();
  const created = await request.post(`${api}/api/projects`, {
    data: { ...fixture, id: projectId, sceneSnapshot: {}, variants: [{ id: 'default', name: 'Default', sceneSnapshot: {}, createdAt: now }], activeVariantId: 'default' },
  });
  expect(created.status(), await created.text()).toBe(201);

  await page.route('**/*.sog', (route) => route.abort());
  await page.goto(`/editor/${projectId}`);
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review scan' }).click();
  await page.getByRole('button', { name: 'Build editable room from scan' }).click();
  await expect(page.getByRole('region', { name: 'Scan review' }).getByTestId('status-wall_north')).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 30000 });
  const share = await request.post(`${api}/api/projects/${projectId}/shares`, { data: { label: 'walk' } });
  const { token } = await share.json();

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const client = await context.newPage();
  await client.route('**/*.sog', (route) => route.abort());
  await client.goto(`/p/${token}`, { waitUntil: 'domcontentloaded' });
  await waitForE2EHooks(client);
  await expect(client.getByRole('group', { name: 'Scene kind' })).toHaveCount(0); // clients cannot change it
  await client.evaluate(() => window.__spacegenE2E!.setCamera([40, 30, 40], [4, 1, 3]));
  await expect.poll(async () => inside((await camera(client)).position)).toBe(true);
  await zoomOutAndOrbit(client);
  const confined = await camera(client);
  expect(inside(confined.position), `camera ${confined.position} must stay inside the room`).toBe(true);

  await client.getByRole('group', { name: 'Navigation' }).getByRole('button', { name: 'Walk' }).click();
  await client.waitForFunction(() => Boolean(window.__spacegenWalk), undefined, { timeout: 30000 });
  await expect.poll(async () => (await client.evaluate(() => window.__spacegenWalk!.state())).collider).toBe('scene');
  await client.keyboard.press('Digit2');
  await expect(client.getByTestId('splat-layer')).toBeHidden();
  await context.close();
});
