// frontend/components/AholoViewer/AholoViewerTypes.ts
import {
  SplatLoader,
  ToneMapping,
  PerspectiveCamera,
  Vector3,
  Color,
  BackgroundMode,
  setViewerConfig,
  type Viewer,
} from '@manycore/aholo-viewer';
import type { CameraControl } from './AholoCameraControls';

export type SplattingPresetId =
  | 'custom'
  | 'maxQuality'
  | 'qualityFirst'
  | 'balanced'
  | 'performanceFirst'
  | 'extremePerformance0'
  | 'extremePerformance1';

export interface FileRecord {
  id: string;
  name: string;
  format: string; // 'PLY' | 'SPZ' | 'SOG' | 'SPLAT' | 'KSPLAT' | 'GLB' | 'ZIP'
  size: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  source: {
    kind: 'file' | 'url';
    file?: File;
    url?: string;
    buffer?: ArrayBuffer;
  };
}

export interface AholoPipelineParams {
  splattingPreset: SplattingPresetId;
  pixelRatio: number;
  splatPackType: SplatLoader.SplatPackType;
  maxSh: number;
  maxStdDev: number;
  packHighPrecisionEnabled: boolean;
  precalculateEnabled: boolean;
  cameraRelativeEnabled: boolean;
  sortedLayoutEnabled: boolean;
  autoFreeResourceOnGpuPacked: boolean;
  renderAttachHighPrecisionEnabled: boolean;
  normalizedFalloff: boolean;
  preBlurAmount: number;
  blurAmount: number;
  focalAdjustment: number;
  detailCullingThreshold: number;
  maxPixelRadius: number;
  minIntervalMs: number;
  sortSplatDistance: number;
  sortSplatCoorient: number;
  sortCameraDistance: number;
  sortCameraCoorient: number;
  sortHighPrecisionEnabled: boolean;
  toneMappingEnabled: boolean;
  toneMapping: ToneMapping;
  exposure: number;
  highlightEnabled: boolean;
  highlightSize: number;
  highlightColor: string;
}

export const DEFAULT_SORT_PARAMS: Pick<
  AholoPipelineParams,
  | 'minIntervalMs'
  | 'sortSplatDistance'
  | 'sortSplatCoorient'
  | 'sortCameraDistance'
  | 'sortCameraCoorient'
> = {
  minIntervalMs: 0,
  sortSplatDistance: 0.1,
  sortSplatCoorient: 0.99999,
  sortCameraDistance: 1,
  sortCameraCoorient: 0.99,
};

export const EXTREME_PERFORMANCE_SORT_PARAMS: typeof DEFAULT_SORT_PARAMS = {
  ...DEFAULT_SORT_PARAMS,
  minIntervalMs: 160,
  sortSplatCoorient: 0.999999,
};

export const VIEWER_SPLATTING_PRESETS: Record<
  SplattingPresetId,
  { nameZh: string; nameEn: string; descZh: string; descEn: string; params: Partial<AholoPipelineParams> }
