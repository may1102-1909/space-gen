import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { waitForE2EHooks } from './support/artifacts';
import { createPhase1Fixture, getProject, putProject } from './support/projects';

type SnapshotNodes = Record<string, { type: string; name: string; position: number[] }>;

const chairX = async (request: APIRequestContext, id: string) => {
  const { manifest } = await getProject(request, id);
  return Object.values(manifest.sceneSnapshot.nodes as SnapshotNodes).find((n) => n.type === 'item')!.position[0];
};

/** Another client saves the project: the chair moves to x = 1.75 on the server. */
async function concurrentEdit(request: APIRequestContext, id: string) {
  const { manifest, revision } = await getProject(request, id);
  const nodes = structuredClone(manifest.sceneSnapshot.nodes) as SnapshotNodes;
  nodes.item_detected_chair.position = [1.75, 0, -4.5];
  await putProject(request, { ...manifest, sceneSnapshot: { ...manifest.sceneSnapshot, nodes } }, revision);
}

async function openAndEditLocally(page: Page, id: string) {
  await page.goto(`/editor/${id}`, { waitUntil: 'domcontentloaded' });
  await waitForE2EHooks(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Detected Chair/ }).click();
  const x = page.getByRole('spinbutton', { name: 'Pos X (m)' });
  await x.fill('-0.25');
  await x.blur();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
}

test.describe('409 revision conflicts', () => {
  test('overwrite replaces the server copy with this tab\'s version', async ({ page, request }) => {
    const id = `conflict-overwrite-${Date.now()}`;
    await createPhase1Fixture(request, id);
    await openAndEditLocally(page, id);
    await concurrentEdit(request, id);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Save conflict' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('current revision is 3');
    expect(await chairX(request, id)).toBe(1.75);

    await dialog.getByRole('button', { name: 'Overwrite' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect(await chairX(request, id)).toBe(-0.25);
    expect((await getProject(request, id)).revision).toBe(4);
  });

  test('reload latest discards local edits and shows the server copy', async ({ page, request }) => {
    const id = `conflict-reload-${Date.now()}`;
    await createPhase1Fixture(request, id);
    await openAndEditLocally(page, id);
    await concurrentEdit(request, id);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Save conflict' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Reload latest' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Detected Chair/ }).click();
    await expect(page.getByRole('spinbutton', { name: 'Pos X (m)' })).toHaveValue('1.75');
    await expect(page.getByRole('banner').getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
    // Autosave resumes from the reloaded revision without another conflict.
    const x = page.getByRole('spinbutton', { name: 'Pos X (m)' });
    await x.fill('2');
    await x.blur();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect(await chairX(request, id)).toBe(2);
  });
});
