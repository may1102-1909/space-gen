'use client';

import React, { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Float32BufferAttribute, type Group } from 'three';
import { useRegistry, useScene, type MeasurementNode } from '@pascal-app/core';
import { OVERLAY_LAYER, useNodeEvents, useViewer } from '@pascal-app/viewer';
import { measurementDefinition } from '@pascal-app/nodes';
import { Html } from '@react-three/drei';
import { formatMeasurement, scaleSourceOf } from '@/lib/measurement/accuracy';

type Vec3 = [number, number, number];
const pointOf = (anchor: unknown): Vec3 => (Array.isArray(anchor) ? (anchor as Vec3) : (anchor as { fallback: Vec3 }).fallback);
const PascalMeasurementRenderer = lazy(
  measurementDefinition.renderer!.kind === 'parametric'
    ? (measurementDefinition.renderer!.module as () => Promise<{ default: React.ComponentType<{ node: MeasurementNode }> }>)
    : async () => ({ default: () => null }),
);

/** A distance line with a scan-estimate label; shared by committed nodes and the live draft. */
export function MeasurementLine({ a, b, draft = false }: { a: Vec3; b: Vec3; draft?: boolean }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([...a, ...b], 3));
    return g;
  }, [a, b]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const color = draft ? '#fbbf24' : '#f472b6';
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.05, (a[2] + b[2]) / 2];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const scaleSource = useScene((s) => scaleSourceOf(Object.values(s.nodes).find((n) => n?.type === 'scan')));
  return (
    <group>
      <lineSegments geometry={geometry} layers={OVERLAY_LAYER} renderOrder={1001} frustumCulled={false}>
        <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </lineSegments>
      <Html center position={mid} style={{ pointerEvents: 'none' }} zIndexRange={[30, 0]}>
        <div
          data-testid={draft ? 'measurement-draft-label' : 'measurement-label'}
          className="whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white"
          style={{ border: `1px solid ${color}` }}
        >
          {formatMeasurement(length, scaleSource)}
        </div>
      </Html>
    </group>
  );
}

/**
 * Registry renderer for `measurement` nodes. Distances show as scan estimates through
 * `formatMeasurement`; other kinds keep Pascal's renderer.
 */
export default function EstimateMeasurementRenderer({ node }: { node: MeasurementNode }) {
  if (node.measurement.kind === 'distance') return <DistanceRenderer node={node} />;
  return (
    <Suspense fallback={null}>
      <PascalMeasurementRenderer node={node} />
    </Suspense>
  );
}

function DistanceRenderer({ node }: { node: MeasurementNode }) {
  const ref = useRef<Group>(null!);
  useRegistry(node.id, 'measurement', ref);
  const handlers = useNodeEvents(node, 'measurement');
  const showMeasurements = useViewer((s) => s.showMeasurements);
  const [a, b] = (node.measurement as { points: unknown[] }).points.map(pointOf);
  return (
    <group ref={ref} {...handlers}>
      {showMeasurements && node.visible !== false && <MeasurementLine a={a} b={b} />}
    </group>
  );
}
