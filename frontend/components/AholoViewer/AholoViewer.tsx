'use client';

// frontend/components/AholoViewer/AholoViewer.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createViewer,
  setViewerConfig,
  BackgroundMode,
  Color,
  PerspectiveCamera,
  Vector3,
  SplatLoader,
  SplatUtils,
  GLTFLoader,
  downloadTexture,
  AmbientLight,
  DirectionalLight,
  type Viewer,
  type Object3D,
} from '@manycore/aholo-viewer';
import { CameraControl } from './AholoCameraControls';
import { Loader2, AlertTriangle, X } from 'lucide-react';
import {
  AholoPipelineParams,
  AholoViewerHandles,
  applyViewerPipelineConfig,
  serializeCamera,
  applyCameraState,
  applyCoordinateSystem as applyCoordSys,
  DEFAULT_PIPELINE_PARAMS,
} from './AholoViewerTypes';

export interface AholoViewerProps {
  /** 3D 资产地址（.sog, .ply, .spz, .splat, .ksplat, .glb, .gltf） */
  src?: string | null;
  /** 兼容别名 */
  url?: string | null;
  /** 本地内存二进制数据 */
  localData?: { buffer: ArrayBuffer; name: string } | null;
  /** 手动指定文件格式，若不提供则根据后缀与文件头自动探测 */
  format?: 'sog' | 'ply' | 'spz' | 'splat' | 'ksplat' | 'glb' | 'gltf';
  /** 背景色 (十六进制，如 "#121212") */
  backgroundColor?: string;
  /** 坐标系模式：opencv (3DGS常见), opengl, aholo */
  coordinateSystem?: 'opencv' | 'opengl' | 'aholo';
  /** 是否允许轨道环绕（默认开启） */
  useOrbit?: boolean;
  /** 远裁剪面距离 (默认 2000) */
  farPlane?: number;
  /** 渲染管线调优参数 (来自预设或手动微调) */
  pipelineParams?: AholoPipelineParams;
  /** 是否可见 */
  visible?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** 状态回调 */
  onLoading?: (isLoading: boolean) => void;
  onProgress?: (percent: number, stage?: string) => void;
  onLoaded?: (info: { splatCount: number; fileName?: string }) => void;
  onError?: (err: Error) => void;
  onFpsUpdate?: (fps: number) => void;
  onDataLoaded?: (data: { buffer: ArrayBuffer; name: string }) => void;
  onResetViewReady?: (fn: () => void) => void;
  /** 供双侧栏工作区全面控制相机与管线的 handles */
  onViewerReady?: (handles: AholoViewerHandles) => void;
}

/**
 * Intercept Blob and Worker creation so Webpack/Next.js chunk URLs pointing to
 * splat-worker, splat-sort-worker, or transcoder-worker resolve cleanly to /public static workers.
 */
if (typeof window !== 'undefined' && !(window as any).__aholoWorkersPatched) {
  (window as any).__aholoWorkersPatched = true;

  const workerUrlMap = new Map<string, string>();

  const OriginalBlob = window.Blob;
  window.Blob = class PatchedBlob extends OriginalBlob {
    constructor(blobParts?: BlobPart[], options?: BlobPropertyBag) {
      if (blobParts && Array.isArray(blobParts)) {
        let isWorkerScript = false;
        let workerTarget = '/splat-worker.js';

        const fixedParts = blobParts.map((part) => {
          if (typeof part === 'string') {
            if (part.includes('splat-sort-worker')) {
              isWorkerScript = true;
              workerTarget = '/splat-sort-worker.js';
              return `import "${window.location.origin}/splat-sort-worker.js";`;
            } else if (part.includes('transcoder-worker')) {
              isWorkerScript = true;
              workerTarget = '/transcoder-worker.js';
              return `import "${window.location.origin}/transcoder-worker.js";`;
            } else if (part.includes('splat-worker')) {
              isWorkerScript = true;
              workerTarget = '/splat-worker.js';
              return `import "${window.location.origin}/splat-worker.js";`;
            }
          }
          return part;
        });

        super(fixedParts, options);
        if (isWorkerScript) {
          (this as any).__aholoWorkerTarget = workerTarget;
        }
        return;
      }
      super(blobParts, options);
    }
  } as any;

  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj: Blob | MediaSource): string {
    const url = originalCreateObjectURL.call(URL, obj);
    if (obj instanceof Blob && (obj as any).__aholoWorkerTarget) {
      workerUrlMap.set(url, (obj as any).__aholoWorkerTarget);
    }
    return url;
  };

  const OriginalWorker = window.Worker;
  window.Worker = class PatchedWorker extends OriginalWorker {
    constructor(stringUrl: string | URL, options?: WorkerOptions) {
      let resolvedUrl = stringUrl;
      const urlStr = typeof stringUrl === 'string' ? stringUrl : stringUrl.toString();

      if (workerUrlMap.has(urlStr)) {
        resolvedUrl = `${window.location.origin}${workerUrlMap.get(urlStr)}`;
      } else if (urlStr.includes('splat-sort-worker')) {
        resolvedUrl = `${window.location.origin}/splat-sort-worker.js`;
      } else if (urlStr.includes('transcoder-worker')) {
        resolvedUrl = `${window.location.origin}/transcoder-worker.js`;
      } else if (urlStr.includes('splat-worker')) {
        resolvedUrl = `${window.location.origin}/splat-worker.js`;
      }

      super(resolvedUrl, options);
      this.addEventListener('error', (err) => {
        console.error(`[Aholo Worker Error on ${resolvedUrl}]:`, err);
      });
    }
  } as any;
}

