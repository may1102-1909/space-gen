'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  SparkRenderer,
  SplatMesh,
  SplatEdit,
  SplatEditSdf,
  SplatEditSdfType,
} from '@sparkjsdev/spark';

type SparkRendererType = InstanceType<typeof SparkRenderer>;
type SplatMeshType = InstanceType<typeof SplatMesh>;
type SplatEditType = InstanceType<typeof SplatEdit>;

export interface SplatCameraState {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
  aspect: number;
  near: number;
  far: number;
}

export interface SplatBackgroundCanvasProps {
  cameraState?: SplatCameraState | null;
  enableMasking?: boolean;
  maskPosition?: [number, number, number];
  maskSize?: [number, number, number];
  onMetricsUpdate?: (metrics: {
    fps: number;
    splatCount: number;
    format: string;
    isLoaded: boolean;
  }) => void;
  renderMode?: 'synced' | 'unsupported_webgpu' | 'forced_webgl_fail';
}

export const SplatBackgroundCanvas: React.FC<SplatBackgroundCanvasProps> = ({
  cameraState,
  enableMasking = false,
  maskPosition = [0, 0, 0],
  maskSize = [1.5, 1.5, 1.5],
  onMetricsUpdate,
  renderMode = 'synced',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sparkRef = useRef<SparkRendererType | null>(null);
  const splatMeshRef = useRef<SplatMeshType | null>(null);
  const splatEditRef = useRef<SplatEditType | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadedCount, setLoadedCount] = useState<number>(0);

  // FPS calculation refs
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const currentFpsRef = useRef(60);

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
    } catch (err: any) {
      setErrorMsg(`Failed to initialize WebGL2 context: ${err.message}`);
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
    } catch (err: any) {
      console.warn('[SplatCanvas] SparkRenderer init warning:', err);
      return;
    }

    // Load Hurstville_Museum_Gallery.sog
    try {
      const splatMesh = new SplatMesh({
        url: '/Hurstville_Museum_Gallery.sog',
        onLoad: (mesh: SplatMeshType) => {
          const numSplats = mesh.numSplats || 161576;
          setLoadedCount(numSplats);
          if (onMetricsUpdate) {
            onMetricsUpdate({
              fps: currentFpsRef.current,
              splatCount: numSplats,
              format: 'pcsogszip (.sog)',
              isLoaded: true,
            });
          }
        },
      });
      splatMeshRef.current = splatMesh;
      scene.add(splatMesh);
    } catch (err: any) {
      console.warn('[SplatCanvas] Failed loading .sog splat mesh:', err);
    }

    // Animation & Render Loop
    let animId: number;
    const renderLoop = (time: number) => {
      animId = requestAnimationFrame(renderLoop);

      // FPS tracking
      frameCountRef.current++;
      if (time - lastFpsTimeRef.current >= 500) {
        currentFpsRef.current = Math.round(
          (frameCountRef.current * 1000) / (time - lastFpsTimeRef.current)
        );
        frameCountRef.current = 0;
        lastFpsTimeRef.current = time;

        if (onMetricsUpdate && loadedCount > 0) {
          onMetricsUpdate({
            fps: currentFpsRef.current,
            splatCount: loadedCount,
            format: 'pcsogszip (.sog)',
            isLoaded: true,
          });
        }
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current && sparkRef.current) {
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

  // Update diagnostic simulation message when renderMode changes
  useEffect(() => {
    if (renderMode === 'unsupported_webgpu') {
      setErrorMsg(
        'SIMULATION ERROR (Option A): WebGPURenderer is incompatible with @sparkjsdev/spark. Spark called `renderer.getContext()`, which returned undefined (WebGPU uses GPUCanvasContext). Spark crashed with: TypeError: renderer.properties is undefined.'
      );
    } else if (renderMode === 'forced_webgl_fail') {
      setErrorMsg(
        'SIMULATION ERROR (Option B): Three.js WebGPURenderer({ forceWebGL: true }) uses WebGLBackend with TSL NodeMaterial pipelines. Spark RawShaderMaterial GLSL compilation failed: Backend requires NodeMaterials.'
      );
    } else {
      setErrorMsg(null);
    }
  }, [renderMode]);

  // 2. Synchronize Camera when cameraState changes
  useEffect(() => {
    if (!cameraRef.current || !cameraState) return;

    const cam = cameraRef.current;
    cam.position.set(...cameraState.position);
    cam.quaternion.set(...cameraState.quaternion);
    cam.fov = cameraState.fov;
    cam.near = cameraState.near;
    cam.far = cameraState.far;
    cam.aspect = cameraState.aspect;
    cam.updateProjectionMatrix();
  }, [cameraState]);

  // 3. Dynamic Per-Region OBB Masking (SplatEdit SDF Box)
  useEffect(() => {
    const splatMesh = splatMeshRef.current;
    if (!splatMesh) return;

    if (enableMasking) {
      if (!splatEditRef.current) {
        const boxSdf = new SplatEditSdf({
          type: SplatEditSdfType.BOX,
          opacity: 0.0, // Clear / hide splats in this region
        });
        boxSdf.position.set(...maskPosition);
        boxSdf.scale.set(...maskSize);

        const edit = new SplatEdit({
          sdfs: [boxSdf],
          sdfSmooth: 0.05,
        });

        splatMesh.add(edit);
        splatEditRef.current = edit;
      } else {
        const sdf = splatEditRef.current.sdfs?.[0];
        if (sdf) {
          sdf.position.set(...maskPosition);
          sdf.scale.set(...maskSize);
        }
      }
    } else if (splatEditRef.current) {
      splatMesh.remove(splatEditRef.current);
      splatEditRef.current = null;
    }
  }, [enableMasking, maskPosition, maskSize]);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full pointer-events-none">
      <canvas ref={canvasRef} className="w-full h-full block" />
      {errorMsg && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-red-950/60 p-6 text-red-200 pointer-events-none">
          <div className="max-w-lg bg-black/90 p-5 border border-red-500 rounded-xl shadow-2xl font-mono text-xs pointer-events-auto">
            <h4 className="text-sm font-bold text-red-400 mb-2 flex items-center gap-2">
              <span>⚠</span> Evaluation Diagnostic Failure
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
