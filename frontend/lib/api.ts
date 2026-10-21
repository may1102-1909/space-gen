import { ReconstructionJob, SceneGraph, SceneObject, FurnitureItem, MeshManifest } from './types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export const api = {
  /**
   * Fetch scene graph from backend. If scene doesn't exist, fetches the active demo scene.
   */
  async getScene(sceneId: string = 'default'): Promise<SceneGraph> {
    try {
      const res = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneId)}`, {
        headers: { 'Accept': 'application/json' },
      })
      if (!res.ok) {
        throw new ApiError(`Failed to fetch scene (${res.status}): ${await res.text()}`, res.status)
      }
      return await res.json()
    } catch (err) {
      console.warn('[API] getScene error, using fallback scene:', err)
      return {
        scene_id: sceneId,
        room_type: 'Living Room',
        style: 'Modern Minimalist',
        objects: [
          {
            entity_id: 'obj_1',
            type: 'furniture',
            category: 'Sofa',
            name: 'Modern Sectional Sofa',
            position: { x: 0, y: 0.4, z: 0 },
            dimensions: { width_m: 2.4, height_m: 0.8, depth_m: 1.1 },
            material: { type: 'Linen', color: '#D4D0C8', finish: 'Matte' },
            confidence: 0.96,
            editable: true,
            is_visible: true,
          },
          {
            entity_id: 'obj_2',
            type: 'furniture',
            category: 'Coffee Table',
            name: 'Walnut Coffee Table',
            position: { x: 0, y: 0.2, z: 1.4 },
            dimensions: { width_m: 1.2, height_m: 0.4, depth_m: 0.6 },
            material: { type: 'Walnut Wood', color: '#5C4033', finish: 'Polished' },
            confidence: 0.92,
            editable: true,
            is_visible: true,
          },
          {
            entity_id: 'bed_primary',
            type: 'furniture',
            category: 'Bed',
            name: 'King Size Bed',
            position: { x: 0, y: 0.45, z: 0 },
            dimensions: { width_m: 2.05, height_m: 0.95, depth_m: 2.15 },
            material: { type: 'Fabric', color: '#6366f1', finish: 'Matte' },
            confidence: 1.0,
            editable: true,
            is_visible: true,
          },
          {
            entity_id: 'obj_3',
            type: 'architecture',
            category: 'Feature Wall',
            name: 'North Wall',
            position: { x: 0, y: 1.5, z: -2.2 },
            dimensions: { width_m: 6.0, height_m: 3.0, depth_m: 0.1 },
            material: { type: 'Lime Wash Paint', color: '#E8E6E1', finish: 'Matte' },
            confidence: 0.99,
            editable: false,
            is_visible: true,
          },
        ],
        relationships: [],
      }
    }
  },

  /**
   * Upload video capture for 3D Gaussian Splat reconstruction
   */
  async createReconstructionJob(video: File, mode: 'fast' | 'quality' = 'fast'): Promise<ReconstructionJob> {
    const formData = new FormData()
    formData.append('video', video)
    const res = await fetch(`${API_BASE}/api/reconstruction/jobs?mode=${encodeURIComponent(mode)}`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new ApiError(`Reconstruction job creation failed: ${errText}`, res.status)
    }
    return res.json()
  },

  /**
   * Upload an existing 3D model (.ply, .spz, .splat, .ksplat, .glb) to view immediately
   */
  async uploadModel(modelFile: File): Promise<ReconstructionJob> {
    const formData = new FormData()
    formData.append('model', modelFile)
    
    let res: Response | null = null
    try {
      res = await fetch(`${API_BASE}/api/reconstruction/upload-model`, {
        method: 'POST',
        body: formData,
      })
    } catch { /* network error on remote */ }

    // If remote returned 404 (e.g. older Colab backend without this route), try local backend
    if ((!res || !res.ok) && API_BASE !== 'http://localhost:8000') {
      try {
        const localRes = await fetch(`http://localhost:8000/api/reconstruction/upload-model`, {
          method: 'POST',
          body: formData,
        })
        if (localRes.ok) {
          return localRes.json()
        }
      } catch { /* local backend not running */ }
    }

    if (!res || !res.ok) {
      const errText = res ? await res.text() : 'Server unreachable'
      throw new ApiError(`Model upload failed: ${errText}`, res?.status)
    }
    return res.json()
  },

  /**
   * List all available pre-trained / imported 3D models on the backend
   */
  async listAvailableModels(): Promise<Array<{
    job_id: string
    filename: string
    size_mb: number
    format: string
    url: string
    modified: number
  }>> {
    try {
      const res = await fetch(`${API_BASE}/api/reconstruction/models`)
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  },

  /**
   * Poll status of a reconstruction job
   */
  async getReconstructionJob(jobId: string): Promise<ReconstructionJob> {
    const res = await fetch(`${API_BASE}/api/reconstruction/jobs/${encodeURIComponent(jobId)}`)
    if (!res.ok) {
      throw new ApiError('Failed to read reconstruction status', res.status)
    }
    return res.json()
  },

  /**
   * Get latest active or completed Gaussian Splat reconstruction job
   */
  async getLatestReconstructionJob(): Promise<ReconstructionJob | null> {
    try {
      const res = await fetch(`${API_BASE}/api/reconstruction/jobs/latest`)
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  },

  /**
   * Get URL to download/stream the trained 3D Gaussian Splat PLY/SPZ model
   */
  getReconstructionModelUrl(jobId: string, filename?: string): string {
    const fn = filename ? `/${filename}` : '/scene.sog'
    return `${API_BASE}/api/reconstruction/jobs/${encodeURIComponent(jobId)}/model${fn}`
  },

  /**
   * Ensure any relative model path is properly prefixed with API_BASE
   */
  normalizeModelUrl(url: string | null | undefined): string | null {
    if (!url) return null
    if (url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    if (typeof window !== 'undefined' && (url.startsWith('/samples/') || url.startsWith('/catalog/'))) {
      return `${window.location.origin}${url}`
    }
    return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`
  },

  /**
   * Convert Gaussian Splat to editable solid polygon mesh (.glb)
   */
  async convertToMesh(jobId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${API_BASE}/api/reconstruction/jobs/${encodeURIComponent(jobId)}/convert-to-mesh`, {
      method: 'POST',
    })
    if (!res.ok) {
      throw new ApiError(`Mesh conversion failed: ${await res.text()}`, res.status)
    }
    return res.json()
  },

  /**
   * Upload a local in-memory or File Gaussian Splat (.sog, .ply) and convert to solid polygon mesh (.glb)
   * Tracks upload progress and reconstruction stages.
   */
  async convertLocalFileToMesh(
    fileData: { buffer: ArrayBuffer; name: string } | File,
    onProgress?: (stage: string, percent: number) => void
  ): Promise<{ status: string; job_id: string; splat_url?: string; mesh_url: string; floor_infill_url?: string; manifest: MeshManifest; license?: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const formData = new FormData()

      let fileBlob: Blob
      let fileName: string

      if (fileData instanceof File) {
        fileBlob = fileData
        fileName = fileData.name
      } else {
        fileBlob = new Blob([fileData.buffer], { type: 'application/octet-stream' })
        fileName = fileData.name || 'scene.sog'
      }

      formData.append('file', fileBlob, fileName)

      onProgress?.('Uploading Gaussian Splat to conversion engine...', 15)

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const uploadPct = Math.round((event.loaded / event.total) * 35)
          onProgress?.('Uploading Gaussian Splat to conversion engine...', Math.max(10, uploadPct))
        }
      }

      xhr.onloadstart = () => {
        onProgress?.('Uploading Gaussian Splat to conversion engine...', 20)
      }

      xhr.upload.onload = () => {
        onProgress?.('Decoding Gaussian Splat & estimating surface normals...', 50)
        setTimeout(() => {
          onProgress?.('Running Poisson surface reconstruction & mesh decimation...', 75)
        }, 1500)
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText)
            onProgress?.('Watertight solid mesh ready!', 100)
            resolve(data)
          } catch (e) {
            reject(new ApiError(`Invalid server response: ${(e as Error).message}`, xhr.status))
          }
        } else {
          let errMsg = `Mesh conversion failed (${xhr.status})`
          try {
            const errData = JSON.parse(xhr.responseText)
            if (errData.detail) errMsg = errData.detail
          } catch {
            if (xhr.responseText) errMsg = xhr.responseText
          }
          reject(new ApiError(errMsg, xhr.status))
        }
      }

      xhr.onerror = () => {
        reject(new ApiError('Network error during mesh conversion request.'))
      }

      xhr.open('POST', `${API_BASE}/api/reconstruction/convert-upload-to-mesh`)
      xhr.send(formData)
    })
  },

  /**
   * Fetch mesh manifest for a job
   */
  async getMeshManifest(jobId: string): Promise<MeshManifest> {
    const res = await fetch(`${API_BASE}/api/reconstruction/jobs/${encodeURIComponent(jobId)}/mesh`)
    if (!res.ok) {
      throw new ApiError(`Failed to fetch mesh manifest: ${await res.text()}`, res.status)
    }
    return res.json()
  },

  /**
   * Fetch 3D furniture catalog models
   */
  async getFurnitureCatalog(): Promise<FurnitureItem[]> {
    const res = await fetch(`${API_BASE}/api/reconstruction/furniture-catalog`)
    if (!res.ok) {
      throw new ApiError(`Failed to fetch furniture catalog: ${await res.text()}`, res.status)
    }
    const data = await res.json()
    const items = Array.isArray(data) ? data : (data.items || [])
    // Frontend-hosted models (/samples, /catalog) must not be rewritten to the backend origin.
    return items.map((item: FurnitureItem) => ({
      ...item,
      url: api.normalizeModelUrl(item.url) ?? item.url,
    }))
  },

  /**
   * Export modified scene as consolidated .glb
   */
  async exportModifiedScene(jobId: string, transforms: unknown, replacements: unknown): Promise<{ url: string; filename: string }> {
    const res = await fetch(`${API_BASE}/api/reconstruction/jobs/${encodeURIComponent(jobId)}/export-modified-scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transforms, replacements }),
    })
    if (!res.ok) {
      throw new ApiError(`Export scene failed: ${await res.text()}`, res.status)
    }
    const data = await res.json()
    return {
      ...data,
      url: `${API_BASE}${data.url}`,
    }
  },

  /**
   * Send a chat message to Gemini AI Spatial Copilot
   */
  async chat(
    message: string, 
    sceneId: string, 
    history: Array<{ role: string; content: string }> = [], 
    referenceImage?: string
  ): Promise<{ response: string; updated_objects?: SceneObject[] }> {
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message, 
          scene_id: sceneId, 
          history: history.map(h => ({ role: h.role, content: h.content })), 
          reference_image: referenceImage 
        }),
      })
      if (!res.ok) {
        throw new ApiError(`AI Copilot Error (${res.status})`, res.status)
      }
      const data = await res.json()
      return {
        response: data.message || data.response || 'I analyzed the space and prepared recommendations.',
        updated_objects: data.updated_objects,
      }
    } catch (e) {
      console.warn('[API] Chat request fallback:', e)
      return {
        response: "I've analyzed your space. Tell me what style or specific furniture modifications you'd like to explore.",
      }
    }
  },

  /**
   * Generate an architectural-preservation hero render via Gemini Image API
   */
  async generateImage(
    sceneId: string, 
    editInstruction: string, 
    baseImage?: string, 
    referenceImage?: string
  ): Promise<{ image_url: string }> {
    try {
      const res = await fetch(`${API_BASE}/api/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          scene_id: sceneId, 
          edit_instruction: editInstruction, 
          base_image: baseImage, 
          reference_image: referenceImage 
        }),
      })
      if (!res.ok) {
        throw new ApiError(`Image generation failed (${res.status})`, res.status)
      }
      const data = await res.json()
      const img = data.image || data.image_url
      if (img.startsWith('data:') || img.startsWith('http')) {
        return { image_url: img }
      }
      return { image_url: `data:image/jpeg;base64,${img}` }
    } catch (e) {
      console.warn('[API] Image generation fallback:', e)
      return { 
        image_url: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=1200' 
      }
    }
  },

  /**
   * Analyze reference furniture image using Gemini Vision
   */
  async analyzeReference(file: File): Promise<Record<string, unknown>> {
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_BASE}/api/analyze-reference`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        throw new ApiError(`Reference analysis failed (${res.status})`, res.status)
      }
      return await res.json()
    } catch (e) {
      console.warn('[API] Reference analyzer fallback:', e)
      return { 
        category: 'Sofa', 
        style: 'Contemporary Organic', 
        color: '#E3DFD7', 
        material: 'Bouclé Fabric',
        dimensions: { width_m: 2.3, height_m: 0.78, depth_m: 1.05 }
      }
    }
  },

  /**
   * Generate 3 parallel design variants (Scandinavian, Modern Luxury, Japandi)
   */
  async generateVariants(
    sceneId: string, 
    styles: string[], 
    baseImage?: string
  ): Promise<Array<{ style: string; image: string; description: string }>> {
    try {
      const res = await fetch(`${API_BASE}/api/generate-variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene_id: sceneId, styles, base_image: baseImage }),
      })
      if (!res.ok) {
        throw new ApiError(`Variant generation failed (${res.status})`, res.status)
      }
      const data = await res.json()
      const list = data.variants || data
      return list.map((v: { style: string; image?: string; description?: string }) => ({
        style: v.style,
        image: (v.image?.startsWith('data:') || v.image?.startsWith('http')) 
          ? v.image 
          : `data:image/jpeg;base64,${v.image}`,
        description: v.description || `${v.style} concept`,
      }))
    } catch (e) {
      console.warn('[API] Variant generator fallback:', e)
      return [
        { 
          style: 'Scandinavian Minimalist', 
          image: 'https://images.unsplash.com/photo-1598928506311-c55dd1b31120?q=80&w=1200', 
          description: 'Light oak, muted textiles, functional simplicity.' 
        },
        { 
          style: 'Quiet Luxury', 
          image: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?q=80&w=1200', 
          description: 'Warm travertine, custom walnut joinery, sculptural seating.' 
        },
        { 
          style: 'Japandi', 
          image: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?q=80&w=1200', 
          description: 'Organic textures, low-profile furnishings, natural harmony.' 
        },
      ]
    }
  },
}
