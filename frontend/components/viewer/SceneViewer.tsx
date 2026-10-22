'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Viewer,
  SceneEnvironment,
  WallSystem,
  ItemSystem,
  ZoneSystem,
  CeilingSystem,
  DoorSystem,
  WindowSystem,
  LevelSystem,
  useViewer,
} from '@pascal-app/viewer';
import { OrbitControls } from '@react-three/drei';
import { ensurePascalInitialized } from '@/lib/pascal/initPascal';
import { useScene } from '@pascal-app/core';
import { E2ECameraHooks } from './E2ECameraHooks';
import { findScanNode, scanMetadata } from '@/lib/pascal/nodes';
import { SplatBackgroundCanvas, type SplatCameraState } from '@/components/splat-prototype/SplatBackgroundCanvas';
import { ScanAlignmentTool } from './ScanAlignmentTool';
import type { Matrix4, Vector3 } from '@/lib/contracts/primitives';
import type { MaskRegion } from '@/lib/contracts';
import { EditorToolbar, ActiveTool } from '@/components/layout/EditorToolbar';
import { ScanSegmentationOverlay } from './ScanSegmentationOverlay';
import { ScanToEditableModal } from '../capture/ScanToEditableModal';
import { AIPlacementPreview } from './AIPlacementPreview';
import { TransformGizmo } from './TransformGizmo';
import { ProposalGhosts } from './ProposalGhosts';
import { pendingPreviewMasks, useProposalPreviews } from '@/lib/pascal/proposalPreview';
import { InterpretationOverlay } from './InterpretationOverlay';
import { ArchitecturalTools, useArchitecturalSnap } from './ArchitecturalTools';
import { installArchitecturalSync } from '@/lib/pascal/architecturalSync';
import { planFeaturePoints } from '@/lib/pascal/scanSnapping';
import { useSpaceGenStore } from '@/lib/store';
import { Loader2 } from 'lucide-react';

type ScanPicker = (clientX: number, clientY: number) => Vector3 | null;
type OrbitControlsImpl = React.ComponentRef<typeof OrbitControls>;

const NO_MASK_REGIONS: MaskRegion[] = [];
const SCAN_FOCUS_POSITION: [number, number, number] = [0, 1.6, 5];
const SCAN_FOCUS_TARGET: [number, number, number] = [0, 1, 0];
const E2E_HOOKS_ENABLED = process.env.NEXT_PUBLIC_E2E === '1';

function ScanCameraBridge({
  cameraStateRef,
  isPicking,
  pickerRef,
  onPick,
  scanId,
}: {
  cameraStateRef: React.MutableRefObject<SplatCameraState | null>;
  isPicking: boolean;
  pickerRef: React.MutableRefObject<ScanPicker | null>;
  onPick: (point: Vector3) => void;
  scanId: string | null;
}) {
  const { camera, size, gl } = useThree();
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsImpl | null;
  const focusedScanRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scanId || focusedScanRef.current === scanId) return;
    focusedScanRef.current = scanId;
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.position.set(...SCAN_FOCUS_POSITION);
    perspective.lookAt(...SCAN_FOCUS_TARGET);
    perspective.updateProjectionMatrix();
    controls?.target.set(...SCAN_FOCUS_TARGET);
    controls?.update();
  }, [camera, controls, scanId]);

  useFrame(() => {
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as THREE.PerspectiveCamera;
      cameraStateRef.current = {
        position: [perspective.position.x, perspective.position.y, perspective.position.z],
        quaternion: [perspective.quaternion.x, perspective.quaternion.y, perspective.quaternion.z, perspective.quaternion.w],
        fov: perspective.fov,
        aspect: size.width / Math.max(size.height, 1),
        near: perspective.near,
        far: perspective.far,
      };
    }
  });

  useEffect(() => {
    if (!isPicking) return;
    const canvas = gl.domElement;
    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = pickerRef.current?.(event.clientX, event.clientY);
      if (point) onPick(point);
    };
    canvas.addEventListener('pointerdown', handlePointerDown, true);
    return () => canvas.removeEventListener('pointerdown', handlePointerDown, true);
  }, [gl, isPicking, onPick, pickerRef]);

  return null;
}


