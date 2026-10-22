import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import type { ProjectManifest } from '@/lib/contracts';
import { screenshotPath, waitForE2EHooks } from './support/artifacts';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/realistic_room.json'), 'utf-8'));
type Vec3 = [number, number, number];

async function screenOf(page: Page, point: Vec3) {
  return page.evaluate((p) => window.__spacegenE2E!.projectPoint(p), point);
}

async function topView(page: Page) {
  await waitForE2EHooks(page);
  // A plan view from above the ceiling is outside the room, so interior confinement must be lifted.
  await page.getByRole('group', { name: 'Scene kind' }).getByRole('button', { name: 'Exterior' }).click();
  await page.evaluate(() => window.__spacegenE2E!.setCamera([4, 10, 9], [4, 0, 3]));
}

async function hover(page: Page, point: Vec3) {
  const { x, y } = await screenOf(page, point);
  await page.mouse.move(x - 6, y - 6);
  await page.mouse.move(x, y, { steps: 3 });
}

async function clickAt(page: Page, point: Vec3) {
  await hover(page, point);
  const { x, y } = await screenOf(page, point);
  await page.mouse.click(x, y);
}

test('draw a wall snapped to a corner, add a door, measure, undo/redo, save, reload', async ({ page }) => {
  test.setTimeout(180000);
  const id = fixture.id as string;
  let manifest = { ...fixture, sceneSnapshot: {} };
  let revision = 1;
  const puts: ProjectManifest[] = [];
  // The splat is an unchanged background layer (ADR 001); skip its download to stay within timeouts.
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
  await expect(page.getByRole('region', { name: 'Scan review' }).getByTestId('status-wall_north')).toBeVisible();
  await page.getByRole('button', { name: 'Review scan' }).click();

  await topView(page);
  const tool = (name: string) => page.getByRole('button', { name, exact: true });
  const snap = page.getByTestId('snap-indicator');

  // 1. Wall: start 15 cm off the north-west corner — it snaps onto the corner.
  await tool('Wall').click();
  await hover(page, [0.15, 0, 0.12]);
  await expect(snap).toHaveAttribute('data-snap-kind', 'corner');
  await clickAt(page, [0.15, 0, 0.12]);
  await hover(page, [3, 0, 3]);
  await expect(snap).toHaveAttribute('data-snap-kind', 'floor');
  await clickAt(page, [3, 0, 3]);

  // 2. Door on the new wall (hover the wall body at mid height). Pascal reveals a tool some time
  // after its first arming, and the door tool only takes a click once a hover has snapped its
  // preview onto a wall. Like a user, keep hovering until the preview sits on the wall.
  await tool('Door').click();
  await expect
    .poll(async () => {
      await hover(page, [1.4, 1.0, 1.4]);
      return page.evaluate(() => window.__spacegenE2E!.placementPreview());
    })
    .toEqual({ type: 'door', host: 'wall' });
  await clickAt(page, [1.5, 1.0, 1.5]);

  // 3. Measure the east wall corner to corner; shown as an estimate.
  await tool('Measure').click();
  await hover(page, [7.85, 0, 0.1]);
  await expect(snap).toHaveAttribute('data-snap-kind', 'corner');
  await clickAt(page, [7.85, 0, 0.1]);
  await clickAt(page, [7.9, 0, 5.85]);
  const label = page.getByTestId('measurement-label');
  await expect(label).toHaveText('≈ 6.0 m (±14 cm est.)');

  // 4. Undo / redo: each edit is one step.
  await page.keyboard.press('Escape');
  await tool('Measure').click();
  const undo = page.getByRole('banner').getByTitle('Undo (Ctrl+Z)');
  const redo = page.getByRole('banner').getByTitle('Redo (Ctrl+Y)');
  await undo.click();
  await expect(label).toHaveCount(0);
  await redo.click();
  await expect(label).toHaveText('≈ 6.0 m (±14 cm est.)');

  // 5. Save and check the persisted interpretation.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => puts.length).toBeGreaterThan(0);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const saved = puts[puts.length - 1];
  // The start snapped exactly onto the corner; the end is a free floor point.
  const drawn = saved.interpretation.walls.find((w) => w.provenance === 'user')!;
  expect(drawn).toMatchObject({ start: [0, 0, 0], status: 'corrected' });
  expect(drawn.end[0]).toBeCloseTo(3, 1);
  expect(drawn.end[2]).toBeCloseTo(3, 1);
  const door = saved.interpretation.openings.find((o) => o.wallId === drawn.id)!;
  expect(door).toMatchObject({ kind: 'door', provenance: 'user', status: 'corrected' });
  expect(door.offset).toBeGreaterThan(0.4);
  expect(door.offset).toBeLessThan(3.8);
  expect(saved.interpretation.provenance).toBe('user');
  const nodes = saved.sceneSnapshot.nodes as Record<string, { type: string; measurement: { points: unknown } }>;
  const measurements = Object.values(nodes).filter((n) => n.type === 'measurement');
  expect(measurements).toHaveLength(1);
  expect(measurements[0].measurement.points).toEqual([[8, 0, 0], [8, 0, 6]]);

  // 6. Reload: the wall, door and measurement persist.
  await page.reload();
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
  await topView(page);
  await expect(page.getByTestId('measurement-label')).toHaveText('≈ 6.0 m (±14 cm est.)');
  await page.getByRole('button', { name: 'Review scan' }).click();
  const review = page.getByRole('region', { name: 'Scan review' });
  await expect(review.getByTestId(`status-${drawn.id}`)).toHaveText('corrected · user');
  await expect(review.getByTestId(`status-${door.id}`)).toHaveText('corrected · user');

  await page.screenshot({ path: screenshotPath('architectural-editing.png'), animations: 'disabled', timeout: 30000 });
});
