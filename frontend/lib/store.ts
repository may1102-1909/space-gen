import { create } from 'zustand'
import { useScene } from '@pascal-app/core'
import { SceneGraph, ChatMessage, ObjectTransform, FurnitureItem, MeshManifest } from './types'
import { SplatExclusionBox, applySceneActions } from './pascal/sceneBridge'
import { CandidatePlacement } from './ai/spatialLayoutSolver'

export interface AppState {
  scene: SceneGraph | null
  selectedObjectId: string | null
  chatMessages: ChatMessage[]
  isLoading: boolean
  heroImage: string | null
  variants: Array<{ style: string; image: string; description: string }>
  referenceImage: string | null
  referenceAnalysis: any | null
  presentationMode: boolean
  beforeImage: string | null
  afterImage: string | null
  splatUrl: string | null
  localSplatData: { buffer: ArrayBuffer; name: string } | null
  showSplat: boolean
  showBoxes: boolean

  // Mesh & Object Editing State
  viewMode: 'splat' | 'mesh'
  gizmoMode: 'translate' | 'rotate' | 'scale'
  objectTransforms: Record<string, ObjectTransform>
  objectReplacements: Record<string, { modelUrl: string; name: string }>
  isConvertingMesh: boolean
  convertProgress: number | null
  convertStage: string | null
  convertedMeshUrl: string | null
  activeJobId: string | null
  meshManifest: MeshManifest | null
  furnitureCatalog: FurnitureItem[]
  showReplacementModal: boolean

  // SuperSplat Splat Erasure State (Bounding Box Masks)
  splatExclusionBoxes: SplatExclusionBox[]
  addSplatExclusionBox: (box: SplatExclusionBox) => void
  removeSplatExclusionBox: (id: string) => void

  // AI Smart Candidate Placements
  candidatePlacements: CandidatePlacement[]
  setCandidatePlacements: (candidates: CandidatePlacement[]) => void
  acceptCandidatePlacement: (id: string) => void
  rejectCandidatePlacement: (id: string) => void
  acceptAllCandidatePlacements: () => void
  clearCandidatePlacements: () => void

  // Unified Model & Camera Desk State
  activeModelName: string | null
  activeFileType: string | null
  modelStats: { count?: number; triangles?: number; type?: string; sizeFormatted?: string } | null
  coordSystem: 'OpenCV' | 'OpenGL'
  farPlane: number

  setScene: (scene: SceneGraph | null) => void
  setSelectedObjectId: (id: string | null) => void
  addChatMessage: (msg: ChatMessage) => void
  setIsLoading: (loading: boolean) => void
  setHeroImage: (image: string | null) => void
  setVariants: (variants: Array<{ style: string; image: string; description: string }>) => void
  setReferenceImage: (img: string | null) => void
  setReferenceAnalysis: (analysis: any) => void
  setPresentationMode: (mode: boolean) => void
  setBeforeImage: (img: string | null) => void
  setAfterImage: (img: string | null) => void
  setSplatUrl: (url: string | null) => void
  setLocalSplatData: (data: { buffer: ArrayBuffer; name: string } | null, options?: { viewMode?: 'splat' | 'mesh' }) => void
  setShowSplat: (show: boolean) => void
  setShowBoxes: (show: boolean) => void

  // Mesh & Object Editing Setters
  setViewMode: (mode: 'splat' | 'mesh') => void
  setGizmoMode: (mode: 'translate' | 'rotate' | 'scale') => void
  updateObjectTransform: (id: string, transform: Partial<ObjectTransform>) => void
  resetObjectTransform: (id: string) => void
  replaceObject: (id: string, modelUrl: string, name: string) => void
  deleteObject: (id: string) => void
  setIsConvertingMesh: (val: boolean) => void
  setConvertProgress: (val: number | null) => void
  setConvertStage: (stage: string | null) => void
  setConvertedMeshUrl: (url: string | null) => void
  setActiveJobId: (id: string | null) => void
  setMeshManifest: (manifest: MeshManifest | null) => void
  setFurnitureCatalog: (catalog: FurnitureItem[]) => void
  setShowReplacementModal: (show: boolean) => void
  setActiveModelName: (name: string | null) => void
  setActiveFileType: (type: string | null) => void
  setModelStats: (stats: { count?: number; triangles?: number; type?: string; sizeFormatted?: string } | null) => void
  setCoordSystem: (sys: 'OpenCV' | 'OpenGL') => void
  setFarPlane: (far: number) => void
  clearActiveModel: () => void
}

