'use client'

import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import { SceneObject } from '@/lib/types'
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useAppStore } from '@/lib/store'
import dynamic from 'next/dynamic'
import { SplatEngine } from './SplatEngine'
import { SparkSplatViewer } from './SparkSplatViewer'
import { CameraController, CameraMode } from './CameraController'
import { useQualityManager } from './QualityManager'
import { Loader2, Box } from 'lucide-react'

const AholoViewer = dynamic(() => import('./AholoViewer').then((mod) => mod.AholoViewer), {
  ssr: false,
})
import { ViewerOverlay } from './ViewerOverlay'
import { SolidMeshViewer } from './SolidMeshViewer'
import { ObjectActionBar } from './ObjectActionBar'
import { ObjectReplacementModal } from './ObjectReplacementModal'
import { ModelCameraDesk } from './ModelCameraDesk'
import { api } from '@/lib/api'

/* ---------- Per-object bounding-box mesh ---------- */
function SceneObjectMesh({ 
  object, selected, hovered, onClick, onHover 
}: { 
  object: SceneObject
  selected: boolean
  hovered: boolean
  onClick: () => void
  onHover: (hovering: boolean) => void
}) {
  const pos = object.position || { x: 0, y: 0, z: 0 }
  const dim = object.dimensions || { width_m: 1, height_m: 1, depth_m: 1 }
  const isHighlighted = selected || hovered

  return (
    <group position={[pos.x, pos.y, pos.z]}>
      {/* Transparent fill */}
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(true) }}
        onPointerOut={() => onHover(false)}
      >
        <boxGeometry args={[dim.width_m, dim.height_m, dim.depth_m || dim.width_m]} />
        <meshStandardMaterial 
          color={selected ? '#6366F1' : hovered ? '#818CF8' : (object.material?.color || '#666')}
          transparent
          opacity={isHighlighted ? 0.2 : 0.05}
          depthWrite={false}
        />
      </mesh>

      {/* Wireframe edges */}
      {isHighlighted && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(dim.width_m, dim.height_m, dim.depth_m || dim.width_m)]} />
          <lineBasicMaterial color={selected ? '#6366F1' : '#818CF8'} linewidth={1} transparent opacity={0.8} />
        </lineSegments>
      )}
    </group>
  )
}

/* ---------- Screenshot & FPS tracker helper (inside Canvas) ---------- */
function CanvasHelpers({ 
  onCapture, 
  onFrame 
}: { 
  onCapture: (fn: () => string | null) => void
  onFrame: () => void 
}) {
  const { gl, scene, camera } = useThree()
  
  useEffect(() => {
    onCapture(() => {
      gl.render(scene, camera)
      return gl.domElement.toDataURL('image/png')
    })
  }, [gl, scene, camera, onCapture])

  useFrame(() => {
    onFrame()
  })

  return null
}

