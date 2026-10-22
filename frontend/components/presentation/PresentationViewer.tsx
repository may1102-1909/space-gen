'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Viewer, SceneEnvironment, WallSystem, ItemSystem, ZoneSystem, CeilingSystem, DoorSystem, WindowSystem, LevelSystem } from '@pascal-app/viewer';
import { applySceneSnapshot, useScene } from '@pascal-app/core';
import { Loader2 } from 'lucide-react';
import { ensurePascalInitialized } from '@/lib/pascal/initPascal';
import { findScanNode, scanMetadata } from '@/lib/pascal/nodes';
import { SplatBackgroundCanvas, type SplatCameraState } from '@/components/splat-prototype/SplatBackgroundCanvas';
import { E2ECameraHooks } from '@/components/viewer/E2ECameraHooks';
import type { MaskRegion } from '@/lib/contracts';
import type { Matrix4 } from '@/lib/contracts/primitives';
import { useNavigation, viewModeLayers } from '@/lib/navigation/navigationStore';
import type { SceneKind } from '@/lib/navigation/room';
import { OrbitConfinement } from '@/components/viewer/OrbitConfinement';
import { WalkthroughController } from '@/components/viewer/WalkthroughController';
import { PascalLayerFade } from '@/components/viewer/PascalLayerFade';
import { NavigationOverlay } from '@/components/viewer/NavigationOverlay';
import { lerpPose, TRANSITION_SECONDS, type CameraPose } from '@/lib/presentation/tour';

const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const NO_MASKS: MaskRegion[] = [];
const DEFAULT_POSE: CameraPose = { position: [0, 1.6, 5], target: [0, 1, 0] };
const E2E_HOOKS_ENABLED = process.env.NEXT_PUBLIC_E2E === '1';

interface ControlsWithTarget {
  target: THREE.Vector3;
  update(): void;
}

/** Feeds the splat layer the live camera and flies the camera to `pose` whenever `flightKey` changes. */
function CameraRig({ cameraStateRef, pose, flightKey }: { cameraStateRef: React.MutableRefObject<SplatCameraState | null>; pose: CameraPose; flightKey: string }) {
  const { camera, size } = useThree();
  const controls = useThree((state) => state.controls) as unknown as ControlsWithTarget | null;
  const flight = useRef<{ from: CameraPose; to: CameraPose; t: number } | null>(null);
  const first = useRef(true);
  const poseRef = useRef(pose);
  useEffect(() => { poseRef.current = pose; }, [pose]);

  useEffect(() => {
    const to = poseRef.current;
    // A tour step while walking returns to orbit (the walk controller restores the orbit camera).
    if (!first.current && useNavigation.getState().navMode === 'walk') {
      useNavigation.getState().setNavMode('orbit');
      return;
    }
    if (first.current) {
      first.current = false;
      camera.position.set(...to.position);
      controls?.target.set(...to.target);
      controls?.update();
      return;
    }
    const target = controls?.target ?? new THREE.Vector3(...to.target);
    flight.current = {
      from: { position: [camera.position.x, camera.position.y, camera.position.z], target: [target.x, target.y, target.z] },
      to,
      t: 0,
    };
  }, [flightKey, camera, controls]);

  useFrame((_, delta) => {
    const f = flight.current;
    if (f) {
      f.t = Math.min(f.t + delta / TRANSITION_SECONDS, 1);
      const p = lerpPose(f.from, f.to, f.t);
      camera.position.set(...p.position);
      controls?.target.set(...p.target);
      controls?.update();
      if (f.t >= 1) flight.current = null;
    }
  });

  // After OrbitControls, the room confinement and the walk controller: the splat gets this frame's camera.
  useFrame(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    cameraStateRef.current = {
      position: [perspective.position.x, perspective.position.y, perspective.position.z],
      quaternion: [perspective.quaternion.x, perspective.quaternion.y, perspective.quaternion.z, perspective.quaternion.w],
      fov: perspective.fov,
      aspect: size.width / Math.max(size.height, 1),
      near: perspective.near,
      far: perspective.far,
    };
  }, 5);
  return null;
}

interface PresentationViewerProps {
  /** Pascal scene document of the variant on show. */
  sceneSnapshot: Record<string, unknown>;
  /** Fallback scan when the snapshot has no scan node. */
  fallbackScan?: { url: string; scanToScene: Matrix4 };
  /** Manual interior/exterior choice saved with the project; auto-detected from the scene when absent. */
  sceneKind?: SceneKind | null;
  pose: CameraPose | null;
  flightKey: string;
}

/** The read-only 3D view: Pascal scene plus splat, orbit controls and the tour camera. No editing tools. */
export default function PresentationViewer({ sceneSnapshot, fallbackScan, sceneKind: savedKind, pose, flightKey }: PresentationViewerProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraStateRef = useRef<SplatCameraState | null>(null);
  const viewMode = useNavigation((state) => state.viewMode);
  const navMode = useNavigation((state) => state.navMode);
  const layers = viewModeLayers(viewMode);
  const walking = navMode === 'walk';
  // The sanitized share carries the designer's override; clients cannot change it.
  const setOverride = useNavigation((state) => state.setSceneKindOverride);
  useEffect(() => {
    setOverride(savedKind ?? null);
    return () => { setOverride(null); useNavigation.getState().setNavMode('orbit'); };
  }, [savedKind, setOverride]);

  useEffect(() => {
    let alive = true;
    ensurePascalInitialized().then(() => alive && setReady(true)).catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (Object.keys(sceneSnapshot).length) applySceneSnapshot(sceneSnapshot as Parameters<typeof applySceneSnapshot>[0], { origin: 'load' });
    else useScene.getState().clearScene();
  }, [ready, sceneSnapshot]);

  const scanNode = useScene((state) => findScanNode(state.nodes));
  const meta = scanMetadata(scanNode);
  const scanUrl = (scanNode as { url?: string } | undefined)?.url || fallbackScan?.url || null;
  const scanToScene: Matrix4 = meta.scanToScene || fallbackScan?.scanToScene || IDENTITY;
  const masks: MaskRegion[] = meta.maskRegions || NO_MASKS;

  if (error) return <div role="alert" className="flex h-full items-center justify-center text-red-400">{error}</div>;
  if (!ready) return <div className="flex h-full items-center justify-center gap-2 text-text-muted"><Loader2 className="h-5 w-5 animate-spin" />Loading scene…</div>;
  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <SplatBackgroundCanvas cameraStateRef={cameraStateRef} scanUrl={scanUrl} scanToScene={scanToScene} maskRegions={masks} visible hidden={!layers.splat} />
      <NavigationOverlay />
      <Viewer perf={false} useBvh transparent>
        <OrbitControls makeDefault target={DEFAULT_POSE.target} enableDamping={false} enabled={!walking} />
        {E2E_HOOKS_ENABLED && <E2ECameraHooks />}
        <PascalLayerFade />
        <OrbitConfinement enabled={!walking} />
        {walking && <WalkthroughController />}
        <CameraRig cameraStateRef={cameraStateRef} pose={pose ?? DEFAULT_POSE} flightKey={flightKey} />
        <SceneEnvironment />
        <WallSystem />
        <ItemSystem />
        <ZoneSystem />
        <CeilingSystem />
        <DoorSystem />
        <WindowSystem />
        <LevelSystem />
      </Viewer>
    </div>
  );
}
