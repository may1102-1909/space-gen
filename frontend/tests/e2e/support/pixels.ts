import type { Page } from '@playwright/test';
import type { ScreenRect } from '@/components/viewer/E2ECameraHooks';
import { screenshotPath } from './artifacts';

export interface PixelDiff {
  /** Mean absolute RGB difference, 0–255. */
  meanAbsDiff: number;
  /** Fraction of pixels whose max channel difference exceeds 24. */
  changedFraction: number;
}

/**
 * Screenshot of only the splat layer inside `rect`: every other canvas (the Pascal foreground with
 * the replacement GLB and the mask wireframe) is hidden for the capture, so differences come from
 * splat pixels alone.
 */
export async function captureSplatRegion(page: Page, rect?: ScreenRect, path?: string): Promise<Buffer> {
  await page.evaluate(() => {
    document.querySelectorAll('canvas').forEach((canvas) => {
      if (canvas.dataset.testid !== 'splat-canvas') canvas.style.visibility = 'hidden';
    });
  });
  // Let the splat layer render a few frames with the current scene state.
  await page.waitForTimeout(700);
  const clip = rect && { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  const png = await page.screenshot({ clip, path });
  await page.evaluate(() => {
    document.querySelectorAll('canvas').forEach((canvas) => {
      canvas.style.visibility = '';
    });
  });
  return png;
}

/** Full-viewport evidence screenshot of only the splat layer. */
export async function screenshotSplatOnly(page: Page, name: string): Promise<void> {
  await captureSplatRegion(page, undefined, screenshotPath(name));
}

export async function diffPngs(page: Page, a: Buffer, b: Buffer): Promise<PixelDiff> {
  return page.evaluate(async ([a64, b64]) => {
    const decode = async (b64: string) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [pa, pb] = await Promise.all([decode(a64), decode(b64)]);
    if (pa.length !== pb.length) throw new Error('Pixel buffers differ in size');
    let sum = 0;
    let changed = 0;
    const pixels = pa.length / 4;
    for (let i = 0; i < pa.length; i += 4) {
      const dr = Math.abs(pa[i] - pb[i]);
      const dg = Math.abs(pa[i + 1] - pb[i + 1]);
      const db = Math.abs(pa[i + 2] - pb[i + 2]);
      sum += (dr + dg + db) / 3;
      if (Math.max(dr, dg, db) > 24) changed += 1;
    }
    return { meanAbsDiff: sum / pixels, changedFraction: changed / pixels };
  }, [a.toString('base64'), b.toString('base64')] as const);
}
