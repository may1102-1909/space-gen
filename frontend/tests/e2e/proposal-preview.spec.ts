import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { ScreenRect } from '@/components/viewer/E2ECameraHooks';
import type { ProjectManifest } from '@/lib/contracts';
import { screenshotPath, waitForE2EHooks } from './support/artifacts';
import { diffPngs } from './support/pixels';
import { CHAIR_GLB, DETECTED_CHAIR, createPhase1Fixture, getProject } from './support/projects';

// T15: AI proposal preview → orbit → accept → undo/redo → save/reload, against the real backend.
test.use({ video: 'on' });

type Vec3 = [number, number, number];
// Orbit about a pivot 0.6 m beside the chair (orbiting about the chair itself would keep it centred).
const PIVOT: Vec3 = [0.1, 0.465, -4.05];
const VIEW_A: [Vec3, Vec3] = [[0.1, 1.4, -2.2], PIVOT];
const VIEW_B: [Vec3, Vec3] = [[1.5, 1.4, -2.8], PIVOT];
const GHOST_MIN_CHANGED = 0.05;

async function setView(page: Page, view: [Vec3, Vec3]) {
  await page.evaluate(([p, t]) => window.__spacegenE2E!.setCamera(p, t), view);
  await page.waitForTimeout(800);
}

/** Screenshot of only the Pascal foreground (splat canvas hidden) inside `rect`. */
async function captureForeground(page: Page, rect: ScreenRect): Promise<Buffer> {
  await page.evaluate(() => document.querySelectorAll<HTMLCanvasElement>('canvas[data-testid="splat-canvas"]').forEach((c) => (c.style.visibility = 'hidden')));
  await page.waitForTimeout(300);
  const png = await page.screenshot({ clip: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } });
  await page.evaluate(() => document.querySelectorAll<HTMLCanvasElement>('canvas').forEach((c) => (c.style.visibility = '')));
  return png;
}

