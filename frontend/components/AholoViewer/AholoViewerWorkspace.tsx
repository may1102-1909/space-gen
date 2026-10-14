'use client';

// frontend/components/AholoViewer/AholoViewerWorkspace.tsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  Upload,
  Link2,
  RotateCcw,
  Compass,
  Sliders,
  Sparkles,
  FileCheck,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Trash2,
  Copy,
  ClipboardPaste,
  Maximize2,
  Layers,
  Eye,
  Activity,
  CheckCircle2,
  Box,
  FileCode,
  X,
} from 'lucide-react';
import {
  SplatLoader,
  ToneMapping,
  type Viewer,
} from '@manycore/aholo-viewer';
import {
  AholoPipelineParams,
  AholoViewerHandles,
  FileRecord,
  SplattingPresetId,
  VIEWER_SPLATTING_PRESETS,
  DEFAULT_PIPELINE_PARAMS,
  formatBytes,
} from './AholoViewerTypes';

// Dynamic import with ssr: false to guarantee WebGL2 & Web Worker client execution
const AholoViewer = dynamic(
  () => import('./AholoViewer').then((mod) => mod.AholoViewer),
  { ssr: false }
);

const LEFT_COLLAPSED_KEY = 'aholo:viewer:left-collapsed';
const RIGHT_COLLAPSED_KEY = 'aholo:viewer:right-collapsed';

export interface AholoViewerWorkspaceProps {
  initialFileUrl?: string | null;
  className?: string;
}

