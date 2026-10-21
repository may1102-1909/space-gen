'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { MaskRegion } from '@/lib/contracts';
import { applyMaskEdits } from '@/lib/splat/maskEdits';

type SparkRendererType = InstanceType<typeof SparkRenderer>;
type SplatMeshType = InstanceType<typeof SplatMesh>;

export interface SplatCameraState {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
  aspect: number;
  near: number;
  far: number;
}

export interface SplatBackgroundCanvasProps {
  /** Legacy prototype prop; the main editor uses a mutable ref to avoid per-frame React renders. */
  cameraState?: SplatCameraState | null;
  cameraStateRef?: React.RefObject<SplatCameraState | null>;
  scanUrl?: string | null;
  scanToScene?: number[];
  visible?: boolean;
  onPickerReady?: (picker: ((clientX: number, clientY: number) => [number, number, number] | null) | null) => void;
  enableMasking?: boolean;
  maskPosition?: [number, number, number];
  maskSize?: [number, number, number];
  maskRegions?: MaskRegion[];
  onMetricsUpdate?: (metrics: {
    fps: number;
    splatCount: number;
    format: string;
    isLoaded: boolean;
  }) => void;
}

// Stable defaults so the mask effect does not rebuild Spark edits on every render.
const DEFAULT_MASK_POSITION: [number, number, number] = [0, 0, 0];
const DEFAULT_MASK_SIZE: [number, number, number] = [1.5, 1.5, 1.5];
const NO_MASK_REGIONS: MaskRegion[] = [];

