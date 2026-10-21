import { NextRequest, NextResponse } from 'next/server';
import catalogManifest from '@/public/catalog/catalogManifest.json';
import { handleSpatialRequest, SpatialRequestSchema } from '@/lib/ai/agent';
import { catalogFromBackend, catalogFromPublicManifest, mergeCatalogs, type CatalogEntry } from '@/lib/ai/catalog';
import { DEFAULT_GEMINI_MODEL, GeminiModel } from '@/lib/ai/geminiModel';
import { HeuristicModel } from '@/lib/ai/heuristicModel';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function loadCatalog(): Promise<CatalogEntry[]> {
  const local = catalogFromPublicManifest(catalogManifest);
  try {
    const res = await fetch(`${API_BASE}/api/reconstruction/furniture-catalog`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return local;
    return mergeCatalogs(local, catalogFromBackend(await res.json(), API_BASE));
  } catch {
    return local;
  }
}

/**
 * Returns EditProposals for the user to review. Nothing here changes the scene; the client
 * applies a proposal only when the user accepts it.
 */
export async function POST(req: NextRequest) {
  const parsed = SpatialRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const catalog = await loadCatalog();
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const model = new GeminiModel(apiKey, process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
      return NextResponse.json(await handleSpatialRequest(parsed.data, { model, catalog }));
    } catch (err) {
      console.warn('[Spatial API] Gemini failed; using the offline planner:', err instanceof Error ? err.message : err);
    }
  }

  try {
    return NextResponse.json(await handleSpatialRequest(parsed.data, { model: new HeuristicModel(), catalog }));
  } catch (err) {
    console.error('[Spatial API] Error processing request:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal spatial processing error' }, { status: 500 });
  }
}
