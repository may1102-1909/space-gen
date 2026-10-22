import { formatArea, formatMeasurement } from '@/lib/measurement/accuracy';
import type { DrawingModel, DrawingOpening, DrawingWall, Vec2 } from './model';
import {
  chainRows, dimension, esc, f, LINE, line, measurementLines, northArrow, polygon, scaleBar, sheet, text, TEXT, TITLE_BLOCK, titleBlock,
  type Pt, type SheetOptions,
} from './svg';

const MARGIN = 42;

/** Wall-start -> breakpoint distances for a wall's chain dimension: corners and opening jambs. */
export function wallChain(wall: DrawingWall): number[] {
  const cuts = wall.openings.flatMap((o) => [o.center - o.width / 2, o.center + o.width / 2]);
  return [0, ...cuts.filter((s) => s > 1e-3 && s < wall.length - 1e-3), wall.length].sort((a, b) => a - b);
}

/** Outer extent of the wall outlines, which the overall dimensions measure. */
export function wallExtent(model: DrawingModel) {
  const pts = model.walls.flatMap((w) => w.footprint);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** Dimensioned floor plan as a standalone SVG sheet (mm units, true scale at 100% print). */
export function renderPlanSvg(model: DrawingModel, opts: SheetOptions): string {
  const k = 1000 / opts.scale;
  const { minX, maxX, minZ, maxZ } = model.bounds;
  const drawW = (maxX - minX) * k;
  const drawH = (maxZ - minZ) * k;
  const width = Math.max(drawW + MARGIN * 2, TITLE_BLOCK.width + 20);
  const ox = (width - drawW) / 2;
  const oy = MARGIN;
  const height = oy + drawH + MARGIN + TITLE_BLOCK.height + 8;
  const P = (p: Vec2): Pt => [ox + (p[0] - minX) * k, oy + (p[1] - minZ) * k];
  const src = model.scaleSource;
  const out: string[] = [];

  for (const room of model.rooms) {
    out.push(polygon(room.polygon.map(P), 'fill="#f3f1ea" stroke="none"'));
  }
  for (const item of model.items) {
    out.push(`<g data-kind="item" data-id="${esc(item.id)}"><title>${esc(item.name)}</title>${polygon(item.corners.map(P), `fill="none" stroke="#8a8a8a" stroke-width="${LINE.fine}"`)}</g>`);
  }

  for (const wall of model.walls) {
    out.push(`<g data-kind="wall" data-id="${esc(wall.id)}" data-length="${wall.length.toFixed(4)}">${polygon(wall.footprint.map(P), `fill="#5a5a5a" stroke="#000" stroke-width="${LINE.outline}" stroke-linejoin="miter"`)}</g>`);
  }
  for (const wall of model.walls) for (const op of wall.openings) out.push(openingSymbol(wall, op, P, k, src));

  for (const room of model.rooms) {
    const [cx, cy] = P(room.centroid);
    out.push(
      `<g data-kind="room" data-id="${esc(room.id)}" data-area="${room.area.toFixed(4)}">${text([cx, cy - 2.5], room.name.toUpperCase(), { size: 3.2, weight: 'bold' })}${text(
        [cx, cy + 1.6],
        formatArea(room.area, src),
        { size: 2.4 },
      )}${text([cx, cy + 5], `CH ${formatMeasurement(room.ceilingHeight ?? model.ceilingHeight, src)}`, { size: 2 })}</g>`,
    );
  }

  for (const wall of model.walls) out.push(wallDimensions(wall, P, k, src));

  const extent = wallExtent(model);
  if (extent) {
    const top: [Pt, Pt] = [P([extent.minX, extent.minZ]), P([extent.maxX, extent.minZ])];
    const left: [Pt, Pt] = [P([extent.minX, extent.maxZ]), P([extent.minX, extent.minZ])];
    const gapTop = top[0][1] - oy;
    const gapLeft = left[0][0] - ox;
    out.push(dimension(top[0], top[1], [0, -1], 30 - gapTop, extent.maxX - extent.minX, src, { role: 'overall-width' }));
    out.push(dimension(left[0], left[1], [-1, 0], 30 - gapLeft, extent.maxZ - extent.minZ, src, { role: 'overall-depth' }));
  }

  out.push(northArrow([width - 14, 16]));
  const tbY = height - TITLE_BLOCK.height - 6;
  out.push(scaleBar([10, tbY + TITLE_BLOCK.height - 8], opts.scale));
  out.push(text([10, tbY + TITLE_BLOCK.height - 12], `FLOOR PLAN · ${model.levelName}`, { size: 3.2, anchor: 'start', weight: 'bold' }));
  const span = Math.max(maxX - minX, maxZ - minZ);
  out.push(titleBlock([width - TITLE_BLOCK.width - 6, tbY], opts, `Floor plan — ${model.levelName}`, src, span));
  return sheet(width, height, out.join(''), 'plan');
}

function openingSymbol(wall: DrawingWall, op: DrawingOpening, P: (p: Vec2) => Pt, k: number, src: DrawingModel['scaleSource']): string {
  const t = wall.thickness / 2;
  const at = (s: number, across: number): Pt =>
    P([wall.start[0] + wall.dir[0] * s + wall.inward[0] * across, wall.start[1] + wall.dir[1] * s + wall.inward[1] * across]);
  const s0 = op.center - op.width / 2;
  const s1 = op.center + op.width / 2;
  const pad = 0.3 / k; // a hair past the wall faces so the outline stroke is cut too
  const parts: string[] = [polygon([at(s0, -t - pad), at(s1, -t - pad), at(s1, t + pad), at(s0, t + pad)], 'fill="#fff" stroke="none"')];
  parts.push(line(at(s0, -t), at(s0, t), LINE.outline), line(at(s1, -t), at(s1, t), LINE.outline));
  if (op.kind === 'window') {
    parts.push(line(at(s0, -t), at(s1, -t), LINE.thin), line(at(s0, t), at(s1, t), LINE.thin), line(at(s0, 0), at(s1, 0), LINE.medium));
  } else if (op.kind === 'opening') {
    parts.push(line(at(s0, -t), at(s1, -t), LINE.fine, 'stroke-dasharray="1.2 0.8"'), line(at(s0, t), at(s1, t), LINE.fine, 'stroke-dasharray="1.2 0.8"'));
  } else {
    const hinge = op.hinge === 'start' ? s0 : s1;
    const latch = op.hinge === 'start' ? s1 : s0;
    const h = at(hinge, t);
    const tip = at(hinge, t + op.width);
    const l = at(latch, t);
    const cross = (tip[0] - h[0]) * (l[1] - h[1]) - (tip[1] - h[1]) * (l[0] - h[0]);
    const r = op.width * k;
    parts.push(line(h, tip, LINE.medium));
    parts.push(`<path d="M${f(tip[0])} ${f(tip[1])} A${f(r)} ${f(r)} 0 0 ${cross > 0 ? 1 : 0} ${f(l[0])} ${f(l[1])}" fill="none" stroke="#000" stroke-width="${LINE.fine}"/>`);
  }
  // Opening width, inside the room just off the interior face.
  const angle = readableAngle(wall.dir);
  const labelAt = at(op.center, t + (op.kind === 'door' ? op.width * 0.55 : 0) + 2.4 / k);
  return `<g data-kind="opening" data-id="${esc(op.id)}" data-opening-kind="${op.kind}" data-wall="${esc(wall.id)}" data-center="${op.center.toFixed(4)}" data-width="${op.width.toFixed(4)}">${parts.join('')}${openingLabel(labelAt, angle, op, src)}</g>`;
}

function openingLabel(at: Pt, angle: number, op: DrawingOpening, src: DrawingModel['scaleSource']): string {
  const [l1, l2] = measurementLines(op.width, src);
  const kind = op.kind === 'door' ? 'D' : op.kind === 'window' ? 'W' : 'O';
  return `<g data-kind="dimension" data-role="opening-width" data-for="${esc(op.id)}" data-value="${op.width.toFixed(4)}">${text(at, `${kind} ${l1}`, { angle, size: TEXT * 0.9 })}${text(
    [at[0] + Math.sin((angle * Math.PI) / 180) * -2.3, at[1] + Math.cos((angle * Math.PI) / 180) * 2.3],
    l2,
    { angle, size: TEXT * 0.75 },
  )}</g>`;
}

function readableAngle(dir: Vec2): number {
  let a = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
  if (a > 89.99) a -= 180;
  else if (a < -90.01) a += 180;
  return a;
}

function wallDimensions(wall: DrawingWall, P: (p: Vec2) => Pt, k: number, src: DrawingModel['scaleSource']): string {
  const out: Vec2 = [-wall.inward[0], -wall.inward[1]];
  const face = (s: number): Pt =>
    P([wall.start[0] + wall.dir[0] * s + out[0] * wall.thickness / 2, wall.start[1] + wall.dir[1] * s + out[1] * wall.thickness / 2]);
  const chain = wallChain(wall);
  const parts: string[] = [];
  let offset = 8;
  if (chain.length > 2) {
    const segs = chain.slice(1).map((s, i) => s - chain[i]);
    const rows = chainRows(segs.map((m) => m * k), src, (i) => segs[i]);
    for (let i = 0; i < segs.length; i++) {
      parts.push(dimension(face(chain[i]), face(chain[i + 1]), out, offset, segs[i], src, { role: 'chain', row: rows[i], id: wall.id }));
    }
    offset += rows.some(Boolean) ? 13 : 8;
  }
  parts.push(dimension(face(0), face(wall.length), out, offset, wall.length, src, { role: 'wall-length', id: wall.id }));
  return parts.join('');
}
