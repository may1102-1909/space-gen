import { z } from 'zod';
import { HeroImageSchema, SceneKindSchema, ScanAssetSchema, ViewpointSchema } from '@/lib/contracts';

/** The sanitized, read-only project served by GET /api/share/{token}. */
export const SharedProjectSchema = z.object({
  name: z.string(),
  updatedAt: z.string(),
  scan: ScanAssetSchema,
  sceneSnapshot: z.record(z.string(), z.any()),
  activeVariantId: z.string(),
  variants: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().nullable().optional(), sceneSnapshot: z.record(z.string(), z.any()) })),
  viewpoints: z.array(ViewpointSchema),
  heroImages: z.array(HeroImageSchema),
  sceneKind: SceneKindSchema.nullable().optional(),
  assets: z.array(z.object({
    id: z.string(), name: z.string(), url: z.string(),
    dimensions: z.object({ width: z.number(), height: z.number(), depth: z.number() }),
    categories: z.array(z.string()), productUrl: z.string().nullable().optional(),
  })),
});
export type SharedProject = z.infer<typeof SharedProjectSchema>;
type Snapshot = Record<string, unknown>;

export interface ResolvedVariant {
  id: string;
  name: string;
  sceneSnapshot: Snapshot;
}

const isEmpty = (snapshot: Snapshot | undefined) => !snapshot || Object.keys(snapshot).length === 0;

/**
 * The scenes a client can flip between. The live scene is the source of truth for the active
 * variant; variants without any scene are dropped; with no variants the single scene is shown.
 */
export function resolveVariants(project: SharedProject): ResolvedVariant[] {
  const resolved = project.variants.flatMap((v): ResolvedVariant[] => {
    const snapshot = v.id === project.activeVariantId && !isEmpty(project.sceneSnapshot) ? project.sceneSnapshot : v.sceneSnapshot;
    return isEmpty(snapshot) ? [] : [{ id: v.id, name: v.name, sceneSnapshot: snapshot }];
  });
  return resolved.length ? resolved : [{ id: 'scene', name: 'Design', sceneSnapshot: project.sceneSnapshot }];
}

/** Links come from user-editable metadata: only plain http(s) is ever rendered as a link. */
export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export interface PresentedItem {
  id: string;
  name: string;
  dimensions: [number, number, number] | null;
  productUrl: string | null;
}

interface ItemNode {
  id: string;
  type: string;
  name?: string;
  metadata?: { productUrl?: unknown };
  asset?: { src?: string; name?: string; dimensions?: number[] };
}

const pathOf = (url: string) => {
  try { return new URL(url, 'http://local').pathname; } catch { return url; }
};

/** Placed items, each with a product link from node metadata, the project's asset refs, or catalog metadata (by model path). */
export function listItems(snapshot: Snapshot, assets: SharedProject['assets'], catalogLinks: Record<string, string>): PresentedItem[] {
  const nodes = Object.values((snapshot.nodes ?? {}) as Record<string, ItemNode>);
  return nodes.filter((n) => n?.type === 'item').map((n) => {
    const src = n.asset?.src ?? '';
    const dims = n.asset?.dimensions;
    return {
      id: n.id,
      name: n.name || n.asset?.name || 'Item',
      dimensions: dims && dims.length === 3 ? [dims[0], dims[1], dims[2]] : null,
      productUrl: safeWebUrl(n.metadata?.productUrl) ?? safeWebUrl(assets.find((a) => src && a.url === src)?.productUrl) ?? safeWebUrl(src ? catalogLinks[pathOf(src)] : undefined),
    };
  });
}

/** modelUrl path -> productUrl from public/catalog/catalogManifest.json (entries without a link are skipped). */
export function catalogProductLinks(manifest: { assets?: Array<{ modelUrl?: string; productUrl?: string }> }): Record<string, string> {
  const links: Record<string, string> = {};
  for (const a of manifest.assets ?? []) if (a.modelUrl && a.productUrl) links[pathOf(a.modelUrl)] = a.productUrl;
  return links;
}
