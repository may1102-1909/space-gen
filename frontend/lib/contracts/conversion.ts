import { z } from 'zod';
import { Matrix4Schema } from './primitives';
import { RoomInterpretationSchema } from './interpretation';

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
});
export type ConversionStage = z.infer<typeof ConversionStageSchema>;

/** Splat import → editable room. `objects` waits on the GPU segmentation worker. */
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
});
export type ConversionJobStatus = z.infer<typeof ConversionJobStatusSchema>;
