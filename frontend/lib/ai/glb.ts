/**
 * Measures an uploaded GLB without a renderer: reads the JSON chunk, walks the default scene's
 * node hierarchy and transforms each POSITION accessor's min/max box into world space.
 * Unit heuristics (mm / cm authoring) come from normalizeGlbBounds.
 */
import { normalizeGlbBounds } from '@/lib/pascal/itemEditing';

type Mat4 = number[];

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major multiply a * b (glTF convention). */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function localMatrix(node: GltfNode): Mat4 {
  if (node.matrix?.length === 16) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

const apply = (m: Mat4, p: number[]): number[] => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

export function parseGlbJson(bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  const chunkLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB first chunk is not JSON');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength)));
}

/** Raw world-space bounds of the default scene, in the file's own units. */
export function glbBounds(json: GltfJson): { min: [number, number, number]; max: [number, number, number] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (index: number, parent: Mat4, depth: number) => {
    const node = json.nodes?.[index];
    if (!node || depth > 64) return;
    const world = multiply(parent, localMatrix(node));
    for (const prim of node.mesh !== undefined ? json.meshes?.[node.mesh]?.primitives ?? [] : []) {
      const acc = json.accessors?.[prim.attributes.POSITION];
      if (!acc?.min || !acc.max) continue;
      for (let i = 0; i < 8; i++) {
        const corner = [i & 1 ? acc.max[0] : acc.min[0], i & 2 ? acc.max[1] : acc.min[1], i & 4 ? acc.max[2] : acc.min[2]];
        const p = apply(world, corner);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[k]);
          max[k] = Math.max(max[k], p[k]);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes?.map((_, i) => i) ?? [];
  for (const r of roots) visit(r, IDENTITY, 0);
  if (!Number.isFinite(min[0])) throw new Error('GLB has no measurable geometry (POSITION accessors need min/max)');
  return { min: min as [number, number, number], max: max as [number, number, number] };
}

/** Dimensions [w, h, d] in meters of a GLB file. */
export function measureGlb(bytes: Uint8Array): [number, number, number] {
  const { min, max } = glbBounds(parseGlbJson(bytes));
  return normalizeGlbBounds(min, max).dimensions.map((v) => Number(v.toFixed(3))) as [number, number, number];
}

export function bytesFromDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