function ScanDepthMesh({
  meshUrl,
  scanToScene,
}: {
  meshUrl: string;
  scanToScene: Matrix4;
}) {
  const { scene } = useGLTF(meshUrl);
  const proxyScene = React.useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.material = new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: true,
          side: THREE.DoubleSide,
        });
      }
    });
    return clone;
  }, [scene]);

  const groupRef = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!groupRef.current || !scanToScene || scanToScene.length !== 16) return;
    const matrix = new THREE.Matrix4().set(...scanToScene as [
      number, number, number, number, number, number, number, number,
      number, number, number, number, number, number, number, number,
    ]);
    groupRef.current.matrixAutoUpdate = false;
    groupRef.current.matrix.copy(matrix);
    groupRef.current.matrixWorldNeedsUpdate = true;
  }, [scanToScene]);

  // Precompute the proxy's plan feature points once per mesh/alignment for tool snapping.
  const setScanPoints = useArchitecturalSnap((s) => s.setScanPoints);
  useEffect(() => {
    if (!scanToScene || scanToScene.length !== 16) return;
    const toScene = new THREE.Matrix4().set(...scanToScene as [
      number, number, number, number, number, number, number, number,
      number, number, number, number, number, number, number, number,
    ]);
    const positions: number[] = [];
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    proxyScene.updateWorldMatrix(true, true);
    proxyScene.traverse((child) => {
      const attr = (child as THREE.Mesh).isMesh ? (child as THREE.Mesh).geometry.getAttribute('position') : null;
      if (!attr) return;
      m.multiplyMatrices(toScene, child.matrixWorld);
      for (let i = 0; i < attr.count; i++) {
        v.fromBufferAttribute(attr, i).applyMatrix4(m);
        positions.push(v.x, v.y, v.z);
      }
    });
    setScanPoints(planFeaturePoints(positions));
    return () => setScanPoints([]);
  }, [proxyScene, scanToScene, setScanPoints]);

  return <primitive ref={groupRef} object={proxyScene} />;
}

function ScanDepthOcclusionProxy({
  meshUrl,
  scanToScene,
  enabled = true,
}: {
  meshUrl?: string | null;
  scanToScene: Matrix4;
  enabled?: boolean;
}) {
  if (!enabled || !meshUrl) return null;
  return (
    <React.Suspense fallback={null}>
      <ScanDepthMesh meshUrl={meshUrl} scanToScene={scanToScene} />
    </React.Suspense>
  );
}

