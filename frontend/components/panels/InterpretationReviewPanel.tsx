'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useScene } from '@pascal-app/core';
import type { DetectionInterpretation, MaskRegion, Point2D, RoomInterpretation, ScanAsset } from '@/lib/contracts';
import {
  applyInterpretationToScene,
  getInterpretationMeta,
  hasInterpretationNodes,
  wallLength,
} from '@/lib/pascal/scanConverter';
import {
  addOpening,
  confidenceColor,
  deleteWall,
  getDetections,
  getReviewItems,
  getTrustedInterpretation,
  LOW_CONFIDENCE,
  moveOutlineVertex,
  moveWall,
  rejectElement,
  relabelDetection,
  removeOpening,
  resizeOpening,
  setWallEndpoints,
  splitWall,
  updateDetectionBox,
  verifyElement,
  type ReviewItem,
} from '@/lib/pascal/interpretationReview';

type NodeMap = Record<string, any>;
type DragTarget = { kind: 'wall' | 'detection'; id: string } | { kind: 'vertex'; id: string; index: number };
type Drag = DragTarget & { origin: Point2D; delta: Point2D };

const r2 = (v: number) => Math.round(v * 100) / 100;

interface Props {
  interpretation: RoomInterpretation;
  scan: ScanAsset;
  maskRegions: MaskRegion[];
}

export function InterpretationReviewPanel({ interpretation, scan, maskRegions }: Props) {
  const nodes = useScene((s) => s.nodes) as NodeMap;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const converted = hasInterpretationNodes(nodes);
  const items = useMemo(() => (converted ? getReviewItems(nodes) : []), [nodes, converted]);
  const trusted = useMemo(() => getTrustedInterpretation(nodes), [nodes]);
  const selected = items.find((i) => i.key === selectedKey) || null;

  const run = (fn: () => void) => {
    try {
      setError('');
      fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!converted) {
    return (
      <section aria-label="Scan review" className="flex h-full flex-col gap-3 p-4 text-sm">
        <h2 className="font-semibold">Scan review</h2>
        <p className="text-text-muted">
          {interpretation.walls.length} walls, {interpretation.openings.length} openings and {interpretation.detections.length} detections were interpreted from the scan.
        </p>
        <button
          className="rounded bg-accent px-3 py-2 text-white disabled:opacity-50"
          disabled={interpretation.outline.length < 3}
          onClick={() => run(() => applyInterpretationToScene(interpretation, { scan, maskRegions }))}
        >
          Build editable room from scan
        </button>
        {error && <p role="alert" className="text-red-500">{error}</p>}
      </section>
    );
  }

  return (
    <section aria-label="Scan review" className="flex h-full flex-col overflow-hidden text-xs">
      <div className="border-b border-border p-3">
        <h2 className="text-sm font-semibold">Scan review</h2>
        {trusted.warning ? (
          <p role="status" data-testid="trust-warning" className="mt-1 rounded bg-amber-500/15 px-2 py-1 text-amber-400">{trusted.warning}</p>
        ) : (
          <p role="status" className="mt-1 text-emerald-400">All scan elements reviewed.</p>
        )}
        <Legend />
      </div>
      <PlanView nodes={nodes} selectedKey={selectedKey} onSelect={setSelectedKey} run={run} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ul aria-label="Review items" className="divide-y divide-border">
          {items.map((item) => (
            <ReviewRow key={item.key} item={item} selected={item.key === selectedKey} onSelect={() => setSelectedKey(item.key)} onVerify={() => run(() => verifyElement(item.ref))} />
          ))}
        </ul>
        {selected && <Inspector key={selected.key} item={selected} nodes={nodes} run={run} onSelect={setSelectedKey} />}
        {error && <p role="alert" className="p-3 text-red-500">{error}</p>}
      </div>
    </section>
  );
}

function Legend() {
  const entries: Array<[string, string]> = [
    ['< 70%', confidenceColor(0.5)],
    [`< ${LOW_CONFIDENCE * 100}%`, confidenceColor(0.8)],
    ['high', confidenceColor(0.95)],
    ['reviewed', confidenceColor(1, 'verified')],
    ['rejected', confidenceColor(1, 'rejected')],
  ];
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-text-muted">
      {entries.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>
      ))}
    </div>
  );
}

