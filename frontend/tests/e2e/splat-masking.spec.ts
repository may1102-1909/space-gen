import { test, expect } from '@playwright/test';

test.describe('T08: Splat Masking & Replacement Verification', () => {
  test('replacing a chair creates mask, hides splats from 4 angles, toggles ghost mode, resizes, and supports undo/redo', async ({
    page,
  }) => {
    test.setTimeout(120000);

    // 1. Mock furniture catalog endpoint for reliable E2E assets
    await page.route('**/api/reconstruction/furniture-catalog', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'chair-original-e2e',
            name: 'Original Scanned Chair',
            category: 'chair',
            style: 'Classic',
            dimensions: { width_m: 0.55, depth_m: 0.55, height_m: 0.85 },
            color_preview: '#888888',
            description: 'Original Chair Fixture',
            filename: 'chair.glb',
            url: '/samples/models/chair.glb',
          },
          {
            id: 'chair-replacement-e2e',
            name: 'Modern Replacement Chair',
            category: 'chair',
            style: 'Contemporary',
            dimensions: { width_m: 0.6, depth_m: 0.6, height_m: 0.9 },
            color_preview: '#e07a5f',
            description: 'Replacement Chair Fixture',
            filename: 'chair.glb',
            url: '/samples/models/chair.glb',
          },
        ]),
      })
    );

    // 2. Navigate to editor
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Add Catalog Item' })).toBeVisible({ timeout: 20000 });

    // 3. Add original chair into the scene
    await page.getByRole('button', { name: 'Add Catalog Item' }).click();
    await page.getByRole('button', { name: /Original Scanned Chair/i }).click();
    const originalChair = page.getByRole('button', { name: /Original Scanned Chair/i }).first();
    await expect(originalChair).toBeVisible({ timeout: 10000 });

    // 5. Replace original chair with Modern Replacement Chair
    const replaceButton = page.getByRole('button', { name: /Replace \/ Add Catalog Item/i });
    await expect(replaceButton).toBeVisible();
    await replaceButton.click();

    const replacementOption = page.getByRole('button', { name: /Modern Replacement Chair/i });
    await expect(replacementOption).toBeVisible({ timeout: 10000 });
    await replacementOption.click();

    // 6. Verify replaced item in hierarchy
    await expect(page.getByRole('button', { name: /Modern Replacement Chair/i }).first()).toBeVisible();

    // Verify Splat Mask controls appear automatically for the replaced item
    await expect(page.getByText('Splat Mask')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Masked (0%)')).toBeVisible();

    const ghostToggleButton = page.getByRole('button', { name: 'Toggle Ghost Mode' });
    await expect(ghostToggleButton).toBeVisible();
    await expect(ghostToggleButton).toContainText('Show Original (Ghost Mode)');

    // 7. Test Undo of Replacement: Restores original chair and removes mask
    const undoButton = page.getByRole('banner').getByTitle('Undo (Ctrl+Z)');
    await expect(undoButton).toBeEnabled();
    await undoButton.click();

    // Original chair restored in outliner
    await expect(page.getByRole('button', { name: /Original Scanned Chair/i })).toBeVisible({ timeout: 5000 });
    // Mask controls should no longer be present on the unmasked original chair
    await expect(page.getByText('Masked (0%)')).toHaveCount(0);

    // Test Redo: Re-applies replacement and restores mask
    const redoButton = page.getByRole('banner').getByTitle('Redo (Ctrl+Y)');
    await expect(redoButton).toBeEnabled();
    await redoButton.click();

    // Replaced chair restored
    await expect(page.getByRole('button', { name: /Modern Replacement Chair/i }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Masked (0%)')).toBeVisible();

    // 8. Assert the masks Spark actually receives (not just the panel text).
    type SplatDebug = {
      hasMesh: boolean;
      globalEdits: number;
      edits: { softEdge: number; sdfs: { type: string; opacity: number; halfExtents: number[] }[] }[];
    };
    const readSplat = () =>
      page.evaluate(() => (window as unknown as { __spaceGenSplat?: () => unknown }).__spaceGenSplat?.() ?? null) as Promise<SplatDebug | null>;

    await expect.poll(async () => (await readSplat())?.edits.length ?? -1, { timeout: 10000 }).toBe(1);
    let splat = (await readSplat())!;
    expect(splat.hasMesh).toBe(true);
    // Edits must be scoped to the mesh only; a scene-graph copy would apply the mask twice.
    expect(splat.globalEdits).toBe(0);
    expect(splat.edits[0].sdfs).toHaveLength(1);
    expect(splat.edits[0].sdfs[0].type).toBe('box');
    expect(splat.edits[0].sdfs[0].opacity).toBe(0);
    // Original chair is 0.55 m wide -> 0.275 m half-extent.
    expect(splat.edits[0].sdfs[0].halfExtents[0]).toBeCloseTo(0.275, 3);

    // Undo removes the splat edit, redo restores it.
    await undoButton.click();
    await expect.poll(async () => (await readSplat())?.edits.length ?? -1).toBe(0);
    await redoButton.click();
    await expect.poll(async () => (await readSplat())?.edits.length ?? -1).toBe(1);

    // Fresh evidence screenshots for this run (attached to the report, never reused from disk).
    const viewerCanvas = page.locator('canvas').last();
    const canvasBox = await viewerCanvas.boundingBox();
    const cx = canvasBox ? canvasBox.x + canvasBox.width / 2 : 400;
    const cy = canvasBox ? canvasBox.y + canvasBox.height / 2 : 300;
    const capture = async (name: string) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: test.info().outputPath(name) });
      await test.info().attach(name, { path: test.info().outputPath(name), contentType: 'image/png' });
    };
    const orbit = async (dx: number, dy: number) => {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + dx, cy + dy, { steps: 3 });
      await page.mouse.up();
    };

    await capture('chair-mask-angle-1-front.png');
    await orbit(90, -20);
    await capture('chair-mask-angle-2-perspective.png');
    await orbit(90, -10);
    await capture('chair-mask-angle-3-side.png');
    await orbit(0, 120);
    await capture('chair-mask-angle-4-top.png');

    // 9. Ghost mode: one edit at 25% opacity (not 0.25^2 from a duplicated edit).
    await ghostToggleButton.click();
    await expect(page.getByText('Ghost (25%)')).toBeVisible();
    await expect(ghostToggleButton).toContainText('Show Original: On (Ghost Mode)');
    await expect.poll(async () => (await readSplat())?.edits[0]?.sdfs[0]?.opacity).toBeCloseTo(0.25, 3);
    splat = (await readSplat())!;
    expect(splat.edits).toHaveLength(1);
    expect(splat.globalEdits).toBe(0);
    await capture('chair-mask-ghost-mode.png');

    // Toggle back to Masked (0%)
    await ghostToggleButton.click();
    await expect(page.getByText('Masked (0%)')).toBeVisible();
    await expect.poll(async () => (await readSplat())?.edits[0]?.sdfs[0]?.opacity).toBe(0);

    // 10. Test Mask Resizing Controls & Undo
    const widthInput = page.getByRole('spinbutton', { name: 'Mask Width (m)' });
    await expect(widthInput).toBeVisible();
    await widthInput.fill('0.85');
    await widthInput.blur();
    await expect(widthInput).toHaveValue('0.85');
    await expect.poll(async () => (await readSplat())?.edits[0]?.sdfs[0]?.halfExtents[0]).toBeCloseTo(0.425, 3);

    // Undo the resize back to 0.55
    await undoButton.click();
    await expect(widthInput).toHaveValue('0.55');
    await expect.poll(async () => (await readSplat())?.edits[0]?.sdfs[0]?.halfExtents[0]).toBeCloseTo(0.275, 3);
  });
});
