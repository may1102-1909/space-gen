import { z } from 'zod';
import { MaskRegionSchema, ScanAssetSchema } from './scan';
import { RoomInterpretationSchema } from './interpretation';
import {
  AssetSourceSchema,
  EditRecordSchema,
  ProposalAssetDimensionsSchema,
} from './proposal';

export const AssetFormatSchema = z.enum(['glb', 'gltf']);
export type AssetFormat = z.infer<typeof AssetFormatSchema>;

export const AssetRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: AssetSourceSchema,
  url: z.string(),
  format: AssetFormatSchema,
  dimensions: ProposalAssetDimensionsSchema,
  categories: z.array(z.string()),
  thumbnail: z.string().nullable().optional(),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const VariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  sceneSnapshot: z.record(z.string(), z.any()),
  createdAt: z.string(),
  parentVariantId: z.string().nullable().optional(),
});
export type Variant = z.infer<typeof VariantSchema>;

export const ProjectManifestSchema = z.object({
  schemaVersion: z.string(),
  id: z.string(),
  name: z.string(),
  scan: ScanAssetSchema,
  interpretation: RoomInterpretationSchema,
  maskRegions: z.array(MaskRegionSchema).default([]),
  sceneSnapshot: z.record(z.string(), z.any()),
  assets: z.array(AssetRefSchema),
  history: z.array(EditRecordSchema),
  variants: z.array(VariantSchema),
  activeVariantId: z.string(),
});
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;