function ReviewRow({ item, selected, onSelect, onVerify }: { item: ReviewItem; selected: boolean; onSelect: () => void; onVerify: () => void }) {
  return (
    <li className={`flex items-center gap-2 px-3 py-1.5 ${selected ? 'bg-accent/10' : ''}`} data-testid={`review-row-${item.ref.id}`}>
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: confidenceColor(item.confidence, item.status) }} />
      <button className="min-w-0 flex-1 truncate text-left" onClick={onSelect} aria-label={`Select ${item.label}`}>
        {item.label}
      </button>
      <span className="font-mono text-text-muted">{Math.round(item.confidence * 100)}%</span>
      <span data-testid={`status-${item.ref.id}`} className="w-16 text-right text-text-muted">{item.status}{item.provenance === 'user' ? ' · user' : ''}</span>
      <button
        className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
        disabled={item.status === 'verified' || item.status === 'corrected'}
        onClick={onVerify}
        aria-label={`Verify ${item.label}`}
      >
        Verify
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Plan view: top-down overlay of outline, walls, openings and detection boxes.
// Dragging previews locally and commits one correction on release (one undo step).
// ---------------------------------------------------------------------------

function PlanView({ nodes, selectedKey, onSelect, run }: { nodes: NodeMap; selectedKey: string | null; onSelect: (key: string) => void; run: (fn: () => void) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const all = Object.values(nodes).filter(Boolean);
  const slab = all.find((n) => getInterpretationMeta(n)?.kind === 'outline');
  const walls = all.filter((n) => n.type === 'wall' && getInterpretationMeta(n)?.kind === 'wall');
  const openings = all.filter((n) => getInterpretationMeta(n)?.kind === 'opening');
  const detections = getDetections(nodes);

  const polygon: Point2D[] = slab?.polygon || [];
  const xs = [...polygon.map((p) => p[0]), ...detections.map((d) => d.obb.center[0])];
  const zs = [...polygon.map((p) => p[1]), ...detections.map((d) => d.obb.center[2])];
  const minX = Math.min(...xs, 0) - 1;
  const minZ = Math.min(...zs, 0) - 1;
  const width = Math.max(...xs, 1) + 1 - minX;
  const height = Math.max(...zs, 1) + 1 - minZ;

  const toPlan = (event: React.PointerEvent): Point2D => {
    const svg = svgRef.current!;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return [local.x, local.y];
  };

  const begin = (event: React.PointerEvent, next: DragTarget, key: string) => {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    onSelect(key);
    setDrag({ ...next, origin: toPlan(event), delta: [0, 0] });
  };
  const move = (event: React.PointerEvent) => {
    if (!drag) return;
    const p = toPlan(event);
    setDrag({ ...drag, delta: [r2(p[0] - drag.origin[0]), r2(p[1] - drag.origin[1])] });
  };
  const end = () => {
    if (!drag) return;
    const [dx, dz] = drag.delta;
    setDrag(null);
    if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) return;
    run(() => {
      if (drag.kind === 'wall') moveWall(drag.id, [dx, dz]);
      if (drag.kind === 'vertex') {
        const v = polygon[drag.index];
        moveOutlineVertex(drag.id, drag.index, [r2(v[0] + dx), r2(v[1] + dz)]);
      }
      if (drag.kind === 'detection') {
        const det = detections.find((d) => d.id === drag.id)!;
        updateDetectionBox(det.id, { center: [r2(det.obb.center[0] + dx), det.obb.center[1], r2(det.obb.center[2] + dz)] });
      }
    });
  };
  const offsetFor = (kind: Drag['kind'], id: string): Point2D => (drag && drag.kind === kind && drag.id === id ? drag.delta : [0, 0]);
  const outlineMeta = slab ? getInterpretationMeta(slab)! : null;

  return (
    <div className="border-b border-border bg-background p-2">
      <svg
        ref={svgRef}
        role="img"
        aria-label="Scan plan overlay"
        data-testid="plan-view"
        viewBox={`${minX} ${minZ} ${width} ${height}`}
        className="h-[240px] w-full touch-none select-none"
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => setDrag(null)}
      >
        {slab && outlineMeta && (
          <polygon
            points={polygon.map((p, i) => {
              const d = drag?.kind === 'vertex' && drag.index === i ? drag.delta : [0, 0];
              return `${p[0] + d[0]},${p[1] + d[1]}`;
            }).join(' ')}
            fill={confidenceColor(outlineMeta.confidence, outlineMeta.status)}
            fillOpacity={0.08}
            stroke={confidenceColor(outlineMeta.confidence, outlineMeta.status)}
            strokeWidth={0.03}
            strokeDasharray="0.1 0.08"
            onPointerDown={() => onSelect(`outline:${slab.id}`)}
          />
        )}
        {walls.map((wall) => {
          const meta = getInterpretationMeta(wall)!;
          const [dx, dz] = offsetFor('wall', wall.id);
          const key = `wall:${wall.id}`;
          return (
            <line
              key={wall.id}
              data-testid={`plan-wall-${wall.id}`}
              x1={wall.start[0] + dx} y1={wall.start[1] + dz} x2={wall.end[0] + dx} y2={wall.end[1] + dz}
              stroke={confidenceColor(meta.confidence, meta.status)}
              strokeOpacity={meta.status === 'rejected' ? 0.4 : 1}
              strokeWidth={Math.max(wall.thickness ?? 0.2, 0.12) * (selectedKey === key ? 1.8 : 1)}
              strokeLinecap="round"
              className="cursor-move"
              onPointerDown={(e) => begin(e, { kind: 'wall', id: wall.id }, key)}
            />
          );
        })}
        {openings.map((op) => {
          const host = nodes[op.wallId || op.parentId];
          if (!host) return null;
          const meta = getInterpretationMeta(op)!;
          const len = wallLength(host.start, host.end) || 1;
          const dir = [(host.end[0] - host.start[0]) / len, (host.end[1] - host.start[1]) / len];
          const [dx, dz] = offsetFor('wall', host.id);
          const a = (op.position[0] - op.width / 2);
          const b = (op.position[0] + op.width / 2);
          return (
            <line
              key={op.id}
              data-testid={`plan-opening-${op.id}`}
              x1={host.start[0] + dir[0] * a + dx} y1={host.start[1] + dir[1] * a + dz}
              x2={host.start[0] + dir[0] * b + dx} y2={host.start[1] + dir[1] * b + dz}
              stroke={confidenceColor(meta.confidence, meta.status)}
              strokeWidth={0.32}
              strokeDasharray={op.type === 'window' ? '0.12 0.06' : undefined}
              strokeOpacity={0.85}
              onPointerDown={(e) => { e.stopPropagation(); onSelect(`opening:${op.id}`); }}
            />
          );
        })}
        {detections.map((det) => (
          <DetectionBox key={det.id} det={det} offset={offsetFor('detection', det.id)} selected={selectedKey === `detection:${det.id}`} onPointerDown={(e) => begin(e, { kind: 'detection', id: det.id }, `detection:${det.id}`)} />
        ))}
        {slab && polygon.map((p, i) => {
          const d = drag?.kind === 'vertex' && drag.index === i ? drag.delta : [0, 0];
          return (
            <circle
              key={i}
              data-testid={`plan-vertex-${i}`}
              cx={p[0] + d[0]} cy={p[1] + d[1]} r={0.14}
              fill="#e5e7eb" stroke="#111827" strokeWidth={0.03}
              className="cursor-grab"
              onPointerDown={(e) => begin(e, { kind: 'vertex', id: slab.id, index: i }, `outline:${slab.id}`)}
            />
          );
        })}
      </svg>
    </div>
  );
}

