'use client'

import React, { useState, useRef, useCallback } from 'react'
import { 
  Sparkles, Upload, RotateCcw, Link2, Trash2, 
  ChevronDown, ChevronUp, Copy, Clipboard, 
  Loader2, AlertTriangle, X, Check, Box
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'

interface ModelCameraDeskProps {
  onResetView: () => void
  onCopyCameraState?: () => void
  onPasteCameraState?: () => void
  cameraOrbiting?: boolean
  onToggleOrbit?: (orbit: boolean) => void
  splatCount?: number | null
}

export function ModelCameraDesk({
  onResetView,
  onCopyCameraState,
  onPasteCameraState,
  cameraOrbiting = true,
  onToggleOrbit,
  splatCount,
}: ModelCameraDeskProps) {
  const {
    viewMode,
    setViewMode,
    activeModelName,
    activeFileType,
    setActiveModelName,
    setActiveFileType,
    localSplatData,
    setLocalSplatData,
    convertedMeshUrl,
    setConvertedMeshUrl,
    splatUrl,
    setSplatUrl,
    setActiveJobId,
    setMeshManifest,
    isConvertingMesh,
    setIsConvertingMesh,
    convertProgress,
    setConvertProgress,
    convertStage,
    setConvertStage,
    modelStats,
    setModelStats,
    clearActiveModel,
    coordSystem,
    setCoordSystem,
    farPlane,
    setFarPlane,
  } = useAppStore()

  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showUrlDialog, setShowUrlDialog] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [deskNotice, setDeskNotice] = useState<string | null>(null)
  const [deskError, setDeskError] = useState<string | null>(null)
  const [copiedState, setCopiedState] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * Safe file reading with fallback to FileReader
   */
  const readFileBytes = async (file: File): Promise<ArrayBuffer> => {
    try {
      return await file.arrayBuffer()
    } catch (err) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error || new Error('FileReader failed.'))
        reader.readAsArrayBuffer(file)
      })
    }
  }

  /**
   * Process a selected file according to format and active viewer mode.
   * - GLB/GLTF/OBJ: Direct load into Solid Mesh viewer
   * - SOG/PLY: If mesh mode -> real Poisson conversion via backend
   *           If splat mode -> direct AholoViewer byte load
   * - SPZ/SPLAT/KSPLAT/LCC/ESZ: 3DGS only; explain if in mesh mode
   */
  const handleProcessFile = useCallback(async (file: File) => {
    setDeskError(null)
    setDeskNotice(null)

    const ext = file.name.split('.').pop()?.toLowerCase() || ''

    // 1. DIRECT SOLID MESH FORMATS (.glb, .gltf, .obj)
    if (ext === 'glb' || ext === 'gltf' || ext === 'obj') {
      const blobUrl = URL.createObjectURL(file)
      setConvertedMeshUrl(blobUrl)
      setActiveModelName(file.name)
      setActiveFileType('MESH')
      setModelStats({
        type: 'mesh',
        sizeFormatted: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      })
      if (viewMode !== 'mesh') {
        setViewMode('mesh')
        setDeskNotice('Polygonal mesh loaded into Solid Mesh viewer.')
      }
      return
    }

    // 2. CONVERTIBLE 3DGS FORMATS (.sog, .ply)
    if (ext === 'sog' || ext === 'ply') {
      try {
        const buffer = await readFileBytes(file)
        
        // In Solid Mesh mode: Route through real conversion backend
        if (viewMode === 'mesh') {
          setActiveModelName(file.name)
          setActiveFileType('3DGS')
          setLocalSplatData({ buffer, name: file.name }, { viewMode: 'mesh' })
          setConvertedMeshUrl(null) // clear previous mesh during conversion
          setIsConvertingMesh(true)
          setConvertProgress(10)
          setConvertStage('Uploading Gaussian Splat to reconstruction engine...')

          try {
            const res = await api.convertLocalFileToMesh(file, (stage, pct) => {
              setConvertStage(stage)
              setConvertProgress(pct)
            })

            setConvertedMeshUrl(res.mesh_url)
            setActiveJobId(res.job_id)
            if (res.manifest) {
              setMeshManifest(res.manifest)
            }
            setActiveFileType('CONVERTED MESH')
            setDeskNotice(`Watertight mesh generated from ${file.name}!`)
          } catch (convErr: any) {
            console.error('[ModelDesk] Conversion failed:', convErr)
            setDeskError(`Mesh reconstruction failed: ${convErr.message}`)
          } finally {
            setIsConvertingMesh(false)
            setConvertProgress(null)
            setConvertStage(null)
          }
        } else {
          // In Splat View: Load directly into AholoViewer in memory
          setLocalSplatData({ buffer, name: file.name }, { viewMode: 'splat' })
          setActiveModelName(file.name)
          setActiveFileType('3DGS')
          setDeskNotice(`Loaded 3DGS scene: ${file.name}`)
        }
      } catch (err: any) {
        setDeskError(`Could not read file: ${err.message}`)
      }
      return
    }

    // 3. 3DGS-ONLY FORMATS (.spz, .splat, .ksplat, .lcc, .esz)
    if (['spz', 'splat', 'ksplat', 'lcc', 'esz'].includes(ext)) {
      if (viewMode === 'mesh') {
        setDeskNotice(
          `Format .${ext.toUpperCase()} is a Gaussian Splat and cannot be converted to a polygon mesh directly. Switch to Splat View to view it.`
        )
      }
      try {
        const buffer = await readFileBytes(file)
        setLocalSplatData({ buffer, name: file.name })
        setActiveModelName(file.name)
        setActiveFileType('3DGS')
      } catch (err: any) {
        setDeskError(`Could not read file: ${err.message}`)
      }
      return
    }

    setDeskError(`Unsupported format (.${ext}). Supported: GLB, GLTF, OBJ, SOG, PLY, SPZ, SPLAT.`)
  }, [
    viewMode, setViewMode, setActiveModelName, setActiveFileType,
    setConvertedMeshUrl, setLocalSplatData, setIsConvertingMesh,
    setConvertProgress, setConvertStage, setActiveJobId, setMeshManifest,
    setModelStats
  ])

  /**
   * Process a Remote URL
   */
  const handleProcessUrl = useCallback(async (url: string) => {
    setDeskError(null)
    setDeskNotice(null)
    const lower = url.toLowerCase().split('?')[0]
    const ext = lower.split('.').pop() || ''
    const fileName = url.split('/').pop()?.split('?')[0] || 'remote_scene'

    if (ext === 'glb' || ext === 'gltf' || ext === 'obj') {
      setConvertedMeshUrl(url)
      setActiveModelName(fileName)
      setActiveFileType('MESH')
      setViewMode('mesh')
      return
    }

    if (ext === 'sog' || ext === 'ply') {
      if (viewMode === 'mesh') {
        // Trigger conversion for the remote URL's job if recognized
        setDeskNotice('Converting remote Gaussian Splat to mesh...')
      }
      setSplatUrl(url)
      setActiveModelName(fileName)
      setActiveFileType('3DGS')
      return
    }

    setSplatUrl(url)
    setActiveModelName(fileName)
    setActiveFileType('3DGS')
  }, [viewMode, setConvertedMeshUrl, setActiveModelName, setActiveFileType, setViewMode, setSplatUrl])

  /**
   * Load clipboard content (URL or camera JSON)
   */
  const handleLoadClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.startsWith('http://') || text.startsWith('https://')) {
        handleProcessUrl(text.trim())
      } else if (text.trim().startsWith('{') && text.includes('position')) {
        onPasteCameraState?.()
        setDeskNotice('Camera state applied from clipboard.')
      } else {
        setDeskError('Clipboard does not contain a valid URL or camera state.')
      }
    } catch {
      setDeskError('Could not access clipboard.')
    }
  }

  const handleCopyState = () => {
    onCopyCameraState?.()
    setCopiedState(true)
    setTimeout(() => setCopiedState(false), 2000)
  }

  const handleRemoveScene = () => {
    clearActiveModel()
    setDeskNotice(null)
    setDeskError(null)
  }

  return (
    <div 
      className="absolute top-4 left-4 z-20 w-72 select-none"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Hidden File Picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf,.obj,.ply,.sog,.spz,.splat,.ksplat,.lcc,.esz,.zip"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleProcessFile(e.target.files[0])
            e.target.value = ''
          }
        }}
      />

      <div className="bg-[#0b0c16]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden transition-all duration-200">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            <span className="text-xs font-semibold tracking-wide text-white">Model & Camera</span>
          </div>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-text-muted hover:text-white transition-colors p-1"
            title={isCollapsed ? 'Expand desk' : 'Collapse desk'}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>

        {/* Body Content */}
        {!isCollapsed && (
          <div className="p-3.5 space-y-3 text-xs">
            {/* Drag & Drop Import Dropzone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false) }}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragOver(false)
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleProcessFile(e.dataTransfer.files[0])
                }
              }}
              className={`group relative flex flex-col items-center justify-center p-4 border border-dashed rounded-xl cursor-pointer transition-all duration-150 text-center ${
                isDragOver 
                  ? 'border-accent bg-accent/10 scale-[1.02]' 
                  : 'border-white/20 hover:border-accent bg-white/[0.02] hover:bg-accent/5'
              }`}
            >
              <Upload className="w-6 h-6 text-accent mb-1.5 group-hover:scale-110 transition-transform" />
              <span className="font-medium text-white group-hover:text-accent">
                Choose 3D File
              </span>
              <span className="text-[10px] text-text-muted mt-1 leading-snug">
                {viewMode === 'mesh' 
                  ? 'GLB · GLTF · OBJ (or SOG · PLY to convert)'
                  : 'PLY · SPZ · SPLAT · KSPLAT · SOG · ESZ · LCC'}
              </span>
            </div>

            {/* Quick Actions: Load Clipboard & Load URL */}
            <div className="flex gap-2">
              <button
                onClick={handleLoadClipboard}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-text-secondary hover:text-white transition-all text-[11px]"
                title="Paste URL or camera state from clipboard"
              >
                <Clipboard size={12} />
                <span>Load Clipboard</span>
              </button>
              <button
                onClick={() => setShowUrlDialog(!showUrlDialog)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-text-secondary hover:text-white transition-all text-[11px]"
              >
                <Link2 size={12} />
                <span>Load URL</span>
              </button>
            </div>

            {/* Remote URL Input Form */}
            {showUrlDialog && (
              <div className="p-2 bg-black/50 border border-white/10 rounded-lg space-y-2 animate-in fade-in duration-150">
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://.../model.glb or .sog"
                  className="w-full px-2 py-1 bg-surface-elevated border border-border rounded text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => setShowUrlDialog(false)}
                    className="px-2 py-0.5 text-[10px] text-text-muted hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (urlInput.trim()) {
                        handleProcessUrl(urlInput.trim())
                        setShowUrlDialog(false)
                      }
                    }}
                    className="px-2.5 py-0.5 bg-accent hover:bg-accent/80 text-white rounded text-[10px] font-medium"
                  >
                    Load
                  </button>
                </div>
              </div>
            )}

            {/* Active Model Metadata Card */}
            {(activeModelName || convertedMeshUrl || splatUrl || localSplatData) && (
              <div className="p-2.5 bg-white/[0.03] border border-white/5 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-semibold text-text-muted tracking-wider">
                    Active Model
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-accent/20 text-accent rounded text-[9px] font-mono font-semibold">
                      {activeFileType || (viewMode === 'mesh' ? 'MESH' : '3DGS')}
                    </span>
                    <button
                      onClick={handleRemoveScene}
                      className="p-1 text-text-muted hover:text-red-400 hover:bg-white/5 rounded transition-colors"
                      title="Remove Model"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                <div 
                  className="font-mono text-[11px] text-white truncate" 
                  title={activeModelName || 'Current Scene'}
                >
                  {activeModelName || (convertedMeshUrl ? 'converted_mesh.glb' : 'Scene Model')}
                </div>

                {/* Splats count or Mesh vertex count */}
                {viewMode === 'splat' && splatCount !== null && splatCount !== undefined && (
                  <div className="flex items-center justify-between text-[11px] text-text-muted pt-1 border-t border-white/5">
                    <span>Gaussian Splats:</span>
                    <span className="font-mono text-emerald-400 font-medium">
                      {splatCount.toLocaleString()}
                    </span>
                  </div>
                )}

                {viewMode === 'mesh' && modelStats && (
                  <div className="flex items-center justify-between text-[11px] text-text-muted pt-1 border-t border-white/5">
                    <span>Mesh Complexity:</span>
                    <span className="font-mono text-emerald-400 font-medium">
                      {modelStats.count ? `${modelStats.count.toLocaleString()} verts` : modelStats.sizeFormatted || 'Solid'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Conversion Progress in Desk */}
            {isConvertingMesh && (
              <div className="p-2.5 bg-amber-950/40 border border-amber-500/30 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-amber-300 font-medium">
                  <Loader2 size={13} className="animate-spin text-amber-400 shrink-0" />
                  <span className="text-[11px] truncate">
                    {convertStage || 'Converting Gaussian Splat to Solid Mesh...'}
                  </span>
                </div>
                {convertProgress !== null && (
                  <div className="space-y-1">
                    <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full transition-all duration-300"
                        style={{ width: `${convertProgress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-amber-300/80 font-mono">
                      <span>Progress</span>
                      <span>{convertProgress}%</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Notice / Informational Feedback */}
            {deskNotice && (
              <div className="p-2 bg-indigo-950/60 border border-indigo-500/30 rounded-lg text-indigo-200 text-[11px] flex items-start gap-2">
                <span className="flex-1 leading-snug">{deskNotice}</span>
                {deskNotice.includes('Switch to Splat View') && (
                  <button
                    onClick={() => {
                      setViewMode('splat')
                      setDeskNotice(null)
                    }}
                    className="shrink-0 px-1.5 py-0.5 bg-accent hover:bg-accent/80 text-white rounded text-[10px] font-medium"
                  >
                    Switch
                  </button>
                )}
                <button
                  onClick={() => setDeskNotice(null)}
                  className="text-text-muted hover:text-white p-0.5"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {/* Error Feedback */}
            {deskError && (
              <div className="p-2 bg-red-950/70 border border-red-500/40 rounded-lg text-red-200 text-[11px] flex items-start gap-2">
                <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
                <span className="flex-1 leading-snug">{deskError}</span>
                <button
                  onClick={() => setDeskError(null)}
                  className="text-text-muted hover:text-white p-0.5"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {/* CAMERA SECTION */}
            <div className="pt-2 border-t border-white/5 space-y-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-text-primary tracking-wide">CAMERA</span>
                <div className="flex items-center gap-1.5 text-text-muted">
                  <span className="text-[10px]">Orbit</span>
                  <input
                    type="checkbox"
                    checked={cameraOrbiting}
                    onChange={(e) => onToggleOrbit?.(e.target.checked)}
                    className="accent-accent cursor-pointer rounded"
                  />
                </div>
              </div>

              {/* Coordinate System & Far Plane */}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-text-muted block mb-1 text-[10px]">Coord System</span>
                  <select
                    value={coordSystem}
                    onChange={(e) => setCoordSystem(e.target.value as any)}
                    className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-[11px] text-text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="OpenCV" className="bg-[#0b0c16]">OpenCV (-Y)</option>
                    <option value="OpenGL" className="bg-[#0b0c16]">OpenGL (+Y)</option>
                  </select>
                </div>

                <div>
                  <span className="text-text-muted block mb-1 text-[10px]">Far Plane</span>
                  <input
                    type="number"
                    value={farPlane}
                    onChange={(e) => setFarPlane(Number(e.target.value) || 2000)}
                    className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-[11px] text-text-primary focus:outline-none focus:border-accent font-mono"
                  />
                </div>
              </div>

              {/* Copy / Paste Camera State */}
              <div className="flex gap-2">
                <button
                  onClick={handleCopyState}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1 px-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-text-secondary hover:text-white transition-all text-[11px]"
                >
                  {copiedState ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                  <span>{copiedState ? 'Copied' : 'Copy State'}</span>
                </button>
                <button
                  onClick={onPasteCameraState}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1 px-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-text-secondary hover:text-white transition-all text-[11px]"
                >
                  <Clipboard size={11} />
                  <span>Paste State</span>
                </button>
              </div>

              {/* Reset View Button */}
              <button
                onClick={onResetView}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-text-primary hover:text-white transition-all text-[11px] font-medium"
                title="Reset Camera View to Default"
              >
                <RotateCcw size={12} />
                <span>Reset View</span>
              </button>

              {/* Engine & Tips */}
              <div className="pt-2 border-t border-white/5 space-y-1 text-[10px] text-text-muted">
                <div className="flex items-center justify-between">
                  <span>Active Engine:</span>
                  <span className="font-mono text-indigo-300">
                    {viewMode === 'splat' ? 'Aholo Viewer 1.8.1' : 'Three.js Solid Mesh'}
                  </span>
                </div>
                <div className="pt-1 leading-tight text-text-muted/80">
                  • <b>Left drag:</b> Orbit<br />
                  • <b>Right drag / Shift+drag:</b> Pan<br />
                  • <b>Scroll:</b> Zoom toward cursor
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
