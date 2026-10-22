import { formatMeasurement } from '@/lib/measurement/accuracy';
import type { DrawingModel, DrawingWall } from './model';
import { chainRows, dimension, esc, f, LINE, line, sheet, text, TITLE_BLOCK, titleBlock, type Pt, type SheetOptions } from './svg';

export interface ElevationOpening {
  id: string;
  kind: 'door' | 'window' | 'opening';
  /** Left and right jamb, metres from the left end of the visible interior face. */
  left: number;
  right: number;
  sill: number;
  head: number;
  /** Hinge side as seen in the elevation. */
  hinge: 'left' | 'right';
}

export interface ElevationLayout {
  wallId: string;
  /** Interior face length (inside corner to inside corner). */
  faceLength: number;
  wallHeight: number;
  ceilingHeight: number;
  openings: ElevationOpening[];
}

/**
 * Interior elevation geometry for one wall: seen from inside the room looking at the wall, so the
 * horizontal axis runs left-to-right for that viewer.
 */
export function elevationLayout(model: DrawingModel, wall: DrawingWall): ElevationLayout {
  // Viewer faces -inward; their right in plan (x right, z down) is (inward.z, -inward.x).
  const right = [wall.inward[1], -wall.inward[0]];
  const sigma = wall.dir[0] * right[0] + wall.dir[1] * right[1] >= 0 ? 1 : -1;
  const u = (s: number) => sigma * s;
  const u0 = Math.min(u(wall.faceStart), u(wall.faceEnd));
  const openings = wall.openings
    .map((op): ElevationOpening => {
      const a = u(op.center - op.width / 2) - u0;
      const b = u(op.center + op.width / 2) - u0;
      const hingeAtStart = op.hinge === 'start';
      const startIsLeft = sigma > 0;
      return {
        id: op.id,
        kind: op.kind,
        left: Math.min(a, b),
        right: Math.max(a, b),
        sill: op.sill,
        head: op.sill + op.height,
        hinge: hingeAtStart === startIsLeft ? 'left' : 'right',
      };
    })
    .sort((a, b) => a.left - b.left);
  return { wallId: wall.id, faceLength: wall.faceEnd - wall.faceStart, wallHeight: wall.height, ceilingHeight: model.ceilingHeight, openings };
}