function DetectionBox({ det, offset, selected, onPointerDown }: { det: DetectionInterpretation; offset: Point2D; selected: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  const [w, , d] = det.obb.size;
  const color = confidenceColor(det.confidence, det.status);
  // Plan y is scene +z; a scene yaw about +Y is a negative SVG rotation.
  const transform = `translate(${det.obb.center[0] + offset[0]} ${det.obb.center[2] + offset[1]}) rotate(${(-det.obb.yaw * 180) / Math.PI})`;
  return (
    <g transform={transform} data-testid={`plan-detection-${det.id}`} className="cursor-move" onPointerDown={onPointerDown}>
      <rect
        x={-w / 2} y={-d / 2} width={w} height={d}
        fill={color} fillOpacity={det.status === 'rejected' ? 0.05 : 0.25}
        stroke={color} strokeWidth={selected ? 0.07 : 0.035}
        strokeDasharray={det.status === 'rejected' ? '0.08 0.06' : undefined}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Inspector: precise numeric corrections for the selected element.
// ---------------------------------------------------------------------------

function Inspector({ item, nodes, run, onSelect }: { item: ReviewItem; nodes: NodeMap; run: (fn: () => void) => void; onSelect: (key: string | null) => void }) {
  const ref = item.ref;
  const actions = (
    <div className="flex flex-wrap gap-1.5">
      <ActionButton label="Verify" disabled={item.status === 'verified'} onClick={() => run(() => verifyElement(ref))} />
      <ActionButton label="Reject" disabled={item.status === 'rejected'} onClick={() => run(() => rejectElement(ref))} />
      {ref.kind === 'wall' && (
        <>
          <ActionButton label="Split wall" onClick={() => run(() => splitWall(ref.id))} />
          <ActionButton label="Add door" onClick={() => run(() => onSelect(`opening:${addOpening(ref.id, 'door')}`))} />
          <ActionButton label="Add window" onClick={() => run(() => onSelect(`opening:${addOpening(ref.id, 'window')}`))} />
          <ActionButton label="Delete wall" onClick={() => run(() => { deleteWall(ref.id); onSelect(null); })} />
        </>
      )}
      {ref.kind === 'opening' && <ActionButton label="Remove opening" onClick={() => run(() => { removeOpening(ref.id); onSelect(null); })} />}
    </div>
  );

  return (
    <div className="space-y-2 border-t border-border p-3" aria-label={`Inspector ${item.label}`}>
      <h3 className="font-semibold">{item.label}</h3>
      {actions}
      {ref.kind === 'wall' && <WallFields node={nodes[ref.id]} run={run} />}
      {ref.kind === 'opening' && <OpeningFields node={nodes[ref.id]} run={run} />}
      {ref.kind === 'detection' && <DetectionFields det={getDetections(nodes).find((d) => d.id === ref.id)} run={run} />}
      {ref.kind === 'outline' && <OutlineFields node={nodes[ref.id]} run={run} />}
    </div>
  );
}

function ActionButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="rounded border border-border px-2 py-1 hover:border-accent disabled:opacity-40" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

function NumberField({ label, value, onCommit, step = 0.05 }: { label: string; value: number; onCommit: (v: number) => void; step?: number }) {
  const [text, setText] = useState(String(r2(value)));
  useEffect(() => setText(String(r2(value))), [value]);
  const commit = () => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return setText(String(r2(value)));
    if (Math.abs(parsed - value) > 1e-6) onCommit(parsed);
  };
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-text-muted">{label}</span>
      <input
        type="number"
        step={step}
        aria-label={label}
        className="w-20 rounded border border-border bg-background px-1.5 py-0.5 text-right font-mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

function TextField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-text-muted">{label}</span>
      <input
        aria-label={label}
        className="w-36 rounded border border-border bg-background px-1.5 py-0.5"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text.trim() && text !== value) onCommit(text); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

function WallFields({ node, run }: { node: any; run: (fn: () => void) => void }) {
  if (!node) return null;
  const set = (start: Point2D, end: Point2D) => run(() => setWallEndpoints(node.id, start, end));
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      <NumberField label="Wall start X" value={node.start[0]} onCommit={(v) => set([v, node.start[1]], node.end)} />
      <NumberField label="Wall start Z" value={node.start[1]} onCommit={(v) => set([node.start[0], v], node.end)} />
      <NumberField label="Wall end X" value={node.end[0]} onCommit={(v) => set(node.start, [v, node.end[1]])} />
      <NumberField label="Wall end Z" value={node.end[1]} onCommit={(v) => set(node.start, [node.end[0], v])} />
    </div>
  );
}

function OpeningFields({ node, run }: { node: any; run: (fn: () => void) => void }) {
  if (!node) return null;
  const offset = node.position[0];
  const sill = Math.max(0, node.position[1] - node.height / 2);
  const set = (change: Parameters<typeof resizeOpening>[1]) => run(() => resizeOpening(node.id, change));
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      <NumberField label="Opening center" value={offset} onCommit={(v) => set({ offset: v })} />
      <NumberField label="Opening width" value={node.width} onCommit={(v) => set({ width: v })} />
      <NumberField label="Opening height" value={node.height} onCommit={(v) => set({ height: v })} />
      <NumberField label="Opening sill" value={sill} onCommit={(v) => set({ sill: v })} />
    </div>
  );
}

