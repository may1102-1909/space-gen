'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { SplatBackgroundCanvas, type SplatCameraState } from '@/components/splat-prototype/SplatBackgroundCanvas';
import type { EditRecord, MaskRegion, Variant } from '@/lib/contracts';
import type { ScanAsset } from '@/lib/contracts';
import { readEditHistory } from '@/lib/pascal/sceneBridge';
import { describeChange, diffItems, historyOf, readItems, type ChangeKind, type Snapshot } from '@/lib/variants/variants';

type Vec3 = [number, number, number];
interface SharedCamera { position: Vec3; target: Vec3; rev: number }

declare global {
  interface Window {
    /** E2E only: camera position per compare pane. */
    __spacegenCompareCameras?: Record<string, () => Vec3>;
  }
}

const COLORS: Record<ChangeKind | 'same', string> = { added: '#10b981', removed: '#ef4444', moved: '#f59e0b', replaced: '#8b5cf6', same: '#94a3b8' };
const NO_MASKS: MaskRegion[] = [];

/** Both panes publish user camera moves to `sharedRef` and adopt moves made in the other. */
function CameraSync({ id, sharedRef, splatRef }: { id: string; sharedRef: React.MutableRefObject<SharedCamera>; splatRef: React.MutableRefObject<SplatCameraState | null> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const seen = useRef(-1);
  const last = useRef('');
  const keyOf = () => `${camera.position.toArray()}|${controls?.target.toArray()}`;

  React.useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E !== '1') return;
    (window.__spacegenCompareCameras ??= {})[id] = () => camera.position.toArray() as Vec3;
    return () => { delete window.__spacegenCompareCameras?.[id]; };
  }, [id, camera]);

  useFrame(() => {
    if (!controls) return;
    if (sharedRef.current.rev !== seen.current) {
      camera.position.set(...sharedRef.current.position);
      controls.target.set(...sharedRef.current.target);
      controls.update();
      seen.current = sharedRef.current.rev;
      last.current = keyOf();
    } else if (keyOf() !== last.current) {
      sharedRef.current = { position: camera.position.toArray() as Vec3, target: controls.target.toArray() as Vec3, rev: sharedRef.current.rev + 1 };
      seen.current = sharedRef.current.rev;
      last.current = keyOf();
    }
    splatRef.current = {
      position: camera.position.toArray() as Vec3,
      quaternion: camera.quaternion.toArray() as [number, number, number, number],
      fov: camera.fov, aspect: size.width / Math.max(size.height, 1), near: camera.near, far: camera.far,
    };
  });
  return null;
}

/** Items as footprint boxes coloured by their change status. */
function ItemBoxes({ snapshot, status }: { snapshot: Snapshot; status: Map<string, ChangeKind> }) {
  return <>{readItems(snapshot).map((item) => (
    <mesh key={item.id} position={[item.position[0], item.position[1] + item.size[1] / 2, item.position[2]]} rotation={[0, item.rotationY, 0]}>
      <boxGeometry args={item.size} />
      <meshStandardMaterial color={COLORS[status.get(item.id) ?? 'same']} transparent opacity={0.85} />
    </mesh>
  ))}</>;
}

/** One splat background (the shared scan) under one or more item layers. */
function Pane({ scan, sharedRef, label, layers }: { scan: ScanAsset; sharedRef: React.MutableRefObject<SharedCamera>; label?: string; layers: Array<{ id: string; snapshot: Snapshot; status: Map<string, ChangeKind>; clip?: string }> }) {
  // The splat follows the first layer's camera; all layers are synced to it anyway.
  const splatRef = useRef<SplatCameraState | null>(null);
  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-black/40" data-testid="compare-pane">
      <SplatBackgroundCanvas cameraStateRef={splatRef} scanUrl={scan.url || null} scanToScene={scan.scanToScene} maskRegions={NO_MASKS} />
      {layers.map((l) => <PaneLayer key={l.id} {...l} sharedRef={sharedRef} splatRef={splatRef} />)}
      {label && <span className="absolute left-2 top-2 rounded bg-surface/90 px-2 py-0.5 text-xs">{label}</span>}
    </div>
  );
}

function PaneLayer({ id, snapshot, status, sharedRef, clip, splatRef }: { id: string; snapshot: Snapshot; status: Map<string, ChangeKind>; sharedRef: React.MutableRefObject<SharedCamera>; clip?: string; splatRef: React.MutableRefObject<SplatCameraState | null> }) {
  return (
    <div className="absolute inset-0" style={clip ? { clipPath: clip } : undefined} data-testid={`compare-layer-${id}`}>
      <Canvas camera={{ fov: 50 }} gl={{ alpha: true }} className="h-full w-full">
        <ambientLight intensity={1.6} />
        <directionalLight position={[4, 8, 5]} intensity={2} />
        <OrbitControls makeDefault enableDamping={false} />
        <CameraSync id={id} sharedRef={sharedRef} splatRef={splatRef} />
        <ItemBoxes snapshot={snapshot} status={status} />
      </Canvas>
    </div>
  );
}

export interface VariantCompareProps {
  variants: Variant[];
  /** Snapshot per variant id; the active one is the live scene. */
  initialA: string;
  initialB: string;
  scan: ScanAsset;
  onClose: () => void;
}

