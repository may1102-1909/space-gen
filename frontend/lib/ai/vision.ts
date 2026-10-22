/**
 * Reference-photo understanding: a vision call returns structured descriptors
 * (category, style, colour, size) that drive a catalog similarity search.
 * Generating a new 3D model from the photo sits behind ImageTo3DGenerator and is not implemented.
 */
import { z } from 'zod';
import type { InlineImage, JsonSchema, ModelUsage, SpatialModel } from './model';

export const VisualDescriptorsSchema = z.object({
  category: z.string(),
  subType: z.string().optional(),
  styleTags: z.array(z.string()),
  primaryColorHex: z.string().optional(),
  primaryMaterial: z.string().optional(),
  /** [w, h, d] meters, estimated from the photo. */
  estimatedDimensions: z.tuple([z.number(), z.number(), z.number()]).optional(),
});
export type VisualDescriptors = z.infer<typeof VisualDescriptorsSchema>;

export const VISUAL_DESCRIPTORS_JSON_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    category: { type: 'string', description: 'snake_case furniture category, e.g. chair, sofa, coffee_table, dining_table, bed, lamp' },
    subType: { type: 'string', description: 'e.g. dining_chair, lounge_chair, fabric_sofa' },
    styleTags: { type: 'array', items: { type: 'string' }, description: 'lowercase style words, e.g. scandinavian, mid_century, leather' },
    primaryColorHex: { type: 'string', description: '#rrggbb of the dominant colour' },
    primaryMaterial: { type: 'string' },
    estimatedDimensions: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[width, height, depth] meters' },
  },
  required: ['category', 'styleTags'],
};

const VISION_SYSTEM = `You identify the single main furniture piece in an interior reference photo.
Return its category, style tags, dominant colour and an estimated real-world size in meters.`;

export async function describeReferencePhoto(
  model: SpatialModel,
  image: InlineImage,
  hint: string,
): Promise<{ descriptors: VisualDescriptors; usage?: ModelUsage }> {
  const { value, usage } = await model.generateJson({
    system: VISION_SYSTEM,
    messages: [{ role: 'user', text: `Describe the furniture in this photo. User request: "${hint}"`, image }],
    schema: VISUAL_DESCRIPTORS_JSON_SCHEMA,
  });
  return { descriptors: VisualDescriptorsSchema.parse(value), usage };
}

/** Keyword fallback when no vision model is available: reads category/style from the user's words. */
export function descriptorsFromHint(hint: string): VisualDescriptors {
  const h = hint.toLowerCase();
  const category = /sofa|couch/.test(h)
    ? 'sofa'
    : /coffee table/.test(h)
      ? 'coffee_table'
      : /dining table/.test(h)
        ? 'dining_table'
        : /\bbed\b/.test(h)
          ? 'bed'
          : 'chair';
  const styleTags = ['scandinavian', 'minimalist', 'mid_century', 'leather', 'luxury', 'modern', 'industrial', 'velvet', 'boucle', 'oak', 'walnut']
    .filter((t) => h.includes(t.replace('_', ' ')) || h.includes(t));
  if (/lounge|armchair/.test(h)) styleTags.push('lounge');
  const subType = category === 'chair' ? (/lounge|armchair/.test(h) ? 'lounge_chair' : 'dining_chair') : undefined;
  return { category, subType, styleTags };
}

export function parseDataUrlImage(dataUrl: string): InlineImage | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

/** Image-to-3D generation (e.g. a hosted reconstruction service). */
export interface ImageTo3DGenerator {
  generate(image: InlineImage, descriptors: VisualDescriptors): Promise<{ url: string; dimensions: [number, number, number] }>;
}

export class UnimplementedImageTo3D implements ImageTo3DGenerator {
  async generate(): Promise<never> {
    throw new Error('Generating a 3D model from a photo is not implemented; the agent proposes the closest catalog asset.');
  }
}