function DetectionFields({ det, run }: { det?: DetectionInterpretation; run: (fn: () => void) => void }) {
  if (!det) return null;
  const { center, size, yaw } = det.obb;
  const box = (change: Parameters<typeof updateDetectionBox>[1]) => run(() => updateDetectionBox(det.id, change));
  return (
    <div className="space-y-1">
      <TextField label="Detection label" value={det.label} onCommit={(v) => run(() => relabelDetection(det.id, v))} />
      <TextField label="Detection category" value={det.category} onCommit={(v) => run(() => relabelDetection(det.id, det.label, v))} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <NumberField label="Box center X" value={center[0]} onCommit={(v) => box({ center: [v, center[1], center[2]] })} />
        <NumberField label="Box center Z" value={center[2]} onCommit={(v) => box({ center: [center[0], center[1], v] })} />
        <NumberField label="Box width" value={size[0]} onCommit={(v) => box({ size: [v, size[1], size[2]] })} />
        <NumberField label="Box depth" value={size[2]} onCommit={(v) => box({ size: [size[0], size[1], v] })} />
        <NumberField label="Box height" value={size[1]} onCommit={(v) => box({ size: [size[0], v, size[2]], center: [center[0], v / 2, center[2]] })} />
        <NumberField label="Box yaw (deg)" step={5} value={(yaw * 180) / Math.PI} onCommit={(v) => box({ yaw: (v * Math.PI) / 180 })} />
      </div>
    </div>
  );
}

function OutlineFields({ node, run }: { node: any; run: (fn: () => void) => void }) {
  if (!node) return null;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      {(node.polygon as Point2D[]).map((p, i) => (
        <React.Fragment key={i}>
          <NumberField label={`Vertex ${i + 1} X`} value={p[0]} onCommit={(v) => run(() => moveOutlineVertex(node.id, i, [v, p[1]]))} />
          <NumberField label={`Vertex ${i + 1} Z`} value={p[1]} onCommit={(v) => run(() => moveOutlineVertex(node.id, i, [p[0], v]))} />
        </React.Fragment>
      ))}
    </div>
  );
}

export default InterpretationReviewPanel;