export function VariantCompare({ variants, initialA, initialB, scan, onClose }: VariantCompareProps) {
  const [aId, setAId] = useState(initialA);
  const [bId, setBId] = useState(initialB);
  const [view, setView] = useState<'side' | 'swipe'>('side');
  const [side, setSide] = useState<'diff' | 'history'>('diff');
  const [split, setSplit] = useState(50);
  // The splat renderer sizes itself on window resize; panes change size when the view mode switches.
  React.useEffect(() => { const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 50); return () => clearTimeout(t); }, [view]);
  const a = variants.find((v) => v.id === aId) ?? variants[0];
  const b = variants.find((v) => v.id === bId) ?? variants[0];
  const changes = useMemo(() => diffItems(a.sceneSnapshot, b.sceneSnapshot), [a, b]);
  const statusA = useMemo(() => new Map(changes.filter((c) => c.kind !== 'added').map((c) => [c.id, c.kind])), [changes]);
  const statusB = useMemo(() => new Map(changes.filter((c) => c.kind !== 'removed').map((c) => [c.id, c.kind])), [changes]);
  const sharedRef = useRef<SharedCamera>(null as unknown as SharedCamera);
  if (!sharedRef.current) {
    const items = readItems(a.sceneSnapshot).concat(readItems(b.sceneSnapshot));
    const target: Vec3 = items.length
      ? [items.reduce((s, i) => s + i.position[0], 0) / items.length, 0.5, items.reduce((s, i) => s + i.position[2], 0) / items.length]
      : [(scan.bounds.min[0] + scan.bounds.max[0]) / 2, 0.5, (scan.bounds.min[2] + scan.bounds.max[2]) / 2];
    sharedRef.current = { position: [target[0], target[1] + 1.5, target[2] + 3.2], target, rev: 0 };
  }
  const select = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex items-center gap-1 text-sm">{label}
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)} className="rounded border border-border bg-background px-2 py-1">
        {variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    </label>
  );
  const tab = (active: boolean, text: string, onClick: () => void) => (
    <button role="tab" aria-selected={active} onClick={onClick} className={`rounded border px-3 py-1 text-sm ${active ? 'border-accent text-accent' : 'border-border'}`}>{text}</button>
  );
  const history = (v: Variant) => historyOf(v.sceneSnapshot, readEditHistory);

  return (
    <div role="dialog" aria-label="Compare variants" data-testid="compare-view" className="absolute inset-0 z-[60] flex flex-col bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <span className="font-medium">Compare variants</span>
        {select('Variant A', aId, setAId)}{select('Variant B', bId, setBId)}
        <div role="tablist" aria-label="View" className="flex gap-1">{tab(view === 'side', 'Side by side', () => setView('side'))}{tab(view === 'swipe', 'Swipe', () => setView('swipe'))}</div>
        <button onClick={onClose} className="ml-auto rounded border border-border px-3 py-1 text-sm">Close</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 flex-1 gap-1">
          {view === 'side' ? <>
            <Pane scan={scan} sharedRef={sharedRef} label={`A: ${a.name}`} layers={[{ id: 'a', snapshot: a.sceneSnapshot, status: statusA }]} />
            <Pane scan={scan} sharedRef={sharedRef} label={`B: ${b.name}`} layers={[{ id: 'b', snapshot: b.sceneSnapshot, status: statusB }]} />
          </> : <>
            <Pane scan={scan} sharedRef={sharedRef} layers={[
              { id: 'a', snapshot: a.sceneSnapshot, status: statusA, clip: `inset(0 ${100 - split}% 0 0)` },
              { id: 'b', snapshot: b.sceneSnapshot, status: statusB, clip: `inset(0 0 0 ${split}%)` },
            ]} />
            <span className="pointer-events-none absolute left-2 top-2 rounded bg-surface/90 px-2 py-0.5 text-xs">A: {a.name}</span>
            <span className="pointer-events-none absolute right-2 top-2 rounded bg-surface/90 px-2 py-0.5 text-xs">B: {b.name}</span>
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${split}%` }} data-testid="swipe-handle" />
            <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Swipe position" data-testid="swipe-slider" className="absolute inset-x-6 bottom-3 z-10" />
          </>}
        </div>
        <aside className="flex w-[340px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-surface p-3 text-sm">
          <div role="tablist" aria-label="Details" className="flex gap-1">{tab(side === 'diff', 'Differences', () => setSide('diff'))}{tab(side === 'history', 'History', () => setSide('history'))}</div>
          {side === 'diff' ? (
            <ul data-testid="diff-list" className="flex flex-col gap-1">
              {changes.length === 0 && <li className="text-text-muted">No item differences.</li>}
              {changes.map((c) => (
                <li key={c.id} data-testid={`diff-${c.kind}`} className="flex items-start gap-2">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLORS[c.kind] }} />{describeChange(c, scan.scaleSource)}
                </li>
              ))}
            </ul>
          ) : [a, b].map((v, i) => (
            <section key={`${v.id}-${i}`} data-testid="history-column">
              <h3 className="font-medium">{i === 0 ? 'A' : 'B'}: {v.name}</h3>
              <ol className="mt-1 flex flex-col gap-1 border-l border-border pl-3">
                {history(v).length === 0 && <li className="text-text-muted">No edits recorded.</li>}
                {history(v).map((r: EditRecord) => <li key={r.id}><span className="text-text-muted">{new Date(r.timestamp).toLocaleString()}</span><br />{r.description}</li>)}
              </ol>
            </section>
          ))}
        </aside>
      </div>
    </div>
  );
}