> = {
  custom: {
    nameZh: '自定义',
    nameEn: 'Custom',
    descZh: '手动微调各项参数',
    descEn: 'Manual parameter customization',
    params: {},
  },
  maxQuality: {
    nameZh: '极限效果',
    nameEn: 'Max Quality',
    descZh: '离线级全精度渲染 (高端桌面 / 专用 GPU)',
    descEn: 'Offline-grade full precision (high-end GPU)',
    params: {
      ...DEFAULT_SORT_PARAMS,
      splatPackType: SplatLoader.SplatPackType.Compressed,
      maxSh: 3,
      maxStdDev: 8,
      packHighPrecisionEnabled: true,
      precalculateEnabled: true,
      cameraRelativeEnabled: false,
      sortedLayoutEnabled: false,
      autoFreeResourceOnGpuPacked: true,
      renderAttachHighPrecisionEnabled: true,
      normalizedFalloff: true,
      preBlurAmount: 0.3,
      blurAmount: 0,
      focalAdjustment: 2,
      detailCullingThreshold: 0,
      maxPixelRadius: 1024,
      sortHighPrecisionEnabled: true,
    },
  },
  qualityFirst: {
    nameZh: '效果优先',
    nameEn: 'Quality First',
    descZh: '桌面标准展示模式，画质与帧率平衡',
    descEn: 'Standard desktop showcase mode',
    params: {
      ...DEFAULT_SORT_PARAMS,
      splatPackType: SplatLoader.SplatPackType.Compressed,
      maxSh: 3,
      maxStdDev: 8,
      packHighPrecisionEnabled: true,
      precalculateEnabled: true,
      cameraRelativeEnabled: false,
      sortedLayoutEnabled: false,
      autoFreeResourceOnGpuPacked: true,
      renderAttachHighPrecisionEnabled: false,
      normalizedFalloff: false,
      preBlurAmount: 0.3,
      blurAmount: 0,
      focalAdjustment: 2,
      detailCullingThreshold: 1,
      maxPixelRadius: 1024,
      sortHighPrecisionEnabled: false,
    },
  },
  balanced: {
    nameZh: '均衡模式',
    nameEn: 'Balanced',
    descZh: '轻薄本及集显推荐，超级压缩低内存占用',
    descEn: 'Recommended for laptops & integrated GPUs',
    params: {
      ...DEFAULT_SORT_PARAMS,
      splatPackType: SplatLoader.SplatPackType.SuperCompressed,
      maxSh: 3,
      maxStdDev: 8,
      packHighPrecisionEnabled: false,
      precalculateEnabled: true,
      cameraRelativeEnabled: true,
      sortedLayoutEnabled: false,
      autoFreeResourceOnGpuPacked: false,
      renderAttachHighPrecisionEnabled: false,
      normalizedFalloff: false,
      preBlurAmount: 0.3,
      blurAmount: 0,
      focalAdjustment: 2,
      detailCullingThreshold: 1,
      maxPixelRadius: 1024,
      sortHighPrecisionEnabled: false,
    },
  },
  performanceFirst: {
    nameZh: '性能优先',
    nameEn: 'Performance First',
    descZh: '低端设备 / 大场景高帧率流畅运行',
    descEn: 'Optimized for high FPS in complex scenes',
    params: {
      ...DEFAULT_SORT_PARAMS,
      splatPackType: SplatLoader.SplatPackType.SuperCompressed,
      maxSh: 3,
      maxStdDev: 5,
      packHighPrecisionEnabled: false,
      precalculateEnabled: true,
      cameraRelativeEnabled: false,
      sortedLayoutEnabled: false,
      autoFreeResourceOnGpuPacked: true,
      renderAttachHighPrecisionEnabled: false,
      normalizedFalloff: false,
      preBlurAmount: 0.3,
      blurAmount: 0,
      focalAdjustment: 2,
      detailCullingThreshold: 1,
      maxPixelRadius: 1024,
      sortHighPrecisionEnabled: false,
    },
  },
  extremePerformance0: {
    nameZh: '极限性能 0',
    nameEn: 'Extreme Performance 0',
    descZh: '关闭 SH 预计算与高细节，超高帧率',
    descEn: 'SH precalc disabled, ultra-fast sort',
    params: {
      ...EXTREME_PERFORMANCE_SORT_PARAMS,
      splatPackType: SplatLoader.SplatPackType.SuperCompressed,
      maxSh: 0,
      maxStdDev: 5,
      packHighPrecisionEnabled: false,
      precalculateEnabled: false,
      cameraRelativeEnabled: false,
      sortedLayoutEnabled: true,
      autoFreeResourceOnGpuPacked: true,
      renderAttachHighPrecisionEnabled: false,
      normalizedFalloff: false,
      preBlurAmount: 0.3,
      blurAmount: 0,
      focalAdjustment: 2,
      detailCullingThreshold: 4,
      maxPixelRadius: 1024,
      sortHighPrecisionEnabled: false,
    },
  },
  extremePerformance1: {
    nameZh: '极限性能 1 (SOG)',
    nameEn: 'Extreme Performance 1 (SOG)',
    descZh: '原生 SOG 打包格式极限优化',
    descEn: 'Optimized for native SOG format',
    params: {
      ...EXTREME_PERFORMANCE_SORT_PARAMS,
      splatPackType: SplatLoader.SplatPackType.Sog,
      maxSh: 0,
      maxStdDev: 5,
      packHighPrecisionEnabled: false,
      precalculateEnabled: false,
      cameraRelativeEnabled: false,
      sortedLayoutEnabled: true,
      autoFreeResourceOnGpuPacked: true,
      renderAttachHighPrecisionEnabled: false,
      normalizedFalloff: false,
      preBlurAmount: 0.3,
      blurAmount: 0,
      focalAdjustment: 2,
      detailCullingThreshold: 4,
      maxPixelRadius: 1024,
      sortHighPrecisionEnabled: false,
    },
  },
};

export const DEFAULT_PIPELINE_PARAMS: AholoPipelineParams = {
  splattingPreset: 'balanced',
  pixelRatio: 1,
  splatPackType: SplatLoader.SplatPackType.SuperCompressed,
  maxSh: 3,
  maxStdDev: 8,
  packHighPrecisionEnabled: false,
  precalculateEnabled: true,
  cameraRelativeEnabled: true,
  sortedLayoutEnabled: false,
  autoFreeResourceOnGpuPacked: false,
  renderAttachHighPrecisionEnabled: false,
  normalizedFalloff: false,
  preBlurAmount: 0.3,
  blurAmount: 0,
  focalAdjustment: 2,
  detailCullingThreshold: 1,
  maxPixelRadius: 1024,
  minIntervalMs: 0,
  sortSplatDistance: 0.1,
  sortSplatCoorient: 0.99999,
  sortCameraDistance: 1,
  sortCameraCoorient: 0.99,
  sortHighPrecisionEnabled: false,
  toneMappingEnabled: false,
  toneMapping: ToneMapping.Neutral,
  exposure: 1,
  highlightEnabled: false,
  highlightSize: 2,
  highlightColor: '#0000ff',
};

