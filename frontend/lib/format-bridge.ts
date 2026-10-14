/**
 * SpaceGen Format Detection & Engine Routing
 * 
 * Detects 3D file formats from buffer contents and URL extensions,
 * then routes to the appropriate rendering engine.
 * 
 * @license MIT — see THIRD_PARTY_LICENSES.md
 */

export type RenderEngine = 'aholo' | 'mesh' | 'unsupported'

export type AholoFileType = 'ply' | 'spz' | 'splat' | 'ksplat' | 'sog' | 'lcc' | 'esz'
export type MeshFileType = 'glb' | 'gltf' | 'obj'

export interface FormatDetectionResult {
  engine: RenderEngine
  aholoType?: AholoFileType
  meshType?: MeshFileType
  isStandardPlyMesh?: boolean
  errorReason?: string
}

/**
 * Detect the file format from buffer content and filename.
 */
export function detectFormat(buffer: ArrayBuffer, filenameOrUrl: string): FormatDetectionResult {
  const lower = filenameOrUrl.toLowerCase().split('?')[0].split('#')[0]
  const ext = lower.split('.').pop() || ''
  const uint8 = new Uint8Array(buffer.slice(0, 64))
  const magic4 = safeDecodeText(buffer.slice(0, 4))
  const headerText = safeDecodeText(buffer.slice(0, Math.min(8192, buffer.byteLength)))

  // 1. Binary glTF (.glb) — Magic: 'glTF' (0x67 0x6c 0x54 0x46)
  if (
    (uint8[0] === 0x67 && uint8[1] === 0x6c && uint8[2] === 0x54 && uint8[3] === 0x46) ||
    ext === 'glb'
  ) {
    return { engine: 'mesh', meshType: 'glb' }
  }

  // 2. JSON glTF (.gltf)
  if (
    ext === 'gltf' ||
    (headerText.trim().startsWith('{') && headerText.includes('"asset"'))
  ) {
    return { engine: 'mesh', meshType: 'gltf' }
  }

  // 3. Wavefront OBJ (.obj)
  if (
    ext === 'obj' ||
    (!magic4.startsWith('glTF') && headerText.startsWith('#') && (headerText.includes('v ') || headerText.includes('vn ')))
  ) {
    return { engine: 'mesh', meshType: 'obj' }
  }

  // 4. PLY format — must inspect if it's 3DGS or standard mesh / point cloud
  if (magic4.startsWith('ply') || ext === 'ply') {
    const is3DGS = detect3DGSPly(headerText)
    if (is3DGS) {
      return { engine: 'aholo', aholoType: 'ply' }
    }
    // Ordinary mesh or point cloud PLY
    return {
      engine: 'unsupported',
      isStandardPlyMesh: true,
      errorReason: 'This PLY file is a standard polygon mesh or point cloud without 3D Gaussian Splatting attributes (f_dc_0, scale_0, rot_0). Aholo Viewer requires 3DGS PLY files. For regular 3D models, switch to Solid Mesh mode or use GLB/OBJ.',
    }
  }

  // 5. SPZ format (Compressed Gaussian Splats)
  if (ext === 'spz' || magic4.startsWith('SPZ') || (uint8[0] === 0x1f && uint8[1] === 0x8b && ext === 'spz')) {
    return { engine: 'aholo', aholoType: 'spz' }
  }

  // 6. SOG format (Scene Object Graph)
  if (ext === 'sog' || lower.includes('.sog')) {
    return { engine: 'aholo', aholoType: 'sog' }
  }

  // 7. KSPLAT format
  if (ext === 'ksplat') {
    return { engine: 'aholo', aholoType: 'ksplat' }
  }

  // 8. LCC format
  if (ext === 'lcc') {
    return { engine: 'aholo', aholoType: 'lcc' }
  }

  // 9. ESZ format
  if (ext === 'esz') {
    return { engine: 'aholo', aholoType: 'esz' }
  }

  // 10. Raw .splat format
  if (
    ext === 'splat' ||
    (buffer.byteLength > 0 && buffer.byteLength % 32 === 0 && !headerText.startsWith('ply'))
  ) {
    return { engine: 'aholo', aholoType: 'splat' }
  }

  // 11. ZIP format containing SOG or LCC
  if (ext === 'zip') {
    return { engine: 'aholo', aholoType: 'sog' }
  }

  return {
    engine: 'unsupported',
    errorReason: `Unsupported file format (.${ext || 'unknown'}). Supported formats are: 3DGS PLY (.ply), SPZ (.spz), SPLAT (.splat), KSPLAT (.ksplat), SOG (.sog), LCC (.lcc), ESZ (.esz).`,
  }
}

/**
 * Check if a PLY file contains 3D Gaussian Splatting data
 * by looking for specific properties in the header.
 */
function detect3DGSPly(headerText: string): boolean {
  const headerEnd = headerText.indexOf('end_header')
  if (headerEnd === -1) return false
  const header = headerText.substring(0, headerEnd)
  // 3DGS PLY files contain spherical harmonic coefficients or covariance properties
  return (
    header.includes('f_dc_0') ||
    header.includes('rot_0') ||
    header.includes('scale_0') ||
    (header.includes('opacity') && header.includes('scale'))
  )
}

function safeDecodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder().decode(buffer)
  } catch {
    return ''
  }
}