export const SplatBackgroundCanvas: React.FC<SplatBackgroundCanvasProps> = ({
  cameraState,
  cameraStateRef,
  scanUrl,
  scanToScene,
  visible = true,
  onPickerReady,
  enableMasking = false,
  maskPosition = DEFAULT_MASK_POSITION,
  maskSize = DEFAULT_MASK_SIZE,
  maskRegions = NO_MASK_REGIONS,
  onMetricsUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sparkRef = useRef<SparkRendererType | null>(null);
  const splatMeshRef = useRef<SplatMeshType | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const loadedCountRef = useRef(0);
  const loadedFormatRef = useRef('');
  // Latest props for the long-lived render loop, refreshed after every render.
  const pickerCallbackRef = useRef(onPickerReady);
  const legacyCameraStateRef = useRef(cameraState);
  const cameraStatePropRef = useRef(cameraStateRef);
  const metricsCallbackRef = useRef(onMetricsUpdate);
  useEffect(() => {
    pickerCallbackRef.current = onPickerReady;
    legacyCameraStateRef.current = cameraState;
    cameraStatePropRef.current = cameraStateRef;
    metricsCallbackRef.current = onMetricsUpdate;
  });

  // FPS calculation refs (lastFpsTime is seeded on the first animation frame)
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef<number | null>(null);
  const currentFpsRef = useRef(0);

  // 1. Initialize WebGL2 & Spark Renderer once on mount
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 600;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 1.2, 3);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false,
        powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      rendererRef.current = renderer;
    } catch (err) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- surfacing a WebGL context failure from the external renderer is the intent
      setErrorMsg(`Failed to initialize WebGL2 context: ${(err as Error).message}`);
      return;
    }

    // Instantiate SparkRenderer
    let spark: SparkRendererType;
    try {
      spark = new SparkRenderer({
        renderer,
        premultipliedAlpha: true,
        sortRadial: true,
        enableLod: false,
      });
      sparkRef.current = spark;
      // SparkRenderer is a THREE.Mesh whose render hooks run only while it is in the scene graph.
      scene.add(spark);
    } catch (err) {
      console.warn('[SplatCanvas] SparkRenderer init warning:', err);
      return;
    }

    // Animation & Render Loop
    let animId: number;
    const renderLoop = (time: number) => {
      animId = requestAnimationFrame(renderLoop);

      // FPS tracking
      frameCountRef.current++;
      if (lastFpsTimeRef.current === null) lastFpsTimeRef.current = time;
      if (time - lastFpsTimeRef.current >= 500) {
        currentFpsRef.current = Math.round(
          (frameCountRef.current * 1000) / (time - lastFpsTimeRef.current)
        );
        frameCountRef.current = 0;
        lastFpsTimeRef.current = time;

        if (metricsCallbackRef.current && loadedCountRef.current > 0) {
          metricsCallbackRef.current({
            fps: currentFpsRef.current,
            splatCount: loadedCountRef.current,
            format: loadedFormatRef.current,
            isLoaded: true,
          });
        }
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current && sparkRef.current) {
        const state = cameraStatePropRef.current?.current || legacyCameraStateRef.current;
        if (state) {
          const camera = cameraRef.current;
          camera.position.set(...state.position);
          camera.quaternion.set(...state.quaternion);
          camera.fov = state.fov;
          camera.near = state.near;
          camera.far = state.far;
          camera.aspect = state.aspect;
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld();
        }
        sparkRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    animId = requestAnimationFrame(renderLoop);

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
      spark.dispose();
      renderer.dispose();
    };
  }, []);

  // 2. Load the active Pascal ScanNode's source unchanged into Spark.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const previous = splatMeshRef.current;
    if (previous) {
      scene.remove(previous);
      previous.dispose();
      splatMeshRef.current = null;
      loadedCountRef.current = 0;
    }
    if (!scanUrl) {
      pickerCallbackRef.current?.(null);
      return;
    }
    let cancelled = false;
    try {
      const splatMesh = new SplatMesh({
        url: scanUrl,
        raycastable: true,
        onLoad: (mesh: SplatMeshType) => {
          if (cancelled) return;
          loadedCountRef.current = mesh.numSplats || 0;
          onMetricsUpdate?.({
            fps: currentFpsRef.current,
            splatCount: loadedCountRef.current,
            format: (loadedFormatRef.current = scanUrl.split(/[?#]/)[0].split('.').pop()?.toUpperCase() || 'SCAN'),
            isLoaded: true,
          });
          const picker = (clientX: number, clientY: number) => {
            const canvas = canvasRef.current;
            const camera = cameraRef.current;
            const activeMesh = splatMeshRef.current;
            if (!canvas || !camera || !activeMesh?.raycastable) return null;
            const rect = canvas.getBoundingClientRect();
            const pointer = new THREE.Vector2(
              ((clientX - rect.left) / rect.width) * 2 - 1,
              -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            const raycaster = raycasterRef.current;
            raycaster.setFromCamera(pointer, camera);
            const hits = raycaster.intersectObject(activeMesh, false);
            const point = hits[0]?.point;
            return point ? [point.x, point.y, point.z] as [number, number, number] : null;
          };
          pickerCallbackRef.current?.(picker);
        },
      });
      splatMeshRef.current = splatMesh;
      scene.add(splatMesh);
    } catch (err) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Spark throws synchronously for unsupported scan URLs; show it
      setErrorMsg(`Could not load scan: ${(err as Error).message}`);
    }
    return () => {
      cancelled = true;
      if (splatMeshRef.current) {
        scene.remove(splatMeshRef.current);
        splatMeshRef.current.dispose();
        splatMeshRef.current = null;
      }
      pickerCallbackRef.current?.(null);
    };
  }, [scanUrl, onMetricsUpdate]);

  // 3. Apply the persisted Pascal alignment without modifying source splat data.
  useEffect(() => {
    const mesh = splatMeshRef.current;
    if (!mesh) return;
    mesh.visible = visible;
    if (!scanToScene || scanToScene.length !== 16) return;
    const matrix = new THREE.Matrix4().set(...scanToScene as [
      number, number, number, number, number, number, number, number,
      number, number, number, number, number, number, number, number,
    ]);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.matrixWorldNeedsUpdate = true;
  }, [scanToScene, scanUrl, visible]);

  // 4. Per-region OBB masking. Re-runs whenever the SplatMesh is recreated (scanUrl change), so a
  // newly loaded scan never renders without its persisted masks.
  useEffect(() => {
    const splatMesh = splatMeshRef.current;
    if (!splatMesh) return;
    const regions: MaskRegion[] = maskRegions.length > 0
      ? maskRegions
      : enableMasking
        ? [{ id: 'prototype-mask', obb: { center: maskPosition, size: maskSize, yaw: 0 }, feather: 0.05, enabled: true }]
        : [];
    applyMaskEdits(splatMesh, regions);
    return () => {
      splatMesh.edits = null;
    };
  }, [scanUrl, enableMasking, maskPosition, maskSize, maskRegions]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E !== '1') return;
    const sceneCenters = (visit: (p: THREE.Vector3) => void) => {
      const mesh = splatMeshRef.current;
      if (!mesh?.isInitialized) return;
      mesh.updateMatrixWorld();
      const world = mesh.matrixWorld;
      mesh.forEachSplat((_i: number, center: THREE.Vector3) => visit(center.clone().applyMatrix4(world)));
    };
    window.__spacegenSplat = {
      numSplats: () => splatMeshRef.current?.numSplats ?? 0,
      editCount: () => splatMeshRef.current?.edits?.length ?? 0,
      bounds() {
        const box = new THREE.Box3();
        sceneCenters((p) => box.expandByPoint(p));
        return box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() };
      },
      countInside(obb) {
        const toLocal = new THREE.Matrix4().makeRotationY(obb.yaw).setPosition(...obb.center).invert();
        let count = 0;
        sceneCenters((p) => {
          p.applyMatrix4(toLocal);
          if (Math.abs(p.x) <= obb.size[0] / 2 && Math.abs(p.y) <= obb.size[1] / 2 && Math.abs(p.z) <= obb.size[2] / 2) count += 1;
        });
        return count;
      },
    };
    return () => {
      delete window.__spacegenSplat;
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full pointer-events-none">
      <canvas ref={canvasRef} data-testid="splat-canvas" className="w-full h-full block" />
      {errorMsg && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-red-950/60 p-6 text-red-200 pointer-events-none">
          <div className="max-w-lg bg-black/90 p-5 border border-red-500 rounded-xl shadow-2xl font-mono text-xs pointer-events-auto">
            <h4 className="text-sm font-bold text-red-400 mb-2 flex items-center gap-2">
              <span>⚠</span> Scan load failed
            </h4>
            <p className="leading-relaxed text-red-200/90">{errorMsg}</p>
            <div className="mt-4 pt-3 border-t border-red-900/60 flex justify-end">
              <button
                onClick={() => setErrorMsg(null)}
                className="px-3 py-1 bg-red-700/80 hover:bg-red-600 text-white rounded text-xs transition-colors"
              >
                Dismiss Error
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