function MaskRegionVisualizer({
  maskRegions,
  selectedId,
}: {
  maskRegions: MaskRegion[];
  selectedId?: string | null;
}) {
  if (!maskRegions || maskRegions.length === 0) return null;
  return (
    <group>
      {maskRegions.map((mask) => {
        if (!mask.enabled) return null;
        const isSelected = selectedId && (mask.itemId === selectedId || mask.id === selectedId);
        return (
          <group
            key={mask.id}
            position={[mask.obb.center[0], mask.obb.center[1], mask.obb.center[2]]}
            rotation={[0, mask.obb.yaw || 0, 0]}
          >
            <mesh>
              <boxGeometry args={[mask.obb.size[0], mask.obb.size[1], mask.obb.size[2]]} />
              <meshBasicMaterial
                wireframe
                color={isSelected ? '#38bdf8' : mask.ghost ? '#fbbf24' : '#10b981'}
                transparent
                opacity={isSelected ? 0.75 : mask.ghost ? 0.35 : 0.15}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

interface SceneViewerProps {
  selectedId?: string | null;
  onSelectObject?: (id: string | null) => void;
  /** Shows confidence-coloured scan interpretation overlays. */
  reviewMode?: boolean;
}

export function SceneViewer({ selectedId, onSelectObject, reviewMode = false }: SceneViewerProps) {
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [isAligningScan, setIsAligningScan] = useState(false);
  const [isPickingScanPoint, setIsPickingScanPoint] = useState(false);

  const cameraStateRef = useRef<SplatCameraState | null>(null);
  const pickerRef = useRef<ScanPicker | null>(null);
  const pointHandlerRef = useRef<((point: Vector3) => void) | null>(null);
  const scanNode = useScene((state) => findScanNode(state.nodes));
  const scanMeta = scanMetadata(scanNode);
  const scanToScene: Matrix4 = scanMeta.scanToScene || [
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ];
  const committedMasks: MaskRegion[] = scanMeta.maskRegions || NO_MASK_REGIONS;
  // Would-be masks of pending replace/remove proposals, shown in ghost mode and never saved.
  const previews = useProposalPreviews((state) => state.previews);
  const maskRegions = React.useMemo(() => {
    const preview = pendingPreviewMasks(previews);
    return preview.length ? [...committedMasks, ...preview] : committedMasks;
  }, [committedMasks, previews]);
  const handlePickerReady = useCallback((picker: ScanPicker | null) => {
    pickerRef.current = picker;
  }, []);
  const handleScanPoint = useCallback((point: Vector3) => {
    pointHandlerRef.current?.(point);
  }, []);
  const registerPointHandler = useCallback((handler: ((point: Vector3) => void) | null) => {
    pointHandlerRef.current = handler;
  }, []);

  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const showScans = useViewer((state) => state.showScans);
  const setSelectedObjectId = useSpaceGenStore((state) => state.setSelectedObjectId);

  // Initialize Pascal without injecting demo content. Project loading owns scene contents.
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await ensurePascalInitialized();
        if (mounted) setIsReady(true);
      } catch (err) {
        console.error('[SceneViewer] Failed to initialize Pascal workspace:', err);
        if (mounted) {
          setInitError((err as Error)?.message || 'Failed to initialize 3D editor');
        }
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

  // Pascal tool edits join the RoomInterpretation (provenance=user) inside their own undo step.
  useEffect(() => installArchitecturalSync(), []);

  // 2. Synchronize Pascal selection with SpaceGen store
  useEffect(() => {
    const currentId = selectedIds[0] || null;
    if (currentId !== selectedId) {
      if (onSelectObject) onSelectObject(currentId);
      setSelectedObjectId(currentId);
    }
  }, [selectedIds, selectedId, onSelectObject, setSelectedObjectId]);

  if (initError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-background text-text-muted p-6">
        <p className="text-red-400 font-medium mb-2">Error initializing 3D Workspace</p>
        <p className="text-xs text-text-muted max-w-md text-center">{initError}</p>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-background text-text-muted gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
        <span className="text-xs font-mono">Mounting Pascal 3D Architectural Systems...</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative overflow-hidden bg-background">
      {/* Floating Mode Switcher & CAD Toolbars */}
      <EditorToolbar
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        onOpenConvertModal={() => setIsConvertModalOpen(true)}
        isAligningScan={isAligningScan}
        onToggleScanAlignment={() => {
          setIsAligningScan((current) => !current);
          setIsPickingScanPoint(false);
        }}
      />

      {isAligningScan && (
        <ScanAlignmentTool
          scanId={scanNode?.id || null}
          scanToScene={scanToScene}
          scanPointFromScenePoint={(point) => {
            const inverse = new THREE.Matrix4().set(...scanToScene as [
              number, number, number, number, number, number, number, number,
              number, number, number, number, number, number, number, number,
            ]).invert();
            const local = new THREE.Vector3(...point).applyMatrix4(inverse);
            return [local.x, local.y, local.z];
          }}
          onPickModeChange={setIsPickingScanPoint}
          onPointHandlerChange={registerPointHandler}
          onClose={() => {
            setIsAligningScan(false);
            setIsPickingScanPoint(false);
          }}
        />
      )}

      {/* SuperSplat Overlay for Segmented Objects */}
      <ScanSegmentationOverlay />

      {/* Modal to Convert Scan to Parametric Walls + 3D Meshes */}
      <ScanToEditableModal
        isOpen={isConvertModalOpen}
        onClose={() => setIsConvertModalOpen(false)}
      />

      {/* AI Smart Placement Interactive Proposal HUD */}
      <AIPlacementPreview />

      {/* Pascal Full 3D Viewport with Boolean CSG & Scan Overlays */}
      <SplatBackgroundCanvas
        cameraStateRef={cameraStateRef}
        scanUrl={(scanNode as { url?: string } | undefined)?.url || null}
        scanToScene={scanToScene}
        maskRegions={maskRegions}
        visible={showScans && scanNode?.visible !== false}
        onPickerReady={handlePickerReady}
      />
      <Viewer perf={false} useBvh={true} transparent>
        <OrbitControls makeDefault target={SCAN_FOCUS_TARGET} enableDamping={false} />
        {E2E_HOOKS_ENABLED && <E2ECameraHooks />}
        <TransformGizmo />
        <ProposalGhosts />
        <ArchitecturalTools />
        {reviewMode && <InterpretationOverlay />}
        <MaskRegionVisualizer
          maskRegions={maskRegions}
          selectedId={selectedId || selectedIds[0] || null}
        />
        <ScanCameraBridge
          cameraStateRef={cameraStateRef}
          isPicking={isPickingScanPoint}
          pickerRef={pickerRef}
          onPick={handleScanPoint}
          scanId={scanNode?.id || null}
        />
        <ScanDepthOcclusionProxy
          meshUrl={scanMeta.meshUrl || scanMeta.proxyMeshUrl}
          scanToScene={scanToScene}
          enabled={showScans && scanNode?.visible !== false}
        />
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

export default SceneViewer;