export interface AholoViewerHandles {
  getViewer: () => Viewer | null;
  getCamera: () => PerspectiveCamera | null;
  getControls: () => CameraControl | null;
  setViewerConfig: (config: any) => void;
  serializeCamera: () => any;
  applyCameraState: (state: any) => void;
  applyCoordinateSystem: (sys: 'opencv' | 'opengl' | 'aholo') => void;
  setFarPlane: (far: number) => void;
  resetCamera: () => void;
  requestRender: () => void;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function serializeCamera(camera: PerspectiveCamera) {
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    rotation: {
      x: camera.rotation.x,
      y: camera.rotation.y,
      z: camera.rotation.z,
      order: camera.rotation.order,
    },
    up: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
  };
}

export function applyCameraState(camera: PerspectiveCamera, state: any) {
  if (!state || typeof state !== 'object' || !state.position) {
    throw new Error('Invalid camera state format. Expected JSON with position, rotation, up, far.');
  }
  camera.position.set(state.position.x, state.position.y, state.position.z);
  if (state.rotation) {
    camera.rotation.order = state.rotation.order || 'XYZ';
    camera.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
  }
  if (state.up) {
    camera.up.set(state.up.x, state.up.y, state.up.z);
  }
  if (typeof state.fov === 'number') camera.fov = state.fov;
  if (typeof state.near === 'number') camera.near = state.near;
  if (typeof state.far === 'number') camera.far = state.far;
  camera.updateProjectionMatrix();
}

export function applyCoordinateSystem(
  type: 'opencv' | 'opengl' | 'aholo',
  camera: PerspectiveCamera,
  controls?: CameraControl | null,
  far?: number
) {
  switch (type) {
    case 'aholo':
      camera.up.set(0, 0, 1);
      camera.position.set(0, -3, 1.2);
      break;
    case 'opengl':
      camera.up.set(0, 1, 0);
      camera.position.set(0, 1.2, 3);
      break;
    case 'opencv':
    default:
      camera.up.set(0, -1, 0);
      camera.position.set(0, -1.2, 3);
      break;
  }
  camera.lookAt(new Vector3(0, 0, 0));
  if (typeof far === 'number' && Number.isFinite(far) && far > 0.1) {
    camera.far = far;
  }
  camera.updateProjectionMatrix();
  if (controls) {
    controls.reset(camera.position, { x: 0, y: 0, z: 0 });
    controls.stop();
  }
}

export function applyViewerPipelineConfig(
  viewer: Viewer,
  params: AholoPipelineParams,
  backgroundColor: string = '#0a0a0f'
) {
  const hex = parseInt(backgroundColor.replace('#', ''), 16) || 0x0a0a0f;
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const colorNumber = parseInt(params.highlightColor.replace('#', ''), 16) || 0x0000ff;

  setViewerConfig(viewer, {
    pixelRatio: params.pixelRatio / dpr,
    pipeline: {
      Background: {
        background: {
          active: BackgroundMode.BasicBackground,
          basic: { color: new Color(r, g, b) as any, alpha: 1 },
        },
        ground: { enabled: false },
      },
      Splatting: {
        enabled: true,
        pack: {
          highPrecisionEnabled: params.packHighPrecisionEnabled,
          precalculateEnabled: params.precalculateEnabled,
          cameraRelativeEnabled: params.cameraRelativeEnabled,
          sortedLayoutEnabled: params.sortedLayoutEnabled,
        },
        raster: {
          normalizedFalloff: params.normalizedFalloff,
          preBlurAmount: params.preBlurAmount,
          blurAmount: params.blurAmount,
          focalAdjustment: params.focalAdjustment,
          detailCullingThreshold: params.detailCullingThreshold,
          maxPixelRadius: params.maxPixelRadius,
          maxStdDev: Math.sqrt(params.maxStdDev),
        },
        sort: {
          highPrecisionEnabled: params.sortHighPrecisionEnabled,
          minIntervalMs: params.minIntervalMs,
          sortSplatDistance: params.sortSplatDistance,
          sortSplatCoorient: params.sortSplatCoorient,
          sortCameraDistance: params.sortCameraDistance,
          sortCameraCoorient: params.sortCameraCoorient,
        },
        composite: {
          enabled: params.renderAttachHighPrecisionEnabled,
          highPrecisionEnabled: params.renderAttachHighPrecisionEnabled,
        },
        toneMapping: {
          enabled: params.toneMappingEnabled,
          toneMapping: params.toneMapping,
          exposure: params.exposure,
        },
        highlightKernel: {
          enabled: params.highlightEnabled,
          size: params.highlightSize,
          color: colorNumber,
        },
      },
      TAA: { enabled: false },
    },
  });
}
