/**
 * Read-only furniture catalog for the spatial agent: merges public/catalog/catalogManifest.json
 * and the backend furniture catalog into one shape, and ranks entries by similarity to a query
 * (category, style tags, colour, size, free text).
 */
import { categoryIs } from '@/lib/placement';

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  subType?: string;
  styleTags: string[];
  colorHex?: string;
  url: string;
  dimensions: { width: number; height: number; depth: number };
  origin: 'public' | 'backend';
  description?: string;
}

export interface CatalogQuery {
  text?: string;
  category?: string;
  styleTags?: string[];
  colorHex?: string;
  /** Target size [w, h, d] in meters, e.g. the item being replaced or the size seen in a photo. */
  dimensions?: [number, number, number];
  limit?: number;
}

export interface CatalogMatch {
  entry: CatalogEntry;
  score: number;
  reasons: string[];
}

interface PublicManifestAsset {
  id: string;
  name: string;
  category: string;
  subType?: string;
  dimensions?: number[];
  modelUrl: string;
  defaultColorHex?: string;
  materialType?: string;
  styleTags?: string[];
}

interface BackendCatalogItem {
  id: string;
  name: string;
  category: string;
  style?: string;
  description?: string;
  color_preview?: string;
  url: string;
  dimensions?: { width_m?: number; height_m?: number; depth_m?: number };
}

const tokens = (s: string | undefined): string[] =>
  (s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

export function catalogFromPublicManifest(manifest: { assets?: PublicManifestAsset[] }): CatalogEntry[] {
  return (manifest.assets ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category.toLowerCase(),
    subType: a.subType,
    styleTags: [...(a.styleTags ?? []), ...tokens(a.materialType)].map((t) => t.toLowerCase()),
    colorHex: a.defaultColorHex,
    url: a.modelUrl,
    dimensions: { width: a.dimensions?.[0] ?? 1, height: a.dimensions?.[1] ?? 1, depth: a.dimensions?.[2] ?? 1 },
    origin: 'public',
  }));
}

/** Backend URLs are relative to the API host; `apiBase` makes them absolute. */
export function catalogFromBackend(items: BackendCatalogItem[], apiBase = ''): CatalogEntry[] {
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category.toLowerCase(),
    styleTags: [...tokens(i.style), ...tokens(i.description)],
    colorHex: i.color_preview,
    url: i.url.startsWith('/') ? `${apiBase}${i.url}` : i.url,
    dimensions: {
      width: i.dimensions?.width_m ?? 1,
      height: i.dimensions?.height_m ?? 1,
      depth: i.dimensions?.depth_m ?? 1,
    },
    origin: 'backend',
    description: i.description,
  }));
}

/** Merges catalogs, first occurrence of an id wins. */
export function mergeCatalogs(...lists: CatalogEntry[][]): CatalogEntry[] {
  const seen = new Set<string>();
  return lists.flat().filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

const RELATED: Record<string, string[]> = {
  chair: ['armchair', 'stool', 'seat'],
  armchair: ['chair', 'lounge'],
  sofa: ['couch', 'loveseat'],
  table: ['desk'],
};

function categoryScore(entry: CatalogEntry, category: string): number {
  const c = category.toLowerCase();
  if (entry.category === c) return 1;
  if (categoryIs(entry.category, c) || categoryIs(c, entry.category)) return 0.7;
  if ((RELATED[c] ?? []).some((r) => categoryIs(entry.category, r) || entry.subType?.includes(r))) return 0.5;
  if (entry.subType && categoryIs(entry.subType, c)) return 0.7;
  return 0;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function colorSimilarity(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return 0;
  const d = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  return 1 - d / Math.hypot(255, 255, 255);
}

export function sizeSimilarity(a: [number, number, number], b: [number, number, number]): number {
  const rel = a.map((v, i) => Math.abs(v - b[i]) / Math.max(v, b[i], 1e-6));
  return Math.max(0, 1 - rel.reduce((s, r) => s + r, 0) / 3);
}

/** Ranks catalog entries by weighted similarity; entries of an unrelated category are dropped when a category is given. */
export function searchCatalog(catalog: CatalogEntry[], query: CatalogQuery): CatalogMatch[] {
  const queryTokens = tokens(query.text);
  const styles = (query.styleTags ?? []).map((s) => s.toLowerCase());
  const matches: CatalogMatch[] = [];
  for (const entry of catalog) {
    const reasons: string[] = [];
    let score = 0;
    let weight = 0;
    if (query.category) {
      const c = categoryScore(entry, query.category);
      if (c === 0) continue;
      score += 0.45 * c;
      weight += 0.45;
      reasons.push(c === 1 ? `category ${entry.category}` : `related category ${entry.category}`);
    }
    if (styles.length) {
      const shared = styles.filter((s) => entry.styleTags.includes(s) || entry.subType === s);
      score += (0.2 * shared.length) / styles.length;
      weight += 0.2;
      if (shared.length) reasons.push(`style ${shared.join(', ')}`);
    }
    if (query.colorHex && entry.colorHex) {
      const c = colorSimilarity(query.colorHex, entry.colorHex);
      score += 0.15 * c;
      weight += 0.15;
      if (c > 0.8) reasons.push(`colour close to ${query.colorHex}`);
    }
    if (query.dimensions) {
      const d = entry.dimensions;
      const s = sizeSimilarity(query.dimensions, [d.width, d.height, d.depth]);
      score += 0.15 * s;
      weight += 0.15;
      if (s > 0.8) reasons.push('similar size');
    }
    if (queryTokens.length) {
      const hay = new Set([...tokens(entry.name), ...tokens(entry.category), ...entry.styleTags, ...tokens(entry.subType)]);
      const hits = queryTokens.filter((t) => hay.has(t));
      score += (0.2 * hits.length) / queryTokens.length;
      weight += 0.2;
      if (hits.length) reasons.push(`matches "${hits.join(' ')}"`);
    }
    matches.push({ entry, score: weight ? Number((score / weight).toFixed(4)) : 0, reasons });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, query.limit ?? 5);
}

export function findCatalogEntryByUrl(catalog: CatalogEntry[], url: string): CatalogEntry | undefined {
  return catalog.find((e) => e.url === url);
}
