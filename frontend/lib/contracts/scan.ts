import { z } from 'zod';
import {
  BoundingBox3DSchema,
  Matrix4Schema,
  OrientedBoundingBoxSchema,
} from './primitives';

export const ScanFormatSchema = z.enum(['sog', 'spz', 'ply', 'splat']);
export type ScanFormat = z.infer<typeof ScanFormatSchema>;

export const ScaleSourceSchema = z.enum(['none', 'user_measurement', 'sensor']);
export type ScaleSource = z.infer<typeof ScaleSourceSchema>;

export const ScanAssetSchema = z.object({
  url: z.string(),
  format: ScanFormatSchema,
  scanToScene: Matrix4Schema,
  scaleSource: ScaleSourceSchema,
  bounds: BoundingBox3DSchema,
});
export type ScanAsset = z.infer<typeof ScanAssetSchema>;

export const MaskRegionSchema = z.object({
  id: z.string(),
  obb: OrientedBoundingBoxSchema,
  feather: z.number().nonnegative(),
  enabled: z.boolean(),
});
export type MaskRegion = z.infer<typeof MaskRegionSchema>;