export function AholoViewerWorkspace({
  initialFileUrl = null,
  className = '',
}: AholoViewerWorkspaceProps) {
  // Rails collapse state
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);

  // File records state
  const [records, setRecords] = useState<FileRecord[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);

  // Viewer rendering parameters & presets
  const [pipelineParams, setPipelineParams] = useState<AholoPipelineParams>(DEFAULT_PIPELINE_PARAMS);

  // Camera & view controls
  const [coordSystem, setCoordSystem] = useState<'opencv' | 'opengl' | 'aholo'>('opencv');
  const [useOrbit, setUseOrbit] = useState<boolean>(true);
  const [farPlane, setFarPlane] = useState<number>(2000);
  const [bgColor, setBgColor] = useState<string>('#0a0a0f');

  // Stats & status HUD
  const [fps, setFps] = useState<number>(0);
  const [splatCount, setSplatCount] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Accordion folder collapse state in right sidebar
  const [openFolders, setOpenFolders] = useState<{ [key: string]: boolean }>({
    preset: true,
    display: true,
    pack: false,
    raster: false,
    sort: false,
    toneMapping: false,
    highlight: false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerHandlesRef = useRef<AholoViewerHandles | null>(null);

  // Load rail collapsed preferences from localStorage on client
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const left = localStorage.getItem(LEFT_COLLAPSED_KEY);
      if (left !== null) setLeftCollapsed(left === 'true');
      const right = localStorage.getItem(RIGHT_COLLAPSED_KEY);
      if (right !== null) setRightCollapsed(right === 'true');
    } catch {
      // ignore
    }
  }, []);

  const toggleLeftRail = useCallback((collapsed: boolean) => {
    setLeftCollapsed(collapsed);
    try {
      localStorage.setItem(LEFT_COLLAPSED_KEY, String(collapsed));
    } catch {}
  }, []);

  const toggleRightRail = useCallback((collapsed: boolean) => {
    setRightCollapsed(collapsed);
    try {
      localStorage.setItem(RIGHT_COLLAPSED_KEY, String(collapsed));
    } catch {}
  }, []);

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  }, []);

  // Preset switching handler
  const handleSelectPreset = useCallback(
    (presetId: SplattingPresetId) => {
      if (presetId === 'custom') {
        setPipelineParams((prev) => ({ ...prev, splattingPreset: 'custom' }));
        return;
      }
      const presetConfig = VIEWER_SPLATTING_PRESETS[presetId];
      if (!presetConfig) return;

      setPipelineParams((prev) => ({
        ...prev,
        ...presetConfig.params,
        splattingPreset: presetId,
      }));
      showToast(`已应用渲染预设: ${presetConfig.nameZh}`, 'success');
    },
    [showToast]
  );

  // Update a single parameter and mark preset as custom
  const handleParamChange = useCallback(<K extends keyof AholoPipelineParams>(key: K, value: AholoPipelineParams[K]) => {
    setPipelineParams((prev) => ({
      ...prev,
      [key]: value,
      splattingPreset: 'custom',
    }));
  }, []);

  // Format detection helper
  const detectFormatBadge = (name: string): string => {
    const ext = name.toLowerCase().split('?')[0].split('.').pop() || '';
    if (ext === 'sog') return 'SOG';
    if (ext === 'ply') return 'PLY';
    if (ext === 'spz') return 'SPZ';
    if (ext === 'splat') return 'SPLAT';
    if (ext === 'ksplat') return 'KSPLAT';
    if (ext === 'glb') return 'GLB';
    if (ext === 'gltf') return 'GLTF';
    if (ext === 'zip') return 'ZIP';
    if (ext === 'json') return 'JSON';
    return ext.toUpperCase() || '3DGS';
  };

  // Add source to file records and activate
  const addSourceRecord = useCallback(
    (source: { kind: 'file' | 'url'; file?: File; url?: string; buffer?: ArrayBuffer; name: string; size?: number }) => {
      const id = `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const format = detectFormatBadge(source.name);
      const sizeStr = source.size !== undefined ? formatBytes(source.size) : source.file ? formatBytes(source.file.size) : '-';

      const newRecord: FileRecord = {
        id,
        name: source.name,
        format,
        size: sizeStr,
        status: 'ready',
        source: {
          kind: source.kind,
          file: source.file,
          url: source.url,
          buffer: source.buffer,
        },
      };

      setRecords((prev) => [newRecord, ...prev]);
      setActiveRecordId(id);
      setSplatCount(null);
    },
    []
  );

  // Handle local file selection
  const handleFilesSelected = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      for (const file of files) {
        try {
          const buffer = await file.arrayBuffer();
          addSourceRecord({
            kind: 'file',
            file,
            buffer,
            name: file.name,
            size: file.size,
          });
        } catch (err: any) {
          showToast(`读取文件失败: ${file.name} - ${err.message || String(err)}`, 'error');
        }
      }
    },
    [addSourceRecord, showToast]
  );

  // Handle URL import
  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = urlInput.trim();
      if (!trimmed) return;

      const urlName = trimmed.split('/').pop()?.split('?')[0] || 'remote-model';
      addSourceRecord({
        kind: 'url',
        url: trimmed,
        name: urlName,
      });
      setUrlInput('');
      showToast(`已加载网络模型: ${urlName}`, 'success');
    },
    [urlInput, addSourceRecord, showToast]
  );

  // Handle Clipboard Load
  const handleClipboardLoad = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed || (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('/'))) {
        showToast('剪贴板中未找到有效的 URL 地址', 'error');
        return;
      }
      setUrlInput(trimmed);
      const urlName = trimmed.split('/').pop()?.split('?')[0] || 'remote-model';
      addSourceRecord({
        kind: 'url',
        url: trimmed,
        name: urlName,
      });
      showToast(`从剪贴板载入: ${urlName}`, 'success');
    } catch (err: any) {
      showToast(`读取剪贴板失败: ${err.message || String(err)}`, 'error');
    }
  }, [addSourceRecord, showToast]);

  // Remove a file record
  const handleRemoveRecord = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setRecords((prev) => {
        const next = prev.filter((r) => r.id !== id);
        if (activeRecordId === id) {
          setActiveRecordId(next.length > 0 ? next[0].id : null);
        }
        return next;
      });
    },
    [activeRecordId]
  );

  // Copy Camera State JSON
  const handleCopyCamera = useCallback(async () => {
    if (!viewerHandlesRef.current) return;
    try {
      const state = viewerHandlesRef.current.serializeCamera();
      if (state) {
        await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
        showToast('相机状态 JSON 已复制到剪贴板', 'success');
      }
    } catch (err: any) {
      showToast(`复制相机状态失败: ${err.message}`, 'error');
    }
  }, [showToast]);

  // Paste Camera State JSON
  const handlePasteCamera = useCallback(async () => {
    if (!viewerHandlesRef.current) return;
    try {
      const text = await navigator.clipboard.readText();
      const state = JSON.parse(text);
      viewerHandlesRef.current.applyCameraState(state);
      if (typeof state.far === 'number') {
        setFarPlane(state.far);
      }
      showToast('已平滑恢复相机视角与观察点', 'success');
    } catch (err: any) {
      showToast(`粘贴相机状态失败: ${err.message || 'JSON 格式不正确'}`, 'error');
    }
  }, [showToast]);

  // Reset Camera View
  const handleResetCamera = useCallback(() => {
    if (viewerHandlesRef.current) {
      viewerHandlesRef.current.resetCamera();
      showToast('相机视角已重置至原点', 'info');
    }
  }, [showToast]);

  // Coordinate system change
  const handleCoordChange = useCallback((sys: 'opencv' | 'opengl' | 'aholo') => {
    setCoordSystem(sys);
    if (viewerHandlesRef.current) {
      viewerHandlesRef.current.applyCoordinateSystem(sys);
    }
  }, []);

  // Far plane change
  const handleFarChange = useCallback((value: number) => {
    setFarPlane(value);
    if (viewerHandlesRef.current) {
      viewerHandlesRef.current.setFarPlane(value);
    }
  }, []);

  // Quick Load Sample Model
  const handleLoadSample = useCallback(() => {
    addSourceRecord({
      kind: 'url',
      url: '/Hurstville_Museum_Gallery.sog',
      name: 'Hurstville_Museum_Gallery.sog',
      size: 1978250,
    });
    showToast('已加载官方展厅样例 (1.9MB SOG)', 'success');
  }, [addSourceRecord, showToast]);

  // Drag and drop events on root
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFilesSelected(e.dataTransfer.files);
      }
    },
    [handleFilesSelected]
  );

  // Active record resolution
  const activeRecord = records.find((r) => r.id === activeRecordId) || null;
  const activeSrc = activeRecord?.source.kind === 'url' ? activeRecord.source.url : null;
  const activeLocalData =
    activeRecord?.source.kind === 'file' && activeRecord.source.buffer
      ? { buffer: activeRecord.source.buffer, name: activeRecord.name }
      : null;

  return (
    <div
      className={`relative w-screen h-screen overflow-hidden bg-neutral-950 text-neutral-100 select-none font-sans ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* =========================================================================
          CENTRAL STAGE: WebGL2 Canvas & Overlays
          ========================================================================= */}
      <main className="absolute inset-0 z-0 w-full h-full">
        <AholoViewer
          src={activeLocalData ? null : activeSrc}
          localData={activeLocalData}
          backgroundColor={bgColor}
          coordinateSystem={coordSystem}
          useOrbit={useOrbit}
          farPlane={farPlane}
          pipelineParams={pipelineParams}
          className="w-full h-full"
          onFpsUpdate={setFps}
          onLoaded={(info) => {
            if (info.splatCount) setSplatCount(info.splatCount);
            if (activeRecordId) {
              setRecords((prev) =>
                prev.map((r) => (r.id === activeRecordId ? { ...r, status: 'ready' } : r))
              );
            }
          }}
          onError={(err) => {
            showToast(err.message, 'error');
            if (activeRecordId) {
              setRecords((prev) =>
                prev.map((r) => (r.id === activeRecordId ? { ...r, status: 'error', error: err.message } : r))
              );
            }
          }}
          onViewerReady={(handles) => {
            viewerHandlesRef.current = handles;
          }}
        />

        {/* Empty State Banner (Clean screen when no model loaded) */}
        {!activeRecord && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 pointer-events-none">
            <div className="max-w-md w-full bg-neutral-900/75 border border-neutral-800/80 backdrop-blur-xl rounded-2xl p-8 text-center shadow-2xl space-y-4 pointer-events-auto">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Box className="w-7 h-7 animate-pulse" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-wide">Aholo 3DGS Studio</h2>
                <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                  拖入 3D 高斯泼溅文件（.ply, .spz, .sog, .splat）或三维网格（.glb）即刻硬件光栅化呈现
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleLoadSample}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition active:scale-95"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>加载官方真实展厅</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 text-xs font-semibold transition active:scale-95"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>选择本地 3D 文件</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* =========================================================================
          TOP FLOATING STATUS HUD
          ========================================================================= */}
      <header className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-neutral-800/80 shadow-2xl text-xs">
        {/* Brand indicator */}
        <div className="flex items-center gap-2 font-semibold text-white tracking-wide">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Aholo Studio</span>
        </div>

        <div className="w-[1px] h-4 bg-neutral-800" />

        {/* Active file badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 border border-neutral-800 text-neutral-300 max-w-[200px] truncate">
          <FileCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="truncate">{activeRecord ? activeRecord.name : '等待载入模型...'}</span>
        </div>

        {/* Live FPS */}
        <div className="px-2.5 py-1 rounded-lg bg-black/40 border border-neutral-800 flex items-center gap-1 font-mono">
          <span className="text-neutral-400">FPS:</span>
          <strong className={fps >= 50 ? 'text-emerald-400' : fps >= 30 ? 'text-amber-400' : 'text-rose-400'}>
            {fps || '--'}
          </strong>
        </div>

        {/* Splat Count */}
        <div className="px-2.5 py-1 rounded-lg bg-black/40 border border-neutral-800 flex items-center gap-1 font-mono">
          <span className="text-neutral-400">Splats:</span>
          <strong className="text-indigo-300">{splatCount ? splatCount.toLocaleString() : '--'}</strong>
        </div>

        <div className="w-[1px] h-4 bg-neutral-800" />

        {/* Sample button */}
        <button
          type="button"
          onClick={handleLoadSample}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition"
          title="加载内置展厅样例 Hurstville Museum Gallery (1.9MB SOG)"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>Sample</span>
        </button>

        {/* BG color toggle */}
        <button
          type="button"
          onClick={() =>
            setBgColor((curr) =>
              curr === '#0a0a0f' ? '#000000' : curr === '#000000' ? '#1f1f2e' : '#0a0a0f'
            )
          }
          className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs flex items-center gap-1"
          title="切换视口背景色"
        >
          <span className="w-2.5 h-2.5 rounded-full border border-neutral-600" style={{ backgroundColor: bgColor }} />
          <span>BG</span>
        </button>
      </header>

      {/* =========================================================================
          LEFT RAIL TOGGLE BUTTON (when collapsed)
          ========================================================================= */}
      {leftCollapsed && (
        <button
          type="button"
          onClick={() => toggleLeftRail(false)}
          className="absolute left-3 top-3 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 shadow-xl backdrop-blur-md text-xs font-medium transition active:scale-95"
          title="展开资产与相机面板"
        >
          <Upload className="w-3.5 h-3.5 text-indigo-400" />
          <span>导入与相机</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}

      {/* =========================================================================
          RIGHT RAIL TOGGLE BUTTON (when collapsed)
          ========================================================================= */}
      {rightCollapsed && (
        <button
          type="button"
          onClick={() => toggleRightRail(false)}
          className="absolute right-3 top-3 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 shadow-xl backdrop-blur-md text-xs font-medium transition active:scale-95"
          title="展开渲染设置面板"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <Sliders className="w-3.5 h-3.5 text-indigo-400" />
          <span>渲染参数</span>
        </button>
      )}

      {/* =========================================================================
          LEFT RAIL: 资产导入区 / 导入文件列表 / 相机操作台
          ========================================================================= */}
      <aside
        className={`absolute left-3 top-3 bottom-3 z-30 w-80 bg-neutral-900/95 backdrop-blur-xl border border-neutral-800/90 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-transform duration-300 ease-out ${
          leftCollapsed ? '-translate-x-[calc(100%+16px)] pointer-events-none' : 'translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="h-12 px-4 border-b border-neutral-800/80 flex items-center justify-between shrink-0 bg-neutral-900/60">
          <div className="flex items-center gap-2 font-semibold text-sm text-white">
            <Layers className="w-4 h-4 text-indigo-400" />
            <span>资产与相机工作台</span>
          </div>
          <button
            type="button"
            onClick={() => toggleLeftRail(true)}
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
            title="收起左侧面板"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable container */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs scrollbar-thin scrollbar-thumb-neutral-700">
          {/* SECTION 1: 资产导入区 */}
          <section className="space-y-2.5">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-neutral-400">
              资产导入 (Asset Ingestion)
            </div>

            {/* Local File Picker Button */}
            <label className="group flex flex-col items-center justify-center p-3.5 rounded-xl border border-dashed border-neutral-700 hover:border-indigo-500 bg-neutral-950/40 hover:bg-indigo-950/20 cursor-pointer transition text-center">
              <Upload className="w-5 h-5 text-indigo-400 mb-1 group-hover:scale-110 transition-transform" />
              <span className="font-semibold text-white">选择本地文件导入</span>
              <span className="text-[10px] text-neutral-400 mt-0.5">
                支持 .ply, .spz, .splat, .ksplat, .sog, .glb, .zip
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".ply,.spz,.splat,.ksplat,.zip,.sog,.esz,.json,.glb,.gltf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFilesSelected(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>

            {/* URL & Clipboard Ingestion */}
            <form onSubmit={handleUrlSubmit} className="space-y-2">
              <textarea
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="粘贴 https://... 3DGS 或模型链接"
                rows={2}
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-neutral-800 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-indigo-500 transition resize-none font-mono"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleClipboardLoad}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium transition active:scale-95"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>剪贴板加载</span>
                </button>
                <button
                  type="submit"
                  disabled={!urlInput.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none text-white font-medium shadow-md shadow-indigo-600/20 transition active:scale-95"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>加载 URL</span>
                </button>
              </div>
            </form>
          </section>

          {/* SECTION 2: 已导入文件管理列表 */}
          <section className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider uppercase text-neutral-400">
              <span>已导入文件 ({records.length})</span>
              {records.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setRecords([]);
                    setActiveRecordId(null);
                    setSplatCount(null);
                  }}
                  className="text-neutral-500 hover:text-rose-400 text-[10px] transition"
                >
                  清空全部
                </button>
              )}
            </div>

            {records.length === 0 ? (
              <div className="p-4 rounded-xl border border-neutral-800/80 bg-neutral-950/30 text-center text-neutral-500 text-xs">
                <span>尚未导入任何 3D 文件</span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {records.map((rec) => {
                  const isActive = rec.id === activeRecordId;
                  return (
                    <div
                      key={rec.id}
                      onClick={() => {
                        setActiveRecordId(rec.id);
                        setSplatCount(null);
                      }}
                      className={`group relative p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between gap-2 ${
                        isActive
                          ? 'bg-indigo-950/40 border-indigo-500/60 shadow-md shadow-indigo-950/50'
                          : 'bg-neutral-950/40 border-neutral-800/70 hover:border-neutral-700 hover:bg-neutral-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Format Badge */}
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                            rec.format === 'SOG'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : rec.format === 'PLY'
                              ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                              : rec.format === 'GLB' || rec.format === 'GLTF'
                              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {rec.format}
                        </span>

                        <div className="min-w-0">
                          <div className={`font-medium truncate ${isActive ? 'text-white' : 'text-neutral-300'}`}>
                            {rec.name}
                          </div>
                          <div className="text-[10px] text-neutral-500">{rec.size}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {rec.status === 'ready' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                        {rec.status === 'error' && (
                          <span title={rec.error}>
                            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => handleRemoveRecord(e, rec.id)}
                          className="p-1 rounded text-neutral-500 hover:text-rose-400 hover:bg-neutral-800 transition"
                          title="移除此模型"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECTION 3: 相机操作台 */}
          <section className="space-y-3 pt-2 border-t border-neutral-800/80">
            <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider uppercase text-neutral-400">
              <span>相机操作台 (Camera Desk)</span>
              {/* Orbit Mode Switch */}
              <label className="flex items-center gap-1.5 cursor-pointer">
                <span className="text-[10px] text-neutral-400">{useOrbit ? '环绕 (Orbit)' : '漫游 (WASD)'}</span>
                <input
                  type="checkbox"
                  checked={useOrbit}
                  onChange={(e) => setUseOrbit(e.target.checked)}
                  className="sr-only"
                />
                <span
                  className={`w-7 h-4 flex items-center rounded-full p-0.5 transition-colors ${
                    useOrbit ? 'bg-indigo-600' : 'bg-neutral-700'
                  }`}
                >
                  <span
                    className={`bg-white w-3 h-3 rounded-full shadow-md transform transition-transform ${
                      useOrbit ? 'translate-x-3' : 'translate-x-0'
                    }`}
                  />
                </span>
              </label>
            </div>

            {/* Coordinate System Selector */}
            <div className="space-y-1">
              <label className="text-[11px] text-neutral-400">坐标系基准 (Coordinate System):</label>
              <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl border border-neutral-800">
                {(['opencv', 'opengl', 'aholo'] as const).map((cs) => (
                  <button
                    key={cs}
                    type="button"
                    onClick={() => handleCoordChange(cs)}
                    className={`py-1 text-center rounded-lg text-xs font-semibold uppercase transition ${
                      coordSystem === cs
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {cs}
                  </button>
                ))}
              </div>
            </div>

            {/* Far Plane Input */}
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-neutral-400">远裁剪面 (Far Plane):</label>
              <input
                type="number"
                min={100}
                max={10000}
                step={100}
                value={farPlane}
                onChange={(e) => handleFarChange(Number(e.target.value) || 2000)}
                className="w-24 px-2.5 py-1 rounded-lg bg-black/50 border border-neutral-800 text-right text-xs font-mono text-neutral-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Camera Actions: Copy / Paste / Reset */}
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              <button
                type="button"
                onClick={handleCopyCamera}
                className="flex items-center justify-center gap-1 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition active:scale-95"
                title="将当前相机的 position, rotation, up 序列化为 JSON 写入剪贴板"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>复制状态</span>
              </button>
              <button
                type="button"
                onClick={handlePasteCamera}
                className="flex items-center justify-center gap-1 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition active:scale-95"
                title="从剪贴板读取相机 JSON 恢复视角"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>粘贴状态</span>
              </button>
              <button
                type="button"
                onClick={handleResetCamera}
                className="flex items-center justify-center gap-1 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition active:scale-95"
                title="重置到默认视角"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重置视角</span>
              </button>
            </div>
          </section>
        </div>
      </aside>

      {/* =========================================================================
          RIGHT RAIL: 渲染预设选择器 & 核心参数微调
          ========================================================================= */}
      <aside
        className={`absolute right-3 top-3 bottom-3 z-30 w-84 bg-neutral-900/95 backdrop-blur-xl border border-neutral-800/90 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-transform duration-300 ease-out ${
          rightCollapsed ? 'translate-x-[calc(100%+16px)] pointer-events-none' : 'translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="h-12 px-4 border-b border-neutral-800/80 flex items-center justify-between shrink-0 bg-neutral-900/60">
          <div className="flex items-center gap-2 font-semibold text-sm text-white">
            <Sliders className="w-4 h-4 text-indigo-400" />
            <span>渲染参数微调 (Pipeline)</span>
          </div>
          <button
            type="button"
            onClick={() => toggleRightRail(true)}
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
            title="收起右侧面板"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable container */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs scrollbar-thin scrollbar-thumb-neutral-700">
          {/* 1. 渲染预设选择器 */}
          <section className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider uppercase text-neutral-400">
              <span>渲染预设 (Presets)</span>
              <span className="text-[10px] text-indigo-400">
                {VIEWER_SPLATTING_PRESETS[pipelineParams.splattingPreset]?.nameZh || '自定义'}
              </span>
            </div>

            <select
              value={pipelineParams.splattingPreset}
              onChange={(e) => handleSelectPreset(e.target.value as SplattingPresetId)}
              className="w-full px-3 py-2 rounded-xl bg-black/60 border border-neutral-700 text-xs text-white focus:outline-none focus:border-indigo-500 font-medium"
            >
              {(Object.keys(VIEWER_SPLATTING_PRESETS) as SplattingPresetId[]).map((presetId) => (
                <option key={presetId} value={presetId} className="bg-neutral-900 text-white">
                  {VIEWER_SPLATTING_PRESETS[presetId].nameZh} - {VIEWER_SPLATTING_PRESETS[presetId].nameEn}
                </option>
              ))}
            </select>

            <div className="p-2.5 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-[10px] text-indigo-300 leading-relaxed">
              💡 {VIEWER_SPLATTING_PRESETS[pipelineParams.splattingPreset]?.descZh}
              <div className="text-neutral-400 mt-0.5">
                预设会影响初始 Pack type，建议在导入大模型前选择。
              </div>
            </div>
          </section>

          {/* 2. 视口与像素比 (Display & Pixel Ratio) */}
          <div className="p-3 rounded-xl bg-black/40 border border-neutral-800 space-y-2.5">
            <div className="flex items-center justify-between text-neutral-300 font-medium">
              <span>像素采样比 (Pixel Ratio)</span>
              <span className="font-mono text-indigo-300">{pipelineParams.pixelRatio.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.1}
              value={pipelineParams.pixelRatio}
              onChange={(e) => handleParamChange('pixelRatio', Number(e.target.value))}
              className="w-full accent-indigo-500 h-1.5 bg-neutral-800 rounded-lg"
            />
          </div>

          {/* 3. 打包设置 (Pack Folder) */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenFolders((prev) => ({ ...prev, pack: !prev.pack }))}
              className="w-full px-3.5 py-2.5 flex items-center justify-between text-neutral-200 font-medium hover:bg-neutral-800/40 transition"
            >
              <div className="flex items-center gap-2">
                <Box className="w-3.5 h-3.5 text-indigo-400" />
                <span>数据打包 (Pack)</span>
              </div>
              <ChevronDown
                className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${openFolders.pack ? 'rotate-180' : ''}`}
              />
            </button>

            {openFolders.pack && (
              <div className="p-3 border-t border-neutral-800/80 space-y-2.5 bg-black/20">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Pack Type (导入生效):</span>
                  <select
                    value={pipelineParams.splatPackType}
                    onChange={(e) => handleParamChange('splatPackType', Number(e.target.value))}
                    className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700 text-xs text-white"
                  >
                    <option value={SplatLoader.SplatPackType.Compressed}>Compressed</option>
                    <option value={SplatLoader.SplatPackType.SuperCompressed}>SuperCompressed</option>
                    <option value={SplatLoader.SplatPackType.Sog}>Sog (Native)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Max SH 阶数:</span>
                  <select
                    value={pipelineParams.maxSh}
                    onChange={(e) => handleParamChange('maxSh', Number(e.target.value))}
                    className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700 text-xs text-white"
                  >
                    <option value={0}>0 (仅漫反射 / SOG)</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3 (全阶球谐光泽)</option>
                  </select>
                </div>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-neutral-400">SH 球谐预计算 (Precalculate):</span>
                  <input
                    type="checkbox"
                    checked={pipelineParams.precalculateEnabled}
                    onChange={(e) => handleParamChange('precalculateEnabled', e.target.checked)}
                    className="accent-indigo-500 rounded"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-neutral-400">高精度打包 (High Precision):</span>
                  <input
                    type="checkbox"
                    checked={pipelineParams.packHighPrecisionEnabled}
                    onChange={(e) => handleParamChange('packHighPrecisionEnabled', e.target.checked)}
                    className="accent-indigo-500 rounded"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-neutral-400">相机相对坐标 (Camera Relative):</span>
                  <input
                    type="checkbox"
                    checked={pipelineParams.cameraRelativeEnabled}
                    onChange={(e) => handleParamChange('cameraRelativeEnabled', e.target.checked)}
                    className="accent-indigo-500 rounded"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-neutral-400">预排序布局 (Sorted Layout):</span>
                  <input
                    type="checkbox"
                    checked={pipelineParams.sortedLayoutEnabled}
                    onChange={(e) => handleParamChange('sortedLayoutEnabled', e.target.checked)}
                    className="accent-indigo-500 rounded"
                  />
                </label>
              </div>
            )}
          </div>

          {/* 4. 光栅化设置 (Raster Folder) */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenFolders((prev) => ({ ...prev, raster: !prev.raster }))}
              className="w-full px-3.5 py-2.5 flex items-center justify-between text-neutral-200 font-medium hover:bg-neutral-800/40 transition"
            >
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-indigo-400" />
                <span>光栅化渲染 (Raster)</span>
              </div>
              <ChevronDown
                className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${openFolders.raster ? 'rotate-180' : ''}`}
              />
            </button>

            {openFolders.raster && (
              <div className="p-3 border-t border-neutral-800/80 space-y-3 bg-black/20">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-neutral-400">归一化衰减 (Normalized Falloff):</span>
                  <input
                    type="checkbox"
                    checked={pipelineParams.normalizedFalloff}
                    onChange={(e) => handleParamChange('normalizedFalloff', e.target.checked)}
                    className="accent-indigo-500 rounded"
                  />
                </label>

                <div className="space-y-1">
                  <div className="flex justify-between text-neutral-400">
                    <span>焦距微调 (Focal Adjustment)</span>
                    <span className="font-mono text-neutral-200">{pipelineParams.focalAdjustment.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={pipelineParams.focalAdjustment}
                    onChange={(e) => handleParamChange('focalAdjustment', Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5 bg-neutral-800 rounded"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-neutral-400">
                    <span>细节剔除阈值 (Detail Culling)</span>
                    <span className="font-mono text-neutral-200">{pipelineParams.detailCullingThreshold}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={8}
                    step={1}
                    value={pipelineParams.detailCullingThreshold}
                    onChange={(e) => handleParamChange('detailCullingThreshold', Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5 bg-neutral-800 rounded"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-neutral-400">
                    <span>预模糊量 (Pre Blur)</span>
                    <span className="font-mono text-neutral-200">{pipelineParams.preBlurAmount.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.0}
                    max={1.0}
                    step={0.1}
                    value={pipelineParams.preBlurAmount}
                    onChange={(e) => handleParamChange('preBlurAmount', Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5 bg-neutral-800 rounded"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-neutral-400">
                    <span>最大像素半径 (Max Pixel Radius)</span>
                    <span className="font-mono text-neutral-200">{pipelineParams.maxPixelRadius}</span>
                  </div>
                  <input
                    type="range"
                    min={64}
                    max={1024}
                    step={64}
                    value={pipelineParams.maxPixelRadius}
                    onChange={(e) => handleParamChange('maxPixelRadius', Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5 bg-neutral-800 rounded"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 5. 深度排序设置 (Sort Folder) */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenFolders((prev) => ({ ...prev, sort: !prev.sort }))}
              className="w-full px-3.5 py-2.5 flex items-center justify-between text-neutral-200 font-medium hover:bg-neutral-800/40 transition"
            >
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span>视锥深度排序 (Worker Sort)</span>
              </div>
              <ChevronDown
                className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${openFolders.sort ? 'rotate-180' : ''}`}
              />
            </button>

            {openFolders.sort && (
              <div className="p-3 border-t border-neutral-800/80 space-y-3 bg-black/20">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-neutral-400">高精度距离计算 (Sort Precision):</span>
                  <input
                    type="checkbox"
                    checked={pipelineParams.sortHighPrecisionEnabled}
                    onChange={(e) => handleParamChange('sortHighPrecisionEnabled', e.target.checked)}
                    className="accent-indigo-500 rounded"
                  />
                </label>

                <div className="space-y-1">
                  <div className="flex justify-between text-neutral-400">
                    <span>最小重排间隔 (Min Interval)</span>
                    <span className="font-mono text-neutral-200">{pipelineParams.minIntervalMs} ms</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={160}
                    step={16}
                    value={pipelineParams.minIntervalMs}
                    onChange={(e) => handleParamChange('minIntervalMs', Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5 bg-neutral-800 rounded"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-neutral-400">
                    <span>点位移动阈值 (Splat Distance)</span>
                    <span className="font-mono text-neutral-200">{pipelineParams.sortSplatDistance}</span>
                  </div>
                  <input
                    type="range"
                    min={0.01}
                    max={1.0}
                    step={0.05}
                    value={pipelineParams.sortSplatDistance}
                    onChange={(e) => handleParamChange('sortSplatDistance', Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5 bg-neutral-800 rounded"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 6. 色调映射 (Tone Mapping) */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenFolders((prev) => ({ ...prev, toneMapping: !prev.toneMapping }))}
              className="w-full px-3.5 py-2.5 flex items-center justify-between text-neutral-200 font-medium hover:bg-neutral-800/40 transition"
            >
              <div className="flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-indigo-400" />
                <span>色调映射 (Tone Mapping)</span>
              </div>
              <ChevronDown
                className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${openFolders.toneMapping ? 'rotate-180' : ''}`}
              />
            </button>

            {openFolders.toneMapping && (
              <div className="p-3 border-t border-neutral-800/80 space-y-3 bg-black/20">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-neutral-400">开启色调映射:</span>
                  <input
                    type="checkbox"
                    checked={pipelineParams.toneMappingEnabled}
                    onChange={(e) => handleParamChange('toneMappingEnabled', e.target.checked)}
                    className="accent-indigo-500 rounded"
                  />
                </label>

                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">色调映射算法 (Curve):</span>
                  <select
                    value={pipelineParams.toneMapping}
                    onChange={(e) => handleParamChange('toneMapping', Number(e.target.value))}
                    className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700 text-xs text-white"
                  >
                    <option value={ToneMapping.Neutral}>Neutral</option>
                    <option value={ToneMapping.ACES}>ACES</option>
                    <option value={ToneMapping.ACESFilmic}>ACES Filmic</option>
                    <option value={ToneMapping.Reinhard}>Reinhard</option>
                    <option value={ToneMapping.Linear}>Linear</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-neutral-400">
                    <span>曝光度 (Exposure)</span>
                    <span className="font-mono text-neutral-200">{pipelineParams.exposure.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={4.0}
                    step={0.1}
                    value={pipelineParams.exposure}
                    onChange={(e) => handleParamChange('exposure', Number(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5 bg-neutral-800 rounded"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* =========================================================================
          DRAG AND DROP OVERLAY
          ========================================================================= */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-indigo-950/80 backdrop-blur-md border-4 border-dashed border-indigo-500 flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-150">
          <Upload className="w-16 h-16 text-indigo-400 mb-3 animate-bounce" />
          <h2 className="text-2xl font-bold text-white mb-1">释放文件以导入项目</h2>
          <p className="text-sm text-indigo-200">
            支持 3DGS 文件（.ply, .spz, .splat, .sog, .esz）及 LCC / LCC2 ZIP 压缩包
          </p>
        </div>
      )}

      {/* =========================================================================
          TOAST FEEDBACK
          ========================================================================= */}
      {toastMessage && (
        <div
          className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md border text-xs font-medium flex items-center gap-2 animate-in slide-in-from-bottom-2 duration-200 ${
            toastMessage.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
              : toastMessage.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : 'bg-neutral-900/90 border-neutral-700/80 text-neutral-200'
          }`}
        >
          {toastMessage.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
          {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toastMessage.type === 'info' && <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />}
          <span>{toastMessage.text}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="ml-2 text-neutral-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default AholoViewerWorkspace;