/* ---------- Main SceneViewer ---------- */
export function SceneViewer({ 
  objects, selectedId, onSelectObject 
}: { 
  objects: SceneObject[]
  selectedId: string | null
  onSelectObject: (id: string | null) => void 
}) {
  const { 
    splatUrl, 
    localSplatData,
    setLocalSplatData,
    showSplat, 
    setShowSplat, 
    showBoxes, 
    setShowBoxes,
    viewMode,
    meshManifest,
    setMeshManifest,
    setFurnitureCatalog,
    convertedMeshUrl,
    activeJobId,
    activeModelName,
    isConvertingMesh,
    convertProgress,
    convertStage,
    coordSystem,
  } = useAppStore()
  
  // Splat loading states
  const [loadProgress, setLoadProgress] = useState<number | null>(null)
  const [loadStage, setLoadStage] = useState<string | null>(null)
  const [splatCount, setSplatCount] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  
  // Engine routing: start with the spatial engine, fall back to legacy if needed
  const [useFallbackEngine, setUseFallbackEngine] = useState(false)
  const [spatialFps, setSpatialFps] = useState(0)

  // Selection, transform gizmo, and interaction states
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [isDraggingGizmo, setIsDraggingGizmo] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit')
  const [cameraResetTrigger, setCameraResetTrigger] = useState(0)
  const aholoResetViewRef = useRef<(() => void) | null>(null)
  const captureRef = useRef<(() => string | null) | null>(null)

  // Pre-load furniture catalog & mesh manifest
  useEffect(() => {
    api.getFurnitureCatalog().then((items) => {
      if (items && items.length > 0) {
        setFurnitureCatalog(items)
      }
    }).catch(e => console.warn('Could not load furniture catalog:', e))
  }, [setFurnitureCatalog])

  useEffect(() => {
    const match = splatUrl?.match(/jobs\/([^\/]+)/)
    const jobId = activeJobId || (match ? match[1] : null)
    if (jobId && !meshManifest) {
      api.getMeshManifest(jobId).then((m) => {
        if (m) setMeshManifest(m)
      }).catch(() => {})
    }
  }, [splatUrl, activeJobId, meshManifest, setMeshManifest])

  // Resolve master mesh URL for solid polygon mesh mode
  const masterMeshUrl = useMemo(() => {
    if (convertedMeshUrl) {
      return api.normalizeModelUrl(convertedMeshUrl) || convertedMeshUrl
    }
    if (splatUrl && (splatUrl.endsWith('.glb') || splatUrl.endsWith('.gltf') || splatUrl.endsWith('.obj'))) {
      return api.normalizeModelUrl(splatUrl) || splatUrl
    }
    const match = splatUrl?.match(/jobs\/([^\/]+)/)
    const jobId = activeJobId || (match ? match[1] : null)
    if (!jobId) {
      return undefined
    }
    if (meshManifest?.master_mesh) {
      return api.normalizeModelUrl(`/api/reconstruction/jobs/${jobId}/mesh/${meshManifest.master_mesh}`) || undefined
    }
    return api.normalizeModelUrl(`/api/reconstruction/jobs/${jobId}/mesh/scene_mesh.glb`) || undefined
  }, [splatUrl, convertedMeshUrl, activeJobId, meshManifest])

  // Merged objects list from scene graph and verified mesh manifest
  const allObjects: SceneObject[] = useMemo(() => {
    const existingIds = new Set(objects.map(o => o.entity_id))
    const list = [...objects]
    if (meshManifest?.objects) {
      for (const mObj of meshManifest.objects) {
        if (!existingIds.has(mObj.entity_id)) {
          list.push({
            entity_id: mObj.entity_id,
            name: mObj.name,
            category: mObj.category,
            type: 'furniture',
            position: mObj.position,
            dimensions: mObj.dimensions,
            confidence: 1.0,
            is_visible: true,
            editable: true,
          })
          existingIds.add(mObj.entity_id)
        }
      }
    }
    return list
  }, [objects, meshManifest])

  // Custom model scene isolation:
  // If user selected a custom file (direct mesh or splat conversion), NEVER display
  // the mock room bedroom furniture (King Bed, Sofa, Table) as if it came from their file.
  const isCustomScene = Boolean(activeModelName || convertedMeshUrl || localSplatData)
  const solidMeshObjects = useMemo(() => {
    if (isCustomScene) {
      if (meshManifest?.objects && meshManifest.objects.length > 0) {
        return meshManifest.objects.map(mObj => ({
          entity_id: mObj.entity_id,
          name: mObj.name,
          category: mObj.category,
          type: 'furniture' as const,
          position: mObj.position,
          dimensions: mObj.dimensions,
          confidence: 1.0,
          is_visible: true,
          editable: true,
        }))
      }
      return []
    }
    return allObjects
  }, [isCustomScene, meshManifest, allObjects])

  const handleResetView = useCallback(() => {
    if (viewMode === 'splat') {
      aholoResetViewRef.current?.()
    } else {
      setCameraResetTrigger(prev => prev + 1)
    }
  }, [viewMode])

  // Dynamic performance and quality management
  const { tier, setTier, fps, trackFrame } = useQualityManager()

  const handleScreenshot = useCallback(() => {
    if (captureRef.current) {
      const dataUrl = captureRef.current()
      if (dataUrl) {
        useAppStore.getState().setBeforeImage(dataUrl)
      }
    }
  }, [])

  // Global hotkeys
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      
      switch (e.key.toLowerCase()) {
        case 's':
          if (splatUrl) setShowSplat(!showSplat)
          break
        case 'b':
          setShowBoxes(!showBoxes)
          break
        case 'o':
          setCameraMode('orbit')
          break
        case 'w':
          // If in walk mode or no object selected
          if (cameraMode !== 'orbit') setCameraMode('walk')
          break
        case 'f':
          setCameraMode('fly')
          break
        case 'c':
          handleScreenshot()
          break
        case '?':
          setShowShortcuts(prev => !prev)
          break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [showBoxes, showSplat, splatUrl, setShowBoxes, setShowSplat, handleScreenshot, cameraMode])

  // Reset fallback engine when URL or local data changes
  useEffect(() => {
    setUseFallbackEngine(false)
  }, [splatUrl, localSplatData])

  const handleProgress = useCallback((p: number, stage?: string) => {
    if (p > 0 && p < 100) {
      setLoadProgress(p)
      if (stage) setLoadStage(stage)
    } else {
      setLoadProgress(null)
      setLoadStage(null)
    }
  }, [])

  const handleLoaded = useCallback((info: { splatCount: number; fileName?: string }) => {
    setSplatCount(info.splatCount || 0)
    setLoadProgress(null)
    setLoadStage(null)
    setLoadError(null)
  }, [])

  const handleFpsUpdate = useCallback((f: number) => {
    setSpatialFps(f)
  }, [])

  const handleDataLoaded = useCallback((data: { buffer: ArrayBuffer; name: string }) => {
    setLocalSplatData(data)
    setLoadError(null)
  }, [setLocalSplatData])

  const handleViewerError = useCallback((err: Error) => {
    console.warn('[SceneViewer] 3DGS engine error:', err);
    if (err.message === 'FALLBACK_REQUIRED' || err.message?.includes('timed out') || err.message?.includes('Worker')) {
      console.info('[SceneViewer] Automatically switching to Spark Splat Viewer fallback');
      setUseFallbackEngine(true);
      setLoadError(null);
      setLoadProgress(null);
      setLoadStage(null);
    } else {
      setLoadError(err.message);
      setLoadProgress(null);
      setLoadStage(null);
    }
  }, []);

  // Determine if Aholo Viewer is active (primary 3DGS engine)
  const useAholoViewer = viewMode === 'splat' && !useFallbackEngine

  return (
    <div className="w-full h-full relative select-none">
      {/* 
        ENGINE 1: SpaceGen Aholo 3D Viewer (powered by @manycore/aholo-viewer)
        Renders in its own WebGL2 canvas, sits on top of the R3F canvas.
        Supports drag-and-drop & file picker for local files without backend upload,
        format validation for 3DGS vs mesh PLY, and full orbit/pan/zoom navigation.
      */}
      {useAholoViewer && (
        <AholoViewer
          url={localSplatData ? null : splatUrl}
          localData={localSplatData}
          visible={viewMode === 'splat' && showSplat}
          coordinateSystem={(coordSystem?.toLowerCase() as 'opencv' | 'opengl') || 'opencv'}
          useOrbit={cameraMode === 'orbit'}
          className="absolute inset-0 z-10"
          onProgress={handleProgress}
          onLoaded={handleLoaded}
          onFpsUpdate={handleFpsUpdate}
          onDataLoaded={handleDataLoaded}
          onResetViewReady={(fn) => { aholoResetViewRef.current = fn }}
          onError={handleViewerError}
        />
      )}

      {/* 
        ENGINE 2: R3F Canvas (Three.js)
        Handles: Solid Mesh mode, 6-DOF TransformControls, bounding boxes.
        Also serves as fallback for .splat files the spatial engine cannot parse.
        Hidden behind the spatial engine canvas when it is active.
      */}
      <Canvas 
        onPointerMissed={() => onSelectObject(null)}
        camera={{ position: [0, 1.8, 4.5], fov: 55 }} 
        shadows={false}
        style={{
          // Move behind the Aholo engine when it's active and visible
          position: useAholoViewer ? 'absolute' : 'relative',
          zIndex: useAholoViewer ? 0 : 1,
          opacity: useAholoViewer ? 0 : 1,
          pointerEvents: useAholoViewer ? 'none' : 'auto',
        }}
        gl={{ 
          antialias: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true
        }}
      >
        <color attach="background" args={['#06060C']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 10, 5]} intensity={0.9} />
        <directionalLight position={[-3, 8, -4]} intensity={0.4} />
        
        <Grid 
          infiniteGrid 
          fadeDistance={30} 
          sectionColor="#1E1E32"
          cellColor="#121222"
          position={[0, -1, 0]}
          sectionSize={2}
          cellSize={0.5}
        />
        
        {/* Switchable camera controller with gizmo drag locking and reset trigger */}
        <CameraController 
          mode={cameraMode}
          onModeChange={setCameraMode}
          floorHeight={-1}
          eyeHeight={1.6}
          isDraggingGizmo={isDraggingGizmo}
          resetTrigger={cameraResetTrigger}
        />

        <CanvasHelpers 
          onCapture={(fn) => { captureRef.current = fn }} 
          onFrame={trackFrame}
        />
        
        {/* Legacy Splat Renderer (fallback when spatial engine can't parse the format) */}
        {viewMode === 'splat' && splatUrl && useFallbackEngine && (
          <SparkSplatViewer
            url={splatUrl}
            visible={showSplat}
            quality={tier}
            onProgress={(p) => setLoadProgress(p < 100 ? p : null)}
            onLoaded={(count) => {
              setSplatCount(count)
              setLoadProgress(null)
              setLoadError(null)
            }}
            onError={(err) => {
              setLoadError(err.message)
              setLoadProgress(null)
            }}
          />
        )}

        {/* Mode 2: Solid Watertight Polygon Mesh + 6-DOF Interactive Objects */}
        {viewMode === 'mesh' && (
          <SolidMeshViewer
            meshUrl={masterMeshUrl}
            objects={solidMeshObjects}
            onSelectObject={onSelectObject}
            onDragChange={setIsDraggingGizmo}
          />
        )}

        {/* Semantic Bounding Boxes (Splat Mode) */}
        {viewMode === 'splat' && showBoxes && (
          <group>
            {allObjects.map(obj => (
              <SceneObjectMesh 
                key={obj.entity_id} 
                object={obj} 
                selected={obj.entity_id === selectedId}
                hovered={obj.entity_id === hoveredId}
                onClick={() => onSelectObject(obj.entity_id)}
                onHover={(h) => setHoveredId(h ? obj.entity_id : null)}
              />
            ))}
          </group>
        )}
      </Canvas>

      {/* Floating 6-DOF Action Bar for Selected Object */}
      <ObjectActionBar />

      {/* Object Replacement Modal (Catalog / Custom Upload / AI Generator) */}
      <ObjectReplacementModal />

      {/* Solid Mesh Empty State Notice when no mesh produced yet and not converting */}
      {viewMode === 'mesh' && !isConvertingMesh && !masterMeshUrl && (
        <div className="absolute inset-0 z-5 flex flex-col items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2 p-6 rounded-2xl bg-black/40 border border-white/5 backdrop-blur-md max-w-md text-center">
            <Box className="w-10 h-10 text-text-muted/60 mb-1" />
            <h3 className="text-sm font-medium text-white">No Solid Mesh Loaded</h3>
            <p className="text-xs text-text-muted max-w-xs">
              {activeModelName
                ? `Ready to reconstruct ${activeModelName}. Click "Convert to Solid Mesh" above to generate a polygon mesh.`
                : 'Select or drop a 3D model (.glb, .gltf, .obj) or 3D Gaussian Splat (.sog, .ply) using the panel on the left.'}
            </p>
          </div>
        </div>
      )}

      {/* Unified Model & Camera Control Desk (Visible in both Solid Mesh & Splat View) */}
      <ModelCameraDesk
        onResetView={handleResetView}
        splatCount={splatCount}
        cameraOrbiting={cameraMode === 'orbit'}
        onToggleOrbit={(orbit) => setCameraMode(orbit ? 'orbit' : 'walk')}
      />

      {/* Complete UI Controls and Overlays */}
      <ViewerOverlay
        loadProgress={loadProgress}
        loadStage={loadStage}
        splatCount={splatCount}
        loadError={loadError}
        onDismissError={() => setLoadError(null)}
        splatUrl={splatUrl}
        showSplat={showSplat}
        showBoxes={showBoxes}
        onToggleSplat={() => setShowSplat(!showSplat)}
        onToggleBoxes={() => setShowBoxes(!showBoxes)}
        cameraMode={cameraMode}
        onCameraMode={setCameraMode}
        quality={tier}
        fps={useAholoViewer ? spatialFps : fps}
        onQualityChange={setTier}
        onScreenshot={handleScreenshot}
        showShortcuts={showShortcuts}
        onToggleShortcuts={() => setShowShortcuts(!showShortcuts)}
      />
    </div>
  )
}
