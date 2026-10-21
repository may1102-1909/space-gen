/**
 * Entry point shared by the API route and the evals: validates the request, builds the
 * read-only agent context from Pascal nodes + room interpretation, prepares attachments
 * (GLB measurement, reference-photo vision) and runs the agent.
 */
import { z } from 'zod';
import { RoomInterpretationSchema } from '@/lib/contracts';
import { interpretationFromPascalNodes, sceneFromPascalNodes } from '@/lib/placement';
import type { CatalogEntry } from './catalog';
import { runSpatialAgent, type AgentResult } from './executor';
import { bytesFromDataUrl, measureGlb } from './glb';
import type { InlineImage, SpatialModel } from './model';
import type { AgentContext, UploadedAsset } from './tools';
import { describeReferencePhoto, parseDataUrlImage, type VisualDescriptors } from './vision';

export const SpatialRequestSchema = z.object({
  prompt: z.string().max(4000),
  /** Plain Pascal nodes (useScene.getState().nodes), filtered to editable/structural types by the client. */
  nodes: z.record(z.string(), z.unknown()),
  interpretation: RoomInterpretationSchema.optional(),
  selectedIds: z.array(z.string()).default([]),
  attachment: z
    .object({
      type: z.enum(['image', 'glb']),
      dataUrl: z.string().optional(),
      name: z.string().optional(),
      /** Project asset-store URL of an uploaded GLB; proposals reference it. */
      url: z.string().optional(),
      /** Dimensions measured on the client, used when no dataUrl is sent. */
      dimensions: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(),
    })
    .optional(),
});
export type SpatialRequest = z.infer<typeof SpatialRequestSchema>;

export interface SpatialResponse extends AgentResult {
  notes: string[];
}

export function buildAgentContext(
  request: SpatialRequest,
  catalog: CatalogEntry[],
  extras: { upload?: UploadedAsset; reference?: VisualDescriptors } = {},
): AgentContext {
  const nodes = request.nodes as Record<string, unknown>;
  return {
    scene: sceneFromPascalNodes(nodes),
    interpretation: request.interpretation ?? interpretationFromPascalNodes(nodes),
    interpretationSource: request.interpretation ? 'scan' : 'pascal',
    catalog,
    selectedIds: request.selectedIds,
    ...extras,
  };
}

export async function handleSpatialRequest(
  request: SpatialRequest,
  deps: { model: SpatialModel; catalog: CatalogEntry[]; idPrefix?: string },
): Promise<SpatialResponse> {
  const notes: string[] = [];
  let upload: UploadedAsset | undefined;
  let reference: VisualDescriptors | undefined;
  let image: InlineImage | undefined;
  const att = request.attachment;

  if (att?.type === 'glb') {
    try {
      const dimensions = att.dataUrl ? measureGlb(bytesFromDataUrl(att.dataUrl)) : att.dimensions;
      if (!dimensions) throw new Error('no GLB data or dimensions');
      upload = { name: att.name ?? 'Uploaded model', url: att.url ?? att.name ?? 'upload.glb', dimensions };
      notes.push(`Measured uploaded model: ${dimensions.join(' x ')} m`);
    } catch (err) {
      notes.push(`Could not measure the uploaded GLB: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (att?.type === 'image' && att.dataUrl) {
    image = parseDataUrlImage(att.dataUrl) ?? undefined;
    if (image) {
      try {
        reference = (await describeReferencePhoto(deps.model, image, request.prompt)).descriptors;
      } catch (err) {
        notes.push(`Reference photo analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const context = buildAgentContext(request, deps.catalog, { upload, reference });
  const result = await runSpatialAgent({ model: deps.model, context, prompt: request.prompt, image, idPrefix: deps.idPrefix ?? `proposal_${Date.now().toString(36)}` });
  return { ...result, notes };
}