/**
 * Detect format from file name or binary magic bytes
 */
function detectFormat(name: string, buffer: ArrayBuffer, explicitFormat?: string): string {
  if (explicitFormat) return explicitFormat.toLowerCase();

  const lowerName = name.toLowerCase().split('?')[0];
  const ext = lowerName.split('.').pop() || '';

  // Direct extension checks
  if (['sog', 'ply', 'spz', 'splat', 'ksplat', 'glb', 'gltf'].includes(ext)) {
    return ext;
  }

  // Check binary magic bytes
  const u8 = new Uint8Array(buffer);
  if (u8.length >= 4) {
    const b0 = u8[0], b1 = u8[1], b2 = u8[2], b3 = u8[3];

    // PK\x03\x04: Zip file -> SOG
    if (b0 === 0x50 && b1 === 0x4b && b2 === 0x03 && b3 === 0x04) {
      return 'sog';
    }
    // 'ply\n' or 'ply\r'
    if (b0 === 0x70 && b1 === 0x6c && b2 === 0x79) {
      return 'ply';
    }
    // 'glTF'
    if (b0 === 0x67 && b1 === 0x6c && b2 === 0x54 && b3 === 0x46) {
      return 'glb';
    }
    // gzip \x1f\x8b -> SPZ
    if (b0 === 0x1f && b1 === 0x8b) {
      return 'spz';
    }
  }

  // Fallback: use SOG for zip-like or default to SOG
  return 'sog';
}