/** One interior elevation sheet per wall. */
export function renderElevationSvg(model: DrawingModel, wallId: string, opts: SheetOptions): string {
  const wall = model.walls.find((w) => w.id === wallId);
  if (!wall) throw new Error(`No wall ${wallId} in the drawing model.`);
  const layout = elevationLayout(model, wall);
  const src = model.scaleSource;
  const k = 1000 / opts.scale;
  const top = Math.max(layout.wallHeight, layout.ceilingHeight);
  const left = 28;
  const drawW = layout.faceLength * k;
  const width = Math.max(left + drawW + 52, TITLE_BLOCK.width + 20);
  const ground = 22 + top * k;
  const height = ground + 40 + TITLE_BLOCK.height + 6;
  const P = (uu: number, y: number): Pt => [left + uu * k, ground - y * k];
  const out: string[] = [];

  out.push(line(P(-0.6, 0), P(layout.faceLength + 0.6, 0), LINE.cut));
  out.push(`<rect data-kind="wall-face" data-id="${esc(wall.id)}" x="${f(left)}" y="${f(ground - layout.wallHeight * k)}" width="${f(drawW)}" height="${f(layout.wallHeight * k)}" fill="#fff" stroke="#000" stroke-width="${LINE.outline}"/>`);
  // Cut adjoining walls at both ends.
  const cut = wall.thickness * k;
  for (const x of [left - cut, left + drawW]) {
    out.push(`<rect x="${f(x)}" y="${f(ground - top * k)}" width="${f(cut)}" height="${f(top * k)}" fill="#5a5a5a" stroke="#000" stroke-width="${LINE.outline}"/>`);
  }
  out.push(line(P(0, layout.ceilingHeight), P(layout.faceLength, layout.ceilingHeight), LINE.thin, 'stroke-dasharray="3 1.5" data-kind="ceiling"'));
  out.push(text([left + 2, ground - layout.ceilingHeight * k + 3.2], 'CEILING', { size: 1.8, anchor: 'start' }));

  for (const op of layout.openings) {
    const [x0, yTop] = P(op.left, op.head);
    const [x1, yBot] = P(op.right, op.sill);
    const parts = [`<rect x="${f(x0)}" y="${f(yTop)}" width="${f(x1 - x0)}" height="${f(yBot - yTop)}" fill="#fff" stroke="#000" stroke-width="${LINE.medium}"/>`];
    if (op.kind === 'window') {
      const inset = 0.05 * k;
      parts.push(`<rect x="${f(x0 + inset)}" y="${f(yTop + inset)}" width="${f(x1 - x0 - 2 * inset)}" height="${f(yBot - yTop - 2 * inset)}" fill="none" stroke="#000" stroke-width="${LINE.fine}"/>`);
      parts.push(line([x0 - 1, yBot + 0.6], [x1 + 1, yBot + 0.6], LINE.thin));
    } else if (op.kind === 'door') {
      // Swing lines meet at the hinge side.
      const hx = op.hinge === 'left' ? x0 : x1;
      const lx = op.hinge === 'left' ? x1 : x0;
      const dash = 'stroke-dasharray="1.5 1"';
      parts.push(line([lx, yTop], [hx, (yTop + yBot) / 2], LINE.fine, dash), line([lx, yBot], [hx, (yTop + yBot) / 2], LINE.fine, dash));
    }
    out.push(`<g data-kind="opening" data-id="${esc(op.id)}" data-opening-kind="${op.kind}" data-left="${op.left.toFixed(4)}" data-right="${op.right.toFixed(4)}" data-sill="${op.sill.toFixed(4)}" data-head="${op.head.toFixed(4)}">${parts.join('')}</g>`);
    // Sill and head heights, just right of the opening.
    const hasSill = op.sill > 1e-3;
    if (hasSill) out.push(dimension(P(op.right, 0), P(op.right, op.sill), [1, 0], 3, op.sill, src, { role: 'sill', id: op.id }));
    out.push(dimension(P(op.right, 0), P(op.right, op.head), [1, 0], hasSill ? 10 : 3, op.head, src, { role: 'head', id: op.id }));
  }

  // Horizontal chain under the floor line, then the overall face length.
  const breaks = [0, ...layout.openings.flatMap((o) => [o.left, o.right]).filter((x) => x > 1e-3 && x < layout.faceLength - 1e-3), layout.faceLength].sort((a, b) => a - b);
  let offset = 8;
  if (breaks.length > 2) {
    const segs = breaks.slice(1).map((x, i) => x - breaks[i]);
    const rows = chainRows(segs.map((m) => m * k), src, (i) => segs[i]);
    segs.forEach((m, i) => out.push(dimension(P(breaks[i], 0), P(breaks[i + 1], 0), [0, 1], offset, m, src, { role: 'chain', row: rows[i], id: wall.id })));
    offset += rows.some(Boolean) ? 14 : 9;
  }
  out.push(dimension(P(0, 0), P(layout.faceLength, 0), [0, 1], offset, layout.faceLength, src, { role: 'face-length', id: wall.id }));
  // Ceiling (and wall height when it differs) on the right.
  out.push(dimension(P(layout.faceLength, 0), P(layout.faceLength, layout.ceilingHeight), [1, 0], cut + 10, layout.ceilingHeight, src, { role: 'ceiling-height', id: wall.id }));
  if (Math.abs(layout.wallHeight - layout.ceilingHeight) > 1e-3) {
    out.push(dimension(P(layout.faceLength, 0), P(layout.faceLength, layout.wallHeight), [1, 0], cut + 20, layout.wallHeight, src, { role: 'wall-height', id: wall.id }));
  }

  const title = `Interior elevation — ${wall.name}`;
  out.push(text([left, 12], title.toUpperCase(), { size: 3.2, anchor: 'start', weight: 'bold' }));
  out.push(text([left, 16.5], `Seen from inside the room · wall length ${formatMeasurement(wall.length, src)} on centreline`, { size: 2, anchor: 'start' }));
  out.push(titleBlock([width - TITLE_BLOCK.width - 6, height - TITLE_BLOCK.height - 6], opts, title, src, Math.max(layout.faceLength, top)));
  return sheet(width, height, out.join(''), 'elevation');
}
