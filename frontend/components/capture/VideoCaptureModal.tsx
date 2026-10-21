'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { 
  AlertCircle, 
  Box, 
  CheckCircle2, 
  Clapperboard, 
  Cpu, 
  Film, 
  FolderOpen, 
  Layers, 
  Loader2, 
  Sparkles, 
  Upload, 
  X, 
  Zap 
} from 'lucide-react'
import { api } from '@/lib/api'
import { ReconstructionJob } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { upsertScanNode } from '@/lib/pascal/scanNodes'
import { motion, AnimatePresence } from 'framer-motion'

type ModalTab = 'video' | 'import_model' | 'library'
type ReconstructionMode = 'fast' | 'quality'

interface AvailableModel {
  job_id: string
  filename: string
  size_mb: number
  format: string
  url: string
  mesh_url?: string
  modified: number
}

const steps = ['Upload video', 'Extract keyframes', 'Estimate camera poses', 'Train Gaussian Splatting', 'Scene ready']

export function VideoCaptureModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<ModalTab>('video')
  const { splatUrl, setSplatUrl, setLocalSplatData, setActiveJobId } = useAppStore()
  const loadScanUrl = useCallback((url: string, meshUrl?: string) => {
    setSplatUrl(url)
    upsertScanNode(url, meshUrl ? { meshUrl } : undefined)
  }, [setSplatUrl])
  const loadLocalScan = (file: File) => {
    if (/\.(sog|spz|ply|splat|ksplat)$/i.test(file.name)) {
      loadScanUrl(URL.createObjectURL(file))
    }
  }

  /* ---------- Video Capture State ---------- */
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<ReconstructionJob | null>(null)
  const [videoDragging, setVideoDragging] = useState(false)
  const [reconstructMode, setReconstructMode] = useState<ReconstructionMode>('fast')
  const [videoError, setVideoError] = useState('')

  /* ---------- 3D Model Import State ---------- */
  const modelInputRef = useRef<HTMLInputElement>(null)
  const [modelFile, setModelFile] = useState<File | null>(null)
  const [modelDragging, setModelDragging] = useState(false)
  const [modelError, setModelError] = useState('')
  const [isUploadingModel, setIsUploadingModel] = useState(false)

  /* ---------- Scene Library State ---------- */
  const [modelsList, setModelsList] = useState<AvailableModel[]>([])
  // null until the library tab has fetched once; derived loading state avoids setState in the effect
  const [loadedModels, setLoadedModels] = useState<AvailableModel[] | null>(null)
  const isLoadingModels = activeTab === 'library' && loadedModels === null

  // Poll reconstruction job
  useEffect(() => {
    if (!job || ['completed', 'failed', 'ready_for_training'].includes(job.status)) return
    const timer = window.setInterval(async () => {
      try {
        const updated = await api.getReconstructionJob(job.job_id)
        setJob(updated)
        if (updated.status === 'completed') {
          loadScanUrl(api.getReconstructionModelUrl(updated.job_id), updated.mesh_url)
        }
      } catch { /* keep the last visible state */ }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [job, loadScanUrl])

  // Load available models when switching to library
  useEffect(() => {
    if (activeTab === 'library') {
      api.listAvailableModels().then(data => {
        setModelsList(data)
        setLoadedModels(data)
      })
    }
  }, [activeTab])

  /* ---------- Video Actions ---------- */
  const loadDemoVideo = async () => {
    try {
      const response = await fetch('/samples/living_room_demo.mp4')
      if (!response.ok) throw new Error('Not found')
      const blob = await response.blob()
      const demoFile = new File([blob], 'living_room_demo.mp4', { type: 'video/mp4' })
      chooseVideo(demoFile)
    } catch {
      setVideoError('Could not load sample video. Please choose a video manually.')
    }
  }

  const chooseVideo = (candidate?: File) => {
    if (!candidate) return
    if (!candidate.type.startsWith('video/')) { 
      setVideoError('Please choose a video file (.mp4, .mov, .webm).')
      return 
    }
    setVideoError('')
    setFile(candidate)
  }

  const startReconstruction = async () => {
    if (!file) return
    setVideoError('')
    try {
      const createdJob = await api.createReconstructionJob(file, reconstructMode)
      setJob(createdJob)
    } catch {
      setVideoError('API is unavailable. Ensure your backend is running.')
    }
  }

  /* ---------- Model Import Actions ---------- */
  const chooseModel = (candidate?: File) => {
    if (!candidate) return
    const name = candidate.name.toLowerCase()
    const valid = ['.ply', '.spz', '.splat', '.ksplat', '.sog', '.esz', '.lcc', '.glb', '.gltf', '.obj'].some(ext => name.endsWith(ext))
    if (!valid) {
      setModelError('Unsupported format. Please upload .ply, .spz, .splat, .ksplat, .sog, .glb, .gltf, or .obj')
      return
    }
    setModelError('')
    setModelFile(candidate)
  }

  const handleInstantPreview = async () => {
    if (!modelFile) return
    try {
      // Read bytes immediately into memory to avoid stale object URL permission revocations
      const buffer = await modelFile.arrayBuffer()
      setLocalSplatData({ buffer, name: modelFile.name })
      loadLocalScan(modelFile)
      onClose()
    } catch (err) {
      console.warn('[ModelImport] Direct file read failed, falling back to FileReader:', err)
      try {
        const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = () => reject(reader.error)
          reader.readAsArrayBuffer(modelFile)
        })
        setLocalSplatData({ buffer, name: modelFile.name })
        loadLocalScan(modelFile)
        onClose()
      } catch (readErr) {
        setModelError(`Could not read file: ${(readErr as Error).message}`)
      }
    }
  }

  const handleUploadAndSave = async () => {
    if (!modelFile) return
    setIsUploadingModel(true)
    setModelError('')
    try {
      const result = await api.uploadModel(modelFile)
      if (result.job_id) {
        setActiveJobId(result.job_id)
      }
      if (result.splat_url) {
        loadScanUrl(api.normalizeModelUrl(result.splat_url) || result.splat_url, result.mesh_url)
      } else {
        loadScanUrl(api.getReconstructionModelUrl(result.job_id), result.mesh_url)
      }
      onClose()
    } catch (err) {
      console.warn('[ModelImport] Server upload failed, loading via instant preview:', err)
      // Instant fallback: Read directly into browser memory
      try {
        const buffer = await modelFile.arrayBuffer()
        setLocalSplatData({ buffer, name: modelFile.name })
        loadLocalScan(modelFile)
        onClose()
      } catch (readErr) {
        setModelError(`Could not read file: ${(readErr as Error).message}`)
      }
    } finally {
      setIsUploadingModel(false)
    }
  }

  const handleSelectExistingModel = (model: AvailableModel) => {
    if (model.job_id) {
      setActiveJobId(model.job_id)
    }
    loadScanUrl(api.normalizeModelUrl(model.url) || model.url, model.mesh_url)
    onClose()
  }

  const currentStep = job ? Math.min(steps.length - 1, Math.max(0, Math.floor((job.progress / 100) * steps.length))) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header with Tabs */}
        <div className="border-b border-border bg-surface-elevated/40 px-6 pt-4 pb-0">
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-brand flex items-center justify-center shadow-glow">
                <Box size={16} className="text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-base tracking-tight text-text-primary">3D Space Ingestion</h2>
                <p className="text-[11px] text-text-muted">Reconstruct from video or import existing 3D models</p>
              </div>
            </div>
            <button 
              onClick={onClose} 
              className="rounded-lg p-1.5 text-text-muted hover:bg-surface-elevated hover:text-text-primary transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Tab Navigation */}
          {!job && (
            <div className="flex items-center gap-2 -mb-px">
              <button
                onClick={() => setActiveTab('video')}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
                  activeTab === 'video'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <Film size={14} />
                Video to 3DGS
              </button>
              <button
                onClick={() => setActiveTab('import_model')}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
                  activeTab === 'import_model'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <Upload size={14} />
                Import 3D Model
              </button>
              <button
                onClick={() => setActiveTab('library')}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
                  activeTab === 'library'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <FolderOpen size={14} />
                Scene Library
              </button>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* ============================================================ */}
          {/* TAB 1: VIDEO CAPTURE PIPELINE */}
          {/* ============================================================ */}
          {activeTab === 'video' && (
            <>
              {!job ? (
                <>
                  {/* Speed toggle pills */}
                  <div className="mb-4 flex items-center justify-between p-2 rounded-xl bg-surface-elevated/40 border border-border">
                    <span className="text-xs font-medium text-text-secondary pl-2 flex items-center gap-1.5">
                      <Zap size={13} className="text-amber-400" />
                      Pipeline Speed:
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setReconstructMode('fast')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          reconstructMode === 'fast'
                            ? 'bg-accent text-white shadow-sm'
                            : 'text-text-muted hover:text-text-primary'
                        }`}
                      >
                        ⚡ Fast (2–3 mins)
                      </button>
                      <button
                        type="button"
                        onClick={() => setReconstructMode('quality')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          reconstructMode === 'quality'
                            ? 'bg-accent text-white shadow-sm'
                            : 'text-text-muted hover:text-text-primary'
                        }`}
                      >
                        💎 Ultra Fidelity (15k steps)
                      </button>
                    </div>
                  </div>

                  {/* Drop zone */}
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setVideoDragging(true) }}
                    onDragLeave={() => setVideoDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setVideoDragging(false); chooseVideo(e.dataTransfer.files[0]) }}
                    className={`flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 transition-all ${
                      videoDragging ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/60 hover:bg-surface-elevated/40'
                    }`}
                  >
                    <Upload size={24} className="mb-2 text-accent" />
                    <span className="font-medium text-sm text-text-primary">
                      {file ? file.name : 'Drop room video here to train 3DGS'}
                    </span>
                    <span className="mt-1 text-xs text-text-muted">
                      MP4, MOV, or WebM · 20–60 seconds continuous walk
                    </span>
                  </button>
                  <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={(e) => chooseVideo(e.target.files?.[0])} />

                  {/* Verified demo button */}
                  <div className="mt-3 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={loadDemoVideo}
                      className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-all"
                    >
                      <Sparkles size={13} />
                      Load verified sample video (Living Room Scan · 5.6 MB)
                    </button>
                    <span className="text-[11px] text-text-muted">Tested for 100% SfM registration</span>
                  </div>

                  {videoError && (
                    <p className="mt-3 flex items-center gap-2 text-xs text-red-400">
                      <AlertCircle size={14} />{videoError}
                    </p>
                  )}

                  {/* Start Button */}
                  <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <p className="max-w-md text-xs leading-5 text-text-muted">
                      Sequential COLMAP estimates camera trajectory, followed by splatfacto GPU training.
                    </p>
                    <button
                      onClick={startReconstruction}
                      disabled={!file}
                      className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Cpu size={15} /> Start reconstruction
                    </button>
                  </div>
                </>
              ) : (
                /* Reconstruction Progress View */
                <>
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-accent font-semibold">Job {job.job_id}</p>
                      <h3 className="mt-1 text-lg font-semibold text-text-primary">{job.step}</h3>
                    </div>
                    <span className="font-mono text-2xl font-bold text-text-primary">{job.progress}%</span>
                  </div>

                  <div className="mb-6 h-2 overflow-hidden rounded-full bg-surface-elevated">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>

                  <div className="space-y-3">
                    {steps.map((step, index) => (
                      <div key={step} className="flex items-center gap-3 text-sm">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                          index < currentStep || job.status === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : index === currentStep
                            ? 'bg-accent/15 text-accent'
                            : 'bg-surface-elevated text-text-muted'
                        }`}>
                          {index < currentStep || job.status === 'completed' ? (
                            <CheckCircle2 size={14} />
                          ) : index === currentStep && job.status !== 'ready_for_training' && job.status !== 'failed' ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            index + 1
                          )}
                        </div>
                        <span className={index <= currentStep ? 'text-text-primary font-medium' : 'text-text-muted'}>
                          {step}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 rounded-lg border border-border bg-black/30 p-3 font-mono text-[11px] text-text-muted">
                    {job.log || 'Preparing reconstruction worker…'}
                  </div>

                  {job.status === 'completed' && (
                    <div className="mt-6 flex gap-3">
                      <button
                        onClick={() => {
                          setSplatUrl(api.getReconstructionModelUrl(job.job_id))
                          onClose()
                        }}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 shadow-lg shadow-emerald-900/30"
                      >
                        <Sparkles size={16} /> View 3D Splat in Scene
                      </button>
                      <button onClick={onClose} className="rounded-lg border border-border px-5 py-2.5 text-sm hover:bg-surface-elevated">
                        Close
                      </button>
                    </div>
                  )}

                  {job.status === 'failed' && (
                    <div className="mt-4 flex items-center justify-between">
                      <p className="text-xs text-red-400">Reconstruction halted. Check backend logs.</p>
                      <button onClick={onClose} className="rounded-lg border border-border px-4 py-1.5 text-xs hover:bg-surface-elevated">
                        Close
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ============================================================ */}
          {/* TAB 2: DIRECT 3D MODEL / SPLAT IMPORT */}
          {/* ============================================================ */}
          {activeTab === 'import_model' && (
            <div>
              <div className="mb-4 grid grid-cols-3 gap-2.5 text-center text-xs text-text-muted">
                <div className="p-2.5 rounded-lg border border-border bg-surface-elevated/30">
                  <b className="block text-text-primary text-xs mb-0.5">Gaussian Splat</b>
                  .ply, .spz, .splat, .sog
                </div>
                <div className="p-2.5 rounded-lg border border-border bg-surface-elevated/30">
                  <b className="block text-text-primary text-xs mb-0.5">Instant Preview</b>
                  Zero upload wait
                </div>
                <div className="p-2.5 rounded-lg border border-border bg-surface-elevated/30">
                  <b className="block text-text-primary text-xs mb-0.5">3D Meshes</b>
                  .glb, .gltf
                </div>
              </div>

              {/* Drop area */}
              <button
                type="button"
                onClick={() => modelInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setModelDragging(true) }}
                onDragLeave={() => setModelDragging(false)}
                onDrop={(e) => { e.preventDefault(); setModelDragging(false); chooseModel(e.dataTransfer.files[0]) }}
                className={`flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 transition-all ${
                  modelDragging ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/60 hover:bg-surface-elevated/40'
                }`}
              >
                <Box size={28} className="mb-2.5 text-accent" />
                <span className="font-semibold text-sm text-text-primary">
                  {modelFile ? modelFile.name : 'Drop existing 3D model or Gaussian Splat'}
                </span>
                <span className="mt-1 text-xs text-text-muted">
                  Supports .ply, .spz (compressed splat), .splat, .ksplat, .sog, .glb, and .obj
                </span>
                {modelFile && (
                  <span className="mt-2 text-xs font-mono text-accent bg-accent/10 px-2 py-0.5 rounded">
                    Size: {(modelFile.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                )}
              </button>
              <input
                ref={modelInputRef}
                type="file"
                accept=".ply,.spz,.splat,.ksplat,.sog,.esz,.lcc,.glb,.gltf,.obj"
                className="hidden"
                onChange={(e) => chooseModel(e.target.files?.[0])}
              />

              <button
                type="button"
                onClick={() => {
                  loadScanUrl('/Hurstville_Museum_Gallery.sog')
                  onClose()
                }}
                className="mt-3 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
              >
                Load verified sample room scan
              </button>

              {modelError && (
                <p className="mt-3 flex items-center gap-2 text-xs text-red-400">
                  <AlertCircle size={14} />{modelError}
                </p>
              )}

              {/* Action buttons */}
              <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                <p className="text-xs text-text-muted">
                  View instantly in browser or save to backend project library.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleInstantPreview}
                    disabled={!modelFile}
                    className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40 transition-all"
                  >
                    <Zap size={14} /> Instant Preview (0s)
                  </button>
                  <button
                    type="button"
                    onClick={handleUploadAndSave}
                    disabled={!modelFile || isUploadingModel}
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 transition-all"
                  >
                    {isUploadingModel ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    Upload & Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 3: SCENE LIBRARY (EXISTING LOCAL/CLOUD SCENES) */}
          {/* ============================================================ */}
          {activeTab === 'library' && (
            <div>
              <p className="text-xs text-text-muted mb-3">
                Pre-trained Gaussian Splats stored on your backend. Click any scene to load immediately into the 3D viewer.
              </p>

              {isLoadingModels ? (
                <div className="flex flex-col items-center justify-center py-12 text-text-muted text-xs gap-2">
                  <Loader2 size={20} className="animate-spin text-accent" />
                  Loading scene library…
                </div>
              ) : modelsList.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl text-xs text-text-muted">
                  No pre-trained models found. Use the &quot;Video to 3DGS&quot; tab or import an existing model.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-[340px] overflow-y-auto pr-1">
                  {modelsList.map((m) => {
                    const isCurrent = splatUrl?.includes(m.job_id)
                    return (
                      <div
                        key={m.job_id}
                        onClick={() => handleSelectExistingModel(m)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                          isCurrent
                            ? 'border-accent bg-accent/10 ring-1 ring-accent'
                            : 'border-border bg-surface-elevated/40 hover:border-accent/50 hover:bg-surface-elevated'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-mono text-xs font-semibold text-text-primary">
                            {m.job_id}
                          </span>
                          <span className="text-[10px] font-mono uppercase bg-black/40 px-1.5 py-0.5 rounded text-accent border border-accent/20">
                            {m.format}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-text-muted">
                          <span>Size: <b className="text-text-secondary">{m.size_mb} MB</b></span>
                          {isCurrent && (
                            <span className="text-emerald-400 font-medium flex items-center gap-1 text-[10px]">
                              <CheckCircle2 size={11} /> Active
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}