async function openProject(page: Page, id: string) {
  await page.goto(`/editor/${id}`, { waitUntil: 'domcontentloaded' });
  await waitForE2EHooks(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.waitForFunction(() => (window.__spacegenSplat?.numSplats() ?? 0) > 0, undefined, { timeout: 60000 });
}

const editCount = (page: Page) => page.evaluate(() => window.__spacegenSplat!.editCount());
const ghosts = (page: Page) => page.evaluate(() => window.__spacegenE2E!.proposalGhosts());

test('replace the chair with an attached GLB: ghost preview tracks the scene, accept is one undo step, persists', async ({ page, request }) => {
  test.slow();
  const projectId = `proposal-${Date.now()}`;
  await createPhase1Fixture(request, projectId);
  await openProject(page, projectId);

  // Foreground baselines (detected chair only) at both viewpoints.
  await setView(page, VIEW_B);
  const rectB = await page.evaluate((obb) => window.__spacegenE2E!.projectObb(obb), DETECTED_CHAIR.obb);
  const baseB = await captureForeground(page, rectB);
  await setView(page, VIEW_A);
  const rectA = await page.evaluate((obb) => window.__spacegenE2E!.projectObb(obb), DETECTED_CHAIR.obb);
  const baseA = await captureForeground(page, rectA);

  // 1. Attach the GLB in chat and ask for the replacement.
  await page.getByLabel('Attach photo or GLB').setInputFiles({ name: 'Modern Chair.glb', mimeType: 'model/gltf-binary', buffer: fs.readFileSync(CHAIR_GLB) });
  await expect(page.getByText('Modern Chair.glb')).toBeVisible();
  const input = page.getByPlaceholder('Describe design changes, move objects, or ask AI...');
  await input.fill('replace the chair with this model');
  await input.press('Enter');

  // 2. A pending card and a ghost node; nothing committed yet.
  const card = page.getByRole('group', { name: 'Proposal: replace Modern Chair' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Accept' })).toBeEnabled();
  await expect(card.getByRole('button', { name: 'Adjust' })).toBeVisible();
  const [ghost] = await ghosts(page);
  expect(ghost.position).toEqual(DETECTED_CHAIR.position);
  await page.waitForFunction((id) => window.__spacegenE2E!.renderedNodePosition(id) !== null, ghost.ghostId);
  await expect(page.getByRole('button', { name: /Modern Chair/ })).toHaveCount(0); // ghosts are not scene-panel items
  expect(await editCount(page), 'would-be mask previewed on the splat').toBe(1);
  await expect(page.getByRole('banner').getByTitle('Undo (Ctrl+Z)')).toBeDisabled();

  // 3. Orbit: the rendered ghost stays on the scene point and is drawn there in both views.
  const samples: Array<{ ghost: { x: number; y: number }; point: { x: number; y: number } }> = [];
  for (const [view, rect, base] of [[VIEW_A, rectA, baseA], [VIEW_B, rectB, baseB]] as const) {
    await setView(page, view);
    const sample = await page.evaluate(({ id, point }) => {
      const hooks = window.__spacegenE2E!;
      return { ghost: hooks.projectPoint(hooks.renderedNodePosition(id)!), point: hooks.projectPoint(point) };
    }, { id: ghost.ghostId, point: ghost.position });
    expect(Math.hypot(sample.ghost.x - sample.point.x, sample.ghost.y - sample.point.y)).toBeLessThan(1);
    samples.push(sample);
    const drawn = await diffPngs(page, base, await captureForeground(page, rect));
    console.log('ghost foreground vs baseline', drawn);
    expect(drawn.changedFraction, 'ghost drawn over the chair').toBeGreaterThan(GHOST_MIN_CHANGED);
    if (view === VIEW_A) await page.screenshot({ path: screenshotPath('proposal-preview.png') });
  }
  const moved = Math.hypot(samples[1].ghost.x - samples[0].ghost.x, samples[1].ghost.y - samples[0].ghost.y);
  expect(moved, 'orbiting moves the ghost on screen').toBeGreaterThan(50);

  // 4. Accept → one undo step for node + mask + EditRecord.
  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(card.getByText('accepted')).toBeVisible();
  await expect(page.getByRole('button', { name: /Modern Chair/ }).first()).toBeVisible();
  expect(await ghosts(page)).toEqual([]);
  expect(await page.evaluate((id) => window.__spacegenE2E!.renderedNodePosition(id), ghost.ghostId)).toBeNull();
  expect(await editCount(page)).toBe(1);

  const undo = page.getByRole('banner').getByTitle('Undo (Ctrl+Z)');
  const redo = page.getByRole('banner').getByTitle('Redo (Ctrl+Y)');
  await undo.click();
  await expect(page.getByRole('button', { name: /Detected Chair/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Modern Chair/ })).toHaveCount(0);
  expect(await editCount(page)).toBe(0);
  expect(await ghosts(page)).toEqual([]);
  await expect(undo, 'the accept was exactly one step').toBeDisabled();
  await redo.click();
  await expect(page.getByRole('button', { name: /Modern Chair/ }).first()).toBeVisible();
  expect(await editCount(page)).toBe(1);
  await expect(redo).toBeDisabled();

  // 5. Save: the backend has the replacement, its mask and the EditRecord, and no ghost.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const saved = await getProject(request, projectId);
  const nodes = Object.values(saved.manifest.sceneSnapshot.nodes as Record<string, { id: string; type: string; name: string; position: number[] }>);
  expect(nodes.some((n) => n.id.includes('ghost'))).toBe(false);
  const items = nodes.filter((n) => n.type === 'item');
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ name: 'Modern Chair', position: DETECTED_CHAIR.position });
  expect(saved.manifest.maskRegions).toHaveLength(1);
  expect(saved.manifest.maskRegions[0]).toMatchObject({ obb: DETECTED_CHAIR.obb, ghost: false });
  expect(saved.manifest.history).toHaveLength(1);
  expect(saved.manifest.history[0]).toMatchObject({ proposalId: ghost.proposalId, op: 'replace', targetNodeId: 'item_detected_chair' });

  // 6. Reload: same placement, mask and history; undo starts at the loaded state.
  await openProject(page, projectId);
  await page.getByRole('button', { name: /Modern Chair/ }).first().click();
  await expect(page.getByRole('spinbutton', { name: 'Pos X (m)' })).toHaveValue('0.5');
  await expect(page.getByRole('spinbutton', { name: 'Pos Z (m)' })).toHaveValue('-4.5');
  await expect(page.getByText('Masked (0%)')).toBeVisible();
  expect(await editCount(page)).toBe(1);
  expect(await ghosts(page)).toEqual([]);
  await expect(page.getByRole('banner').getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  expect((await getProject(request, projectId)).manifest.history).toHaveLength(1);

  await page.close();
  await page.video()?.saveAs(screenshotPath('proposal-preview.webm'));
});

test('unreviewed walls: the chat says to review the scan and opens Review mode', async ({ page }) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/realistic_room.json'), 'utf-8'));
  const id = fixture.id as string;
  let manifest: ProjectManifest = { ...fixture, sceneSnapshot: {} };
  let revision = 1;
  // UI-only flow: no splat download, project API served from memory.
  await page.route('**/*.sog', (route) => route.abort());
  await page.route(`**/api/projects/${id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      manifest = route.request().postDataJSON();
      revision += 1;
    }
    await route.fulfill({ json: { manifest, revision, updatedAt: new Date().toISOString() } });
  });

  await page.goto(`/editor/${id}`);
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
  const reviewToggle = page.getByRole('button', { name: 'Review scan' });
  await reviewToggle.click();
  await page.getByRole('button', { name: 'Build editable room from scan' }).click();
  await expect(page.getByRole('region', { name: 'Scan review' }).getByTestId('trust-warning')).toContainText('unreviewed');
  await reviewToggle.click();

  const input = page.getByPlaceholder('Describe design changes, move objects, or ask AI...');
  await input.fill('add a chair');
  await input.press('Enter');
  const hint = page.getByRole('note').filter({ hasText: 'Review the scan so I can place against walls' });
  await expect(hint).toBeVisible();
  await hint.getByRole('button', { name: 'Open Review mode' }).click();
  await expect(page.getByRole('region', { name: 'Scan review' })).toBeVisible();
  await expect(reviewToggle).toHaveAttribute('aria-pressed', 'true');
});