export const useSpaceGenStore = create<AppState>((set, get) => ({
  scene: null,
  selectedObjectId: null,
  chatMessages: [
    { role: 'assistant', content: 'Hello! I am your AI Copilot. How would you like to redesign this space?', timestamp: Date.now() }
  ],
  isLoading: false,
  heroImage: null,
  variants: [],
  referenceImage: null,
  referenceAnalysis: null,
  presentationMode: false,
  beforeImage: null,
  afterImage: null,
  splatUrl: null,
  localSplatData: null,
  showSplat: true,
  showBoxes: true,

  // Default mesh & transform editing state
  viewMode: 'splat',
  gizmoMode: 'translate',
  objectTransforms: {},
  objectReplacements: {},
  isConvertingMesh: false,
  convertProgress: null,
  convertStage: null,
  convertedMeshUrl: null,
  activeJobId: null,
  meshManifest: null,
  furnitureCatalog: [],
  showReplacementModal: false,

  // SuperSplat splat exclusion state
  splatExclusionBoxes: [],
  addSplatExclusionBox: (box) => set((state) => ({
    splatExclusionBoxes: [...state.splatExclusionBoxes, box]
  })),
  removeSplatExclusionBox: (id) => set((state) => ({
    splatExclusionBoxes: state.splatExclusionBoxes.filter((b) => b.id !== id)
  })),

  // AI Smart Candidate Placements
  candidatePlacements: [],
  setCandidatePlacements: (candidates) => set({ candidatePlacements: candidates }),
  acceptCandidatePlacement: (id) => {
    const candidate = get().candidatePlacements.find((c) => c.id === id);
    if (candidate) {
      const activeLevelId =
        Object.values(useScene.getState().nodes).find((n) => n?.type === 'level')?.id || 'level_main';
      applySceneActions([
        {
          action: 'create_node',
          node: {
            type: 'item',
            id: `item_${candidate.category}_${Date.now()}`,
            name: candidate.name,
            category: candidate.category,
            position: candidate.position,
            rotation: candidate.rotation,
            dimensions: candidate.dimensions,
            modelUrl: candidate.modelUrl,
          } as any,
          parentId: activeLevelId,
        },
      ]);
      set((state) => ({
        candidatePlacements: state.candidatePlacements.filter((c) => c.id !== id),
      }));
    }
  },
  rejectCandidatePlacement: (id) => {
    set((state) => ({
      candidatePlacements: state.candidatePlacements.filter((c) => c.id !== id),
    }));
  },
  acceptAllCandidatePlacements: () => {
    const candidates = get().candidatePlacements;
    if (candidates.length === 0) return;

    const activeLevelId =
      Object.values(useScene.getState().nodes).find((n) => n?.type === 'level')?.id || 'level_main';

    const actions = candidates.map((candidate, idx) => ({
      action: 'create_node' as const,
      node: {
        type: 'item' as const,
        id: `item_${candidate.category}_${Date.now()}_${idx}`,
        name: candidate.name,
        category: candidate.category,
        position: candidate.position,
        rotation: candidate.rotation,
        dimensions: candidate.dimensions,
        modelUrl: candidate.modelUrl,
      } as any,
      parentId: activeLevelId,
    }));

    applySceneActions(actions);
    set({ candidatePlacements: [] });
  },
  clearCandidatePlacements: () => set({ candidatePlacements: [] }),

  // Unified Model & Camera Desk default values
  activeModelName: null,
  activeFileType: null,
  modelStats: null,
  coordSystem: 'OpenCV',
  farPlane: 2000,

  setScene: (scene) => set({ scene }),
  setSelectedObjectId: (id) => set({ selectedObjectId: id }),
  addChatMessage: (msg) => set((state) => ({ chatMessages: [...state.chatMessages, msg] })),
  setIsLoading: (isLoading) => set({ isLoading }),
  setHeroImage: (heroImage) => set({ heroImage }),
  setVariants: (variants) => set({ variants }),
  setReferenceImage: (referenceImage) => set({ referenceImage }),
  setReferenceAnalysis: (referenceAnalysis) => set({ referenceAnalysis }),
  setPresentationMode: (presentationMode) => set({ presentationMode }),
  setBeforeImage: (beforeImage) => set({ beforeImage }),
  setAfterImage: (afterImage) => set({ afterImage }),
  setSplatUrl: (splatUrl) => set({
    splatUrl,
    localSplatData: null,
    convertedMeshUrl: null,
    activeJobId: null,
    showSplat: true,
    viewMode: 'splat',
    activeModelName: splatUrl ? (splatUrl.split('/').pop() || 'Remote Model') : null,
    activeFileType: '3DGS',
  }),
  setLocalSplatData: (localSplatData, options) => set({
    localSplatData,
    convertedMeshUrl: null,
    activeJobId: null,
    showSplat: true,
    viewMode: options?.viewMode || 'splat',
    activeModelName: localSplatData?.name || null,
    activeFileType: localSplatData ? '3DGS' : null,
  }),
  setShowSplat: (showSplat) => set({ showSplat }),
  setShowBoxes: (showBoxes) => set({ showBoxes }),

  setViewMode: (viewMode) => set({ viewMode }),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),

  // Delegates transform mutations to Pascal's useScene if node exists
  updateObjectTransform: (id, trans) => {
    if (typeof window !== 'undefined') {
      try {
        const pascalNodes = useScene.getState().nodes as Record<string, any>;
        if (pascalNodes[id]) {
          const updateData: Record<string, any> = {};
          if (trans.position) updateData.position = trans.position;
          if (trans.rotation) updateData.rotation = trans.rotation;
          if (trans.scale) updateData.scale = trans.scale;
          (useScene.getState().updateNode as any)(id, updateData);
        }
      } catch (e) {
        console.warn('[store] Could not sync transform to Pascal node:', e);
      }
    }

    set((state) => ({
      objectTransforms: {
        ...state.objectTransforms,
        [id]: {
          position: trans.position || state.objectTransforms[id]?.position || [0, 0, 0],
          rotation: trans.rotation || state.objectTransforms[id]?.rotation || [0, 0, 0],
          scale: trans.scale || state.objectTransforms[id]?.scale || [1, 1, 1],
        }
      }
    }));
  },

  resetObjectTransform: (id) => {
    set((state) => {
      const next = { ...state.objectTransforms };
      delete next[id];
      return { objectTransforms: next };
    });
  },

  replaceObject: (id, modelUrl, name) => {
    if (typeof window !== 'undefined') {
      try {
        const pascalNodes = useScene.getState().nodes as Record<string, any>;
        if (pascalNodes[id]) {
          (useScene.getState().updateNode as any)(id, {
            modelUrl,
            name,
          });
        }
      } catch (e) {
        console.warn('[store] Could not sync replacement to Pascal node:', e);
      }
    }

    set((state) => ({
      objectReplacements: {
        ...state.objectReplacements,
        [id]: { modelUrl, name }
      }
    }));
  },

  deleteObject: (id) => {
    if (typeof window !== 'undefined') {
      try {
        const pascalNodes = useScene.getState().nodes as Record<string, any>;
        if (pascalNodes[id]) {
          (useScene.getState().deleteNode as any)(id);
        }
      } catch (e) {
        console.warn('[store] Could not delete Pascal node:', e);
      }
    }

    set((state) => {
      if (!state.scene) return { selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId };
      return {
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
        scene: {
          ...state.scene,
          objects: state.scene.objects.map(obj => obj.entity_id === id ? { ...obj, is_visible: false } : obj)
        }
      };
    });
  },

  setIsConvertingMesh: (isConvertingMesh) => set({ isConvertingMesh }),
  setConvertProgress: (convertProgress) => set({ convertProgress }),
  setConvertStage: (convertStage) => set({ convertStage }),
  setConvertedMeshUrl: (convertedMeshUrl) => set({ convertedMeshUrl }),
  setActiveJobId: (activeJobId) => set({ activeJobId }),
  setMeshManifest: (meshManifest) => set({ meshManifest }),
  setFurnitureCatalog: (furnitureCatalog) => set({ furnitureCatalog }),
  setShowReplacementModal: (showReplacementModal) => set({ showReplacementModal }),
  setActiveModelName: (activeModelName) => set({ activeModelName }),
  setActiveFileType: (activeFileType) => set({ activeFileType }),
  setModelStats: (modelStats) => set({ modelStats }),
  setCoordSystem: (coordSystem) => set({ coordSystem }),
  setFarPlane: (farPlane) => set({ farPlane }),
  clearActiveModel: () => set({
    activeModelName: null,
    activeFileType: null,
    localSplatData: null,
    convertedMeshUrl: null,
    splatUrl: null,
    activeJobId: null,
    meshManifest: null,
    modelStats: null,
    isConvertingMesh: false,
    convertProgress: null,
    convertStage: null,
    splatExclusionBoxes: [],
    candidatePlacements: [],
  }),
}));

export const useAppStore = useSpaceGenStore;
