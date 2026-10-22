import type { ScaleSource } from '@/lib/contracts/scan';
import { errorCm, formatMeasurement } from '@/lib/measurement/accuracy';

/**
 * Paper-space SVG primitives. Every coordinate here is millimetres on the sheet, so a sheet
 * printed at 100% is at true scale (1 m = 1000 / scale mm).
 */

export type Pt = [number, number];
export type DrawingScale = 50 | 100;

export interface SheetOptions {
  scale: DrawingScale;
  projectName: string;
  /** ISO date (yyyy-mm-dd) printed in the title block. */
  date: string;
}

export const FONT = 'Arial, Helvetica, sans-serif';
export const TEXT = 2.2;
export const LINE = { cut: 0.5, outline: 0.35, medium: 0.25, thin: 0.18, fine: 0.13 } as const;

export const f = (n: number) => (Math.round(n * 100) / 100).toString();

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function line(a: Pt, b: Pt, width: number, extra = ''): string {
  return `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="#000" stroke-width="${width}" ${extra}/>`;
}

export function polygon(points: Pt[], attrs: string): string {
  return `<polygon points="${points.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}" ${attrs}/>`;
}

export function text(at: Pt, content: string, opts: { size?: number; anchor?: 'start' | 'middle' | 'end'; angle?: number; weight?: string; extra?: string } = {}): string {
  const { size = TEXT, anchor = 'middle', angle = 0, weight = 'normal', extra = '' } = opts;
  const rot = angle ? ` transform="rotate(${f(angle)} ${f(at[0])} ${f(at[1])})"` : '';
  return `<text x="${f(at[0])}" y="${f(at[1])}" font-size="${size}" font-family="${FONT}" font-weight="${weight}" text-anchor="${anchor}"${rot} ${extra}>${esc(content)}</text>`;
}

/** Rough text advance for layout decisions (Arial averages ~0.55 em per glyph). */
export const textWidth = (s: string, size = TEXT) => s.length * size * 0.55;

/** The estimate formatter's output split at " (" so long labels fit a dimension: "≈ 2.00 m" / "(±5 cm est.)". */
export function measurementLines(meters: number, scaleSource: ScaleSource): [string, string] {
  const label = formatMeasurement(meters, scaleSource);
  const i = label.indexOf(' (');
  return i > 0 ? [label.slice(0, i), label.slice(i + 1)] : [label, ''];
}

/**
 * A dimension between paper points a and b, drawn `offset` mm along the unit normal `n`, with
 * extension lines, 45° architectural ticks and a two-line estimate label outside the line.
 * `row` pushes a label one more row outward when neighbours would collide.
 */
export function dimension(a: Pt, b: Pt, n: Pt, offset: number, meters: number, scaleSource: ScaleSource, opts: { role: string; row?: number; id?: string } = { role: 'dimension' }): string {
  const A: Pt = [a[0] + n[0] * offset, a[1] + n[1] * offset];
  const B: Pt = [b[0] + n[0] * offset, b[1] + n[1] * offset];
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
  const d: Pt = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
  const ext = (p: Pt, P: Pt) => line([p[0] + n[0] * 1.5, p[1] + n[1] * 1.5], [P[0] + n[0] * 1.5, P[1] + n[1] * 1.5], LINE.fine);
  const tick = (P: Pt) => {
    const t: Pt = [(d[0] + n[0]) * 1.1, (d[1] + n[1]) * 1.1];
    return line([P[0] - t[0], P[1] - t[1]], [P[0] + t[0], P[1] + t[1]], LINE.medium);
  };
  let angle = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
  if (angle > 89.99) angle -= 180;
  else if (angle < -90.01) angle += 180;
  // Text sits on the outer side; its baseline offset depends on whether the rotated text's "up" faces n.
  const rad = (angle * Math.PI) / 180;
  const up: Pt = [Math.sin(rad), -Math.cos(rad)];
  const upFacesOut = up[0] * n[0] + up[1] * n[1] > 0;
  const [l1, l2] = measurementLines(meters, scaleSource);
  const row = opts.row ?? 0;
  const mid: Pt = [(A[0] + B[0]) / 2 + n[0] * row * 6.2, (A[1] + B[1]) / 2 + n[1] * row * 6.2];
  const at = (dist: number): Pt => [mid[0] + n[0] * dist, mid[1] + n[1] * dist];
  // The value sits nearest the line, the error just outside it. `dist` is where the glyph box
  // starts; SVG places the baseline, so text whose top faces the line moves out by its cap height.
  const baseline = (dist: number, size: number) => at(upFacesOut ? dist : dist + size * 0.72);
  const valueAt = baseline(0.9, TEXT);
  const errAt = baseline(0.9 + TEXT * 1.15, TEXT * 0.85);
  const leader = row ? line([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], at(-0.2), LINE.fine, 'stroke-dasharray="0.6 0.6"') : '';
  return `<g data-kind="dimension" data-role="${opts.role}" data-value="${meters.toFixed(4)}"${opts.id ? ` data-for="${esc(opts.id)}"` : ''}>${ext(a, A)}${ext(b, B)}${line(
    [A[0] - d[0] * 1.5, A[1] - d[1] * 1.5],
    [B[0] + d[0] * 1.5, B[1] + d[1] * 1.5],
    LINE.thin,
  )}${tick(A)}${tick(B)}${leader}${text(valueAt, l1, { angle })}${l2 ? text(errAt, l2, { angle, size: TEXT * 0.85 }) : ''}</g>`;
}