export const AholoViewer: React.FC<AholoViewerProps> = ({
  src,
  url,
  localData,
  format,
  backgroundColor = '#121212',
  coordinateSystem = 'opencv',
  useOrbit = true,
  farPlane = 2000,
  pipelineParams,
  visible = true,
  onLoading,
  onProgress,
  onLoaded,
  onError,
  onFpsUpdate,
  onDataLoaded,
  onResetViewReady,
  onViewerReady,
  className,
  style,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<CameraControl | null>(null);
  const currentObjectRef = useRef<Object3D | null>(null);
  const requestRenderRef = useRef<(() => void) | null>(null);

  const [viewerReady, setViewerReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeSrc = src || url;

  // Keep latest callback references without triggering effect re-execution
  const callbacksRef = useRef({
    onLoading,
    onProgress,
    onLoaded,
    onError,
    onFpsUpdate,
    onDataLoaded,
    onResetViewReady,
    onViewerReady,
  });
  callbacksRef.current = {
    onLoading,
    onProgress,
    onLoaded,
    onError,
    onFpsUpdate,
    onDataLoaded,
    onResetViewReady,
    onViewerReady,
  };

  // Sync camera aspect ratio with viewer size
  const syncAspect = useCallback((camera: PerspectiveCamera, viewer: Viewer) => {
    const size = viewer.getSize();
    if (size.width > 0 && size.height > 0) {
      const aspect = size.width / size.height;
      if (Math.abs(camera.aspect - aspect) > 0.001) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    }
  }, []);

  // 1. ENGINE LIFECYCLE EFFECT: Initialized once on container mount, destroyed ONLY on unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === 'undefined') return;

    const viewerId = `aholo-canvas-${Math.random().toString(36).substring(2, 9)}`;
    const viewer = createViewer(viewerId, container, { antialiasing: false });
    const camera = new PerspectiveCamera(60, 1, 0.1, farPlane || 2000);
    viewerRef.current = viewer;
    cameraRef.current = camera;

    applyCoordSys(coordinateSystem, camera, null, farPlane || 2000);
    viewer.setCamera(camera);

    const effectiveParams = pipelineParams || DEFAULT_PIPELINE_PARAMS;
    applyViewerPipelineConfig(viewer, effectiveParams, backgroundColor);

    const controls = new CameraControl(camera as any, container, {
      orbitCenter: { x: 0, y: 0, z: 0 },
      useOrbit,
      moveSpeed: 0.6,
      lookSpeed: 0.004,
      wheelSpeed: 0.006,
      panSpeed: 0.005,
    });
    controlsRef.current = controls;

    let renderRequested = true;
    const requestRender = () => {
      renderRequested = true;
    };
    requestRenderRef.current = requestRender;
    controls.setOnChange(requestRender);
    viewer.requestRenderHandler = requestRender;

    let rafId: number;
    let lastTime = performance.now();
    let lastFpsTime = performance.now();
    let frameCount = 0;

    const loop = (now: number) => {
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const controlsChanged = controls.update(delta);
      if (renderRequested || controlsChanged) {
        renderRequested = false;
        syncAspect(camera, viewer);
        viewer.getScene().notifySceneChange();
        viewer.render();
      }

      frameCount++;
      if (now - lastFpsTime >= 500) {
        const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
        callbacksRef.current.onFpsUpdate?.(fps);
        frameCount = 0;
        lastFpsTime = now;
      }

      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    const resizeObserver = new ResizeObserver(() => {
      viewer.resize();
      syncAspect(camera, viewer);
      requestRender();
    });
    resizeObserver.observe(container);

    const handleResetView = () => {
      applyCoordSys(coordinateSystem, camera, controls, farPlane || 2000);
      requestRender();
    };
    callbacksRef.current.onResetViewReady?.(handleResetView);

    if (callbacksRef.current.onViewerReady) {
      callbacksRef.current.onViewerReady({
        getViewer: () => viewerRef.current,
        getCamera: () => cameraRef.current,
        getControls: () => controlsRef.current,
        setViewerConfig: (cfg) => {
          if (viewerRef.current) setViewerConfig(viewerRef.current, cfg);
        },
        serializeCamera: () => {
          return cameraRef.current ? serializeCamera(cameraRef.current) : null;
        },
        applyCameraState: (state) => {
          if (cameraRef.current) {
            applyCameraState(cameraRef.current, state);
            requestRender();
          }
        },
        applyCoordinateSystem: (sys) => {
          if (cameraRef.current) {
            applyCoordSys(sys, cameraRef.current, controlsRef.current, farPlane);
            requestRender();
          }
        },
        setFarPlane: (far) => {
          if (cameraRef.current && Number.isFinite(far) && far > 0.1) {
            cameraRef.current.far = far;
            cameraRef.current.updateProjectionMatrix();
            requestRender();
          }
        },
        resetCamera: () => {
          handleResetView();
        },
        requestRender,
      });
    }

    setViewerReady(true);

    return () => {
      setViewerReady(false);
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.dispose();
      controlsRef.current = null;

      if (currentObjectRef.current) {
        try {
          viewer.getScene().remove(currentObjectRef.current);
          if ('destroy' in currentObjectRef.current && typeof (currentObjectRef.current as any).destroy === 'function') {
            (currentObjectRef.current as any).destroy();
          }
        } catch {
          // ignore
        }
        currentObjectRef.current = null;
      }

      viewer.requestRenderHandler = undefined;
      viewer.destroy();
      viewerRef.current = null;
      cameraRef.current = null;

      for (const child of Array.from(container.children)) {
        if (child instanceof HTMLCanvasElement) {
          child.remove();
        }
      }
    };
  }, []);

  // 2. CAMERA & COORDINATE SYSTEM SYNC
  useEffect(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    controlsRef.current.useOrbit = useOrbit;
    applyCoordSys(coordinateSystem, cameraRef.current, controlsRef.current, farPlane || 2000);
    requestRenderRef.current?.();
  }, [coordinateSystem, useOrbit, farPlane]);

  // 3. PIPELINE PARAMETERS & BACKGROUND SYNC
  useEffect(() => {
    if (!viewerRef.current || !pipelineParams) return;
    applyViewerPipelineConfig(viewerRef.current, pipelineParams, backgroundColor);
    requestRenderRef.current?.();
  }, [pipelineParams, backgroundColor]);

  // 4. ASSET LOADING EFFECT: Only runs when asset source or data changes, never destroys the WebGL viewer
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const viewer = viewerRef.current;

    const abortController = new AbortController();

    async function loadAsset() {
      if (!activeSrc && !localData) {
        if (currentObjectRef.current) {
          try {
            viewer.getScene().remove(currentObjectRef.current);
            if ('destroy' in currentObjectRef.current && typeof (currentObjectRef.current as any).destroy === 'function') {
              (currentObjectRef.current as any).destroy();
            }
          } catch {
            // ignore
          }
          currentObjectRef.current = null;
          viewer.getScene().notifySceneChange();
          requestRenderRef.current?.();
        }
        setLoading(false);
        setLoadingStage(null);
        setErrorMessage(null);
        callbacksRef.current.onLoading?.(false);
        return;
      }

      try {
        setLoading(true);
        callbacksRef.current.onLoading?.(true);
        setErrorMessage(null);

        const resourceName = localData?.name || activeSrc || '';
        callbacksRef.current.onProgress?.(15, 'Reading 3D data from memory/network...');
        setLoadingStage('Loading 3D asset into memory...');

        // Step A: Acquire binary buffer
        let buffer: ArrayBuffer;
        if (localData?.buffer) {
          buffer = localData.buffer;
        } else {
          const res = await fetch(activeSrc!, { signal: abortController.signal });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: Failed to fetch ${activeSrc}`);
          }
          buffer = await res.arrayBuffer();
        }

        if (abortController.signal.aborted) return;

        // Step B: Detect format
        const detectedFormat = detectFormat(resourceName, buffer, format);
        const isMesh = detectedFormat === 'glb' || detectedFormat === 'gltf';

        // Clear any previous loaded asset from scene
        if (currentObjectRef.current) {
          try {
            viewer.getScene().remove(currentObjectRef.current);
            if ('destroy' in currentObjectRef.current && typeof (currentObjectRef.current as any).destroy === 'function') {
              (currentObjectRef.current as any).destroy();
            }
          } catch {
            // ignore
          }
          currentObjectRef.current = null;
        }

        if (isMesh) {
          // Polygon Mesh Pipeline (GLTF/GLB)
          setLoadingStage('Parsing GLTF mesh geometry & textures...');
          callbacksRef.current.onProgress?.(45, 'Parsing mesh geometry...');

          const gltfResult = await GLTFLoader.loadGLTF(buffer, {
            textureLoader: downloadTexture,
          });

          if (abortController.signal.aborted) return;

          // Add lighting for mesh materials
          const ambient = new AmbientLight(new Color(0.8, 0.8, 0.8) as any);
          const dirLight = new DirectionalLight(new Color(1, 1, 1) as any, 1.5);
          dirLight.position.set(5, 10, 7);
          viewer.getScene().add(ambient);
          viewer.getScene().add(dirLight);

          currentObjectRef.current = gltfResult.scene as unknown as Object3D;
          viewer.getScene().add(currentObjectRef.current);

          callbacksRef.current.onProgress?.(100, 'Solid Mesh scene ready');
          callbacksRef.current.onLoaded?.({ splatCount: 0, fileName: resourceName });
        } else {
          // 3DGS Pipeline (SOG / PLY / SPZ / SPLAT / KSPLAT)
          setLoadingStage('Decoding Gaussian splat properties & ellipsoids...');
          callbacksRef.current.onProgress?.(45, 'Decoding spherical harmonics & ellipsoids...');

          let fileType: SplatLoader.SplatFileType;
          switch (detectedFormat) {
            case 'sog':
              fileType = SplatLoader.SplatFileType.SOG;
              break;
            case 'ply':
              fileType = SplatLoader.SplatFileType.PLY;
              break;
            case 'spz':
              fileType = SplatLoader.SplatFileType.SPZ;
              break;
            case 'ksplat':
              fileType = (SplatLoader.SplatFileType as any).KSPLAT ?? SplatLoader.SplatFileType.SPLAT;
              break;
            case 'splat':
            default:
              fileType = SplatLoader.SplatFileType.SPLAT;
              break;
          }

          let packType = pipelineParams?.splatPackType ?? SplatLoader.SplatPackType.Compressed;
          if (fileType === SplatLoader.SplatFileType.SOG && packType !== SplatLoader.SplatPackType.Sog) {
            // SOG files work with Sog or SuperCompressed
          } else if (fileType !== SplatLoader.SplatFileType.SOG && packType === SplatLoader.SplatPackType.Sog) {
            packType = SplatLoader.SplatPackType.Compressed;
          }

          let maxSh = typeof pipelineParams?.maxSh === 'number' ? pipelineParams.maxSh : 3;

          if (fileType === SplatLoader.SplatFileType.PLY) {
            try {
              const headerSlice = new Uint8Array(buffer, 0, Math.min(4096, buffer.byteLength));
              const headerText = new TextDecoder().decode(headerSlice);
              let numRest = 0;
              while (headerText.includes(`f_rest_${numRest}`)) {
                numRest++;
              }
              if (numRest >= 45) maxSh = Math.min(maxSh, 3);
              else if (numRest >= 24) maxSh = Math.min(maxSh, 2);
              else if (numRest >= 9) maxSh = Math.min(maxSh, 1);
              else maxSh = 0;
            } catch {
              // fallback
            }
          }

          let parseInput: string | Uint8Array;
          let tempBlobUrl: string | null = null;
          if (localData?.buffer) {
            const blob = new Blob([buffer]);
            tempBlobUrl = URL.createObjectURL(blob);
            parseInput = tempBlobUrl;
          } else if (activeSrc) {
            parseInput = activeSrc;
          } else {
            parseInput = new Uint8Array(buffer);
          }

          let splatData;
          try {
            splatData = await Promise.race([
              SplatLoader.parseSplatData(
                fileType,
                parseInput as any,
                packType,
                { maxShDegree: maxSh, maxTextureSize: 8192 }
              ),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        'Splat parsing timed out. Please check that the file is a valid 3DGS splat.'
                      )
                    ),
                  30000
                )
              ),
            ]);
          } finally {
            if (tempBlobUrl) {
              URL.revokeObjectURL(tempBlobUrl);
            }
          }

          if (abortController.signal.aborted) return;

          if ((splatData as any)?.shDegree === 0) {
            setViewerConfig(viewer, {
              pipeline: {
                Splatting: {
                  pack: { precalculateEnabled: false },
                },
              },
            });
          }

          callbacksRef.current.onProgress?.(80, 'Creating GPU Gaussian splatting rasterizer...');
          setLoadingStage('Rasterizing 3D Gaussian Splats on GPU...');

          const splat = await SplatUtils.createSplat(splatData);
          currentObjectRef.current = splat as unknown as Object3D;
          viewer.getScene().add(currentObjectRef.current);

          const count =
            (splatData as any)?.count ??
            (splatData as any)?.splatCount ??
            (splat as any)?.splatCount ??
            0;

          callbacksRef.current.onProgress?.(100, 'Scene ready');
          callbacksRef.current.onLoaded?.({ splatCount: count, fileName: resourceName });
        }

        viewer.getScene().notifySceneChange();
        requestRenderRef.current?.();
      } catch (err: any) {
        if (!abortController.signal.aborted) {
          console.error('[AholoViewer] Load failed:', err);
          setErrorMessage(err.message || String(err));
          callbacksRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
          setLoadingStage(null);
          callbacksRef.current.onLoading?.(false);
        }
      }
    }

    loadAsset();

    return () => {
      abortController.abort();
    };
  }, [viewerReady, activeSrc, localData, format, pipelineParams?.splatPackType, pipelineParams?.maxSh]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        touchAction: 'none',
        display: visible ? 'block' : 'none',
        ...style,
      }}
    >
      {/* Loading overlay */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(4px)',
            color: '#ffffff',
            fontSize: '14px',
            pointerEvents: 'none',
            zIndex: 30,
          }}
        >
          <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
          <span>{loadingStage || 'Loading 3D asset...'}</span>
        </div>
      )}

      {/* Error banner */}
      {errorMessage && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '480px',
            width: '90%',
            padding: '12px 16px',
            backgroundColor: 'rgba(69, 10, 10, 0.9)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '12px',
            color: '#fecaca',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            zIndex: 40,
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          }}
        >
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#fee2e2', marginBottom: '2px' }}>
              Model Load Error
            </div>
            <p style={{ margin: 0, opacity: 0.9 }}>{errorMessage}</p>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#f87171',
              cursor: 'pointer',
              padding: '2px',
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default AholoViewer;
