import { test, expect } from '@playwright/test';

test.use({ video: 'on' });

test('place, move, replace, undo three actions, and redo one action', async ({ page }) => {
  await page.route('http://localhost:8000/api/reconstruction/furniture-catalog', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { id: 'chair-a', name: 'E2E Chair A', category: 'chair', style: 'Test', dimensions: { width_m: 0.5, depth_m: 0.5, height_m: 0.8 }, color_preview: '#777777', description: 'Catalog fixture', filename: 'chair.glb', url: '/samples/models/chair.glb' },
      { id: 'chair-b', name: 'E2E Chair B', category: 'chair', style: 'Test', dimensions: { width_m: 0.6, depth_m: 0.6, height_m: 0.9 }, color_preview: '#777777', description: 'Replacement fixture', filename: 'chair.glb', url: '/samples/models/chair.glb' },
    ]),
  }));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Add Catalog Item' })).toBeVisible();
  const undo = page.getByRole('banner').getByTitle('Undo (Ctrl+Z)');
  const redo = page.getByRole('banner').getByTitle('Redo (Ctrl+Y)');

  // The legacy demo seed creates history of its own. Clear that visible history
  // so the three undo operations below cover only this test's user actions.
  for (let i = 0; i < 60 && await undo.isEnabled(); i += 1) {
    await undo.click();
  }
  await expect(undo).toBeDisabled();

  await page.getByRole('button', { name: 'Add Catalog Item' }).click();
  await page.getByRole('button', { name: /E2E Chair A/ }).click();
  const placedItem = page.getByRole('button', { name: /E2E Chair A/ }).first();
  await expect(placedItem).toBeVisible();
  await expect(undo).toBeEnabled();

  const x = page.getByRole('spinbutton', { name: 'Pos X (m)' });
  await x.fill('1.2');
  await x.blur();
  await expect(x).toHaveValue('1.2');

  await page.getByRole('button', { name: /Replace \/ Add Catalog Item/ }).click();
  await page.getByRole('button', { name: /E2E Chair B/ }).click();
  await expect(page.getByRole('button', { name: /E2E Chair B/ }).first()).toBeVisible();
  await expect(x).toHaveValue('1.2');

  // Undo replacement, movement, and placement. Redo should restore placement.
  await undo.click();
  await expect(page.getByRole('button', { name: /E2E Chair A/ }).first()).toBeVisible();
  await undo.click();
  await expect(x).toHaveValue('0');
  await undo.click();
  await expect(page.getByRole('button', { name: /E2E Chair A/ })).toHaveCount(0);

  await redo.click();
  await expect(page.getByRole('button', { name: /E2E Chair A/ }).first()).toBeVisible();
  await expect(x).toHaveValue('0');
});