/** Label rows for a chain of segments: a label wider than its segment alternates outward. */
export function chainRows(segmentLengthsMm: number[], scaleSource: ScaleSource, metersOf: (i: number) => number): number[] {
  let lastCrowded = false;
  return segmentLengthsMm.map((mm, i) => {
    const [l1, l2] = measurementLines(metersOf(i), scaleSource);
    const crowded = Math.max(textWidth(l1), textWidth(l2, TEXT * 0.85)) + 1 > mm;
    const row = crowded && lastCrowded ? 0 : crowded ? 1 : 0;
    lastCrowded = crowded && row === 1;
    return row;
  });
}

export function scaleBar(at: Pt, scale: DrawingScale): string {
  const k = 1000 / scale;
  const total = scale === 50 ? 2 : 5;
  const step = scale === 50 ? 0.5 : 1;
  let out = '';
  for (let i = 0; i * step < total; i++) {
    const x = at[0] + i * step * k;
    out += `<rect x="${f(x)}" y="${f(at[1])}" width="${f(step * k)}" height="1.6" fill="${i % 2 ? '#fff' : '#000'}" stroke="#000" stroke-width="${LINE.fine}"/>`;
  }
  for (let m = 0; m <= total; m += 1) out += text([at[0] + m * k, at[1] + 4.6], `${m}`, { size: 2 });
  out += text([at[0] + total * k + 3, at[1] + 1.5], 'm', { size: 2, anchor: 'start' });
  return `<g data-kind="scale-bar">${out}</g>`;
}

export function northArrow(at: Pt): string {
  const [x, y] = at;
  return `<g data-kind="north-arrow"><circle cx="${f(x)}" cy="${f(y)}" r="5" fill="none" stroke="#000" stroke-width="${LINE.thin}"/>${polygon(
    [[x, y - 5], [x + 2.2, y + 3], [x, y + 1.6], [x - 2.2, y + 3]],
    'fill="#000"',
  )}${text([x, y - 6.5], 'PN', { size: 2.2, weight: 'bold' })}</g>`;
}

export const TITLE_BLOCK = { width: 130, height: 34 };

/** Title block, bottom-right of the sheet; returns its markup. */
export function titleBlock(origin: Pt, opts: SheetOptions, title: string, scaleSource: ScaleSource, maxDimension: number): string {
  const [x, y] = origin;
  const { width: w, height: h } = TITLE_BLOCK;
  const err = errorCm(maxDimension, scaleSource);
  const row = (yy: number, label: string, value: string, size = 2.6) =>
    text([x + 3, yy], label.toUpperCase(), { size: 1.6, anchor: 'start', extra: 'fill="#555"' }) + text([x + 24, yy], value, { size, anchor: 'start' });
  return `<g data-kind="title-block"><rect x="${f(x)}" y="${f(y)}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="${LINE.outline}"/>${line(
    [x, y + 23],
    [x + w, y + 23],
    LINE.fine,
  )}${row(y + 6, 'Project', opts.projectName, 3.2)}${row(y + 12, 'Drawing', title)}${row(y + 18, 'Scale', `1:${opts.scale} (print at 100%)`)}${text(
    [x + w - 3, y + 18],
    opts.date,
    { size: 2.6, anchor: 'end', extra: 'data-role="date"' },
  )}${text([x + 3, y + 27.5], `Dimensions estimated ±${err} cm from scan (scale source: ${scaleSource.replace('_', ' ')}).`, {
    size: 2,
    anchor: 'start',
    extra: 'data-role="accuracy-note"',
  })}${text([x + 3, y + 31], 'Verify on site before use. Not for construction.', { size: 2, anchor: 'start' })}</g>`;
}

export function sheet(widthMm: number, heightMm: number, body: string, kind: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(widthMm)}mm" height="${f(heightMm)}mm" viewBox="0 0 ${f(widthMm)} ${f(heightMm)}" data-drawing="${kind}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
}
