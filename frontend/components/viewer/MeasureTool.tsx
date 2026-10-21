'use client';

import React, { useEffect, useState } from 'react';
import { emitter, MeasurementNode, useScene, type AnyNode, type AnyNodeId, type GridEvent } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { MeasurementLine } from './EstimateMeasurementRenderer';

type Vec3 = [number, number, number];

/**
 * Registry tool for `measurement`: two clicks on the (scan-snapped) grid create one persistent
 * Pascal distance measurement on the active level, as one undo step. Replaces Pascal's own
 * measurement tool, which raycasts the pointer itself (bypassing scan snapping) and labels
 * values as exact.
 */
export default function MeasureTool() {
  const [draft, setDraft] = useState<{ a: Vec3; b: Vec3 } | null>(null);

  useEffect(() => {
    let first: Vec3 | null = null;
    const at = (e: GridEvent): Vec3 => [e.localPosition[0], e.localPosition[1], e.localPosition[2]];
    const onMove = (e: GridEvent) => {
      if (first) setDraft({ a: first, b: at(e) });
    };
    const onClick = (e: GridEvent) => {
      const p = at(e);
      if (!first) {
        first = p;
        setDraft({ a: p, b: p });
        return;
      }
      const levelId = useViewer.getState().selection.levelId;
      if (levelId && Math.hypot(p[0] - first[0], p[2] - first[2]) > 0.01) {
        const node = MeasurementNode.parse({ name: 'Measurement', measurement: { kind: 'distance', points: [first, p] } });
        useScene.getState().applyNodeChanges({ create: [{ node: node as unknown as AnyNode, parentId: levelId as AnyNodeId }] });
      }
      first = null;
      setDraft(null);
    };
    const onCancel = () => {
      first = null;
      setDraft(null);
    };
    emitter.on('grid:move', onMove);
    emitter.on('grid:click', onClick);
    emitter.on('tool:cancel', onCancel);
    return () => {
      emitter.off('grid:move', onMove);
      emitter.off('grid:click', onClick);
      emitter.off('tool:cancel', onCancel);
    };
  }, []);

  return draft ? <MeasurementLine a={draft.a} b={draft.b} draft /> : null;
}
