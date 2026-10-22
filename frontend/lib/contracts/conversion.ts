import { z } from 'zod';
import { Matrix4Schema, OrientedBoundingBoxSchema, Vector3Schema } from './primitives';
import { RoomInterpretationSchema } from './interpretation';
import { AssetRefSchema } from './manifest';

/** Room-structure output: interpretation in the scene frame plus the suggested scan placement. */
export const RoomStructureResultSchema = z.object({
  interpretation: RoomInterpretationSchema,
  scanToScene: Matrix4Schema,
  gravityConfidence: z.number().min(0).max(1),
  manhattan: z.boolean(),
  diagnostics: z.record(z.string(), z.unknown()).optional(),
});
export type RoomStructureResult = z.infer<typeof RoomStructureResultSchema>;

export const ConversionStageNameSchema = z.enum(['uploaded', 'structure', 'objects', 'ready']);
export type ConversionStageName = z.infer<typeof ConversionStageNameSchema>;

export const ConversionStageSchema = z.object({
  name: ConversionStageNameSchema,
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  detail: z.string().optional(),
  error: z.string().nullable().optional(),
});
export type ConversionStage = z.infer<typeof ConversionStageSchema>;

/** World pose of a segmented object's mesh: bottom-centre position and yaw (scene frame). */
export const ObjectPlacementSchema = z.object({
  position: Vector3Schema,
  rotationY: z.number(),
});
export type ObjectPlacement = z.infer<typeof ObjectPlacementSchema>;

/** One object separated from the splat by the GPU worker (ADR 002), with its own GLB. */
export const SegmentedObjectSchema = z.object({
  id: z.string(),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  meshAsset: AssetRefSchema,
  placement: ObjectPlacementSchema,
  obb: OrientedBoundingBoxSchema,
  maskRegionId: z.string().nullable().optional(),
});
export type SegmentedObject = z.infer<typeof SegmentedObjectSchema>;

/** Baked floor/wall appearance in Pascal's world-planar UV frame (material.texture.url + repeat). */
export const ShellSurfaceTextureSchema = z.object({
  target: z.enum(['slab', 'wall', 'ceiling']),
  wallId: z.string().nullable().optional(),
  textureAsset: z.string(),
  repeat: z.tuple([z.number(), z.number()]),
  coverage: z.number().min(0).max(1),
});
export type ShellSurfaceTexture = z.infer<typeof ShellSurfaceTextureSchema>;

/** Splat import → editable room. `objects` runs on the GPU segmentation worker. */
export const ConversionJobStatusSchema = z.object({
  jobId: z.string(),
  projectId: z.string(),
  scanAssetId: z.string(),
  pointsAssetId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  stage: ConversionStageNameSchema,
  stages: z.array(ConversionStageSchema),
  progress: z.number().int().optional(),
  error: z.string().nullable().optional(),
  result: RoomStructureResultSchema.nullable().optional(),
  objectsCount: z.number().int().nullable().optional(),
  objects: z.array(SegmentedObjectSchema).optional(),
  surfaces: z.array(ShellSurfaceTextureSchema).optional(),
});
export type ConversionJobStatus = z.infer<typeof ConversionJobStatusSchema>;
