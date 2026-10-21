'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { emitter, useScene, type GridEvent } from '@pascal-app/core';
import { Grid, ToolManager, useEditor } from '@/lib/pascal/pascalEditor';
import { Html } from '@react-three/drei';
import { create } from 'zustand';
import type { Point2D } from '@/lib/contracts';
import { buildSnapTargets, snapPlanPoint, type SnapResult, type SnapTargets } from '@/lib/pascal/scanSnapping';

/**
 * Mounts Pascal's own build tools (wall / slab / door / window via the registry ToolManager,
 * fed by Pascal's Grid raycaster) over the splat, and snaps their floor input to the scan:
 * interpretation corners, wall faces and scan proxy points. Pascal's own magnetic/grid snap is
 * switched off for these contexts so our snap is the single authority (connectivity still joins
 * walls that land on a corner).
 */

export type ArchitecturalTool = 'wall' | 'slab' | 'door' | 'window' | 'measurement';

interface SnapState {
  scanPoints: Point2D[];
  snap: SnapResult | null;
  setScanPoints: (points: Point2D[]) => void;
  setSnap: (snap: SnapResult | null) => void;
}

/** UI-only snap state (scan point set + last snap for the indicator); not scene state. */
export const useArchitecturalSnap = create<SnapState>((set) => ({
  scanPoints: [],
  snap: null,
  setScanPoints: (scanPoints) => set({ scanPoints }),
  setSnap: (snap) => set({ snap }),
}));

export function armArchitecturalTool(tool: ArchitecturalTool | null) {
  const editor = useEditor.getState();
  if (!tool) {
    editor.armToolMode({ mode: 'select' });
    return;
  }
  editor.setPhase('building');
  editor.setSnappingMode('wall', 'off');
  editor.setSnappingMode('polygon', 'off');
  editor.setContinuation('wall', 'single');
  editor.armToolMode({ mode: 'build', tool });
}

const FLOOR_EPS = 0.1;

function snappedEvent(event: GridEvent, point: Point2D): GridEvent {
  const dx = point[0] - event.localPosition[0];
  const dz = point[1] - event.localPosition[2];
  const native = event.nativeEvent as unknown as object | undefined;
  return {
    ...event,
    position: [event.position[0] + dx, event.position[1], event.position[2] + dz],
    localPosition: [point[0], event.localPosition[1], point[1]],
    // Without a pointer ray/canvas target the tools take the snapped plan point as-is instead
    // of re-solving the support surface from the raw pointer ray.
    localRay: undefined,
    surfaceHit: undefined,
    surfaceLocalPosition: undefined,
    nativeEvent: (native &&
      new Proxy(native, {
        get(target, prop) {
          if (prop === 'target' || prop === 'ray') return undefined;
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      })) as GridEvent['nativeEvent'],
  };
}

/** Rewrites floor-level grid events to their snapped point before any tool sees them. */
function installGridSnap(getTargets: () => SnapTargets): () => void {
  const original = emitter.emit;
  const setSnap = useArchitecturalSnap.getState().setSnap;
  emitter.emit = ((type: string, event?: unknown) => {
    if ((type === 'grid:move' || type === 'grid:click') && event) {
      const grid = event as GridEvent;
      if (Math.abs(grid.position[1]) < FLOOR_EPS) {
        const snap = snapPlanPoint([grid.localPosition[0], grid.localPosition[2]], getTargets());
        setSnap(snap);
        if (snap.kind !== 'floor') event = snappedEvent(grid, snap.point);
      } else {
        setSnap(null);
      }
    }
    return (original as (t: string, e?: unknown) => void).call(emitter, type, event);
  }) as typeof emitter.emit;
  return () => {
    emitter.emit = original;
    setSnap(null);
  };
}

const SNAP_COLORS: Record<SnapResult['kind'], string> = {
  corner: '#f97316',
  'wall-face': '#38bdf8',
  'scan-point': '#a855f7',
  floor: '#94a3b8',
};
const SNAP_LABELS: Record<SnapResult['kind'], string> = {
  corner: 'Corner',
  'wall-face': 'Wall face',
  'scan-point': 'Scan point',
  floor: 'Floor',
};

function SnapIndicator() {
  const snap = useArchitecturalSnap((s) => s.snap);
  if (!snap) return null;
  const color = SNAP_COLORS[snap.kind];
  return (
    <group position={[snap.point[0], 0.02, snap.point[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1002}>
        <ringGeometry args={[0.08, 0.12, 32]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent opacity={0.95} />
      </mesh>
      <Html center position={[0, 0.25, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[40, 0]}>
        <div
          data-testid="snap-indicator"
          data-snap-kind={snap.kind}
          className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
          style={{ background: color }}
        >
          {SNAP_LABELS[snap.kind]}
        </div>
      </Html>
    </group>
  );
}

export function ArchitecturalTools() {
  const mode = useEditor((s) => s.mode);
  const tool = useEditor((s) => s.tool);
  const nodes = useScene((s) => s.nodes);
  const scanPoints = useArchitecturalSnap((s) => s.scanPoints);
  const targets = useMemo(() => buildSnapTargets(nodes as Record<string, any>, scanPoints), [nodes, scanPoints]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const active = mode === 'build' && tool !== null;

  useEffect(() => {
    if (!active) return;
    const uninstall = installGridSnap(() => targetsRef.current);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') emitter.emit('tool:cancel' as any, undefined as any);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      uninstall();
      window.removeEventListener('keydown', onKey);
    };
  }, [active]);

  if (!active) return null;
  return (
    <>
      <Grid />
      <ToolManager />
      <SnapIndicator />
    </>
  );
}
