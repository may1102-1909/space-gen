import { z } from 'zod';
import {
  OrientedBoundingBoxSchema,
  ProvenanceSchema,
  Vector3Schema,
} from './primitives';

export const FloorPlaneSchema = z.object({
  normal: Vector3Schema,
  constant: z.number(),
  provenance: ProvenanceSchema,
});
export type FloorPlane = z.infer<typeof FloorPlaneSchema>;

export const WallInterpretationSchema = z.object({
  id: z.string(),
  start: Vector3Schema,
  end: Vector3Schema,
  height: z.number().positive(),
  thickness: z.number().positive(),
  confidence: z.number().min(0).max(1),
  provenance: ProvenanceSchema,
});
export type WallInterpretation = z.infer<typeof WallInterpretationSchema>;

export const OpeningKindSchema = z.enum(['door', 'window', 'opening']);
export type OpeningKind = z.infer<typeof OpeningKindSchema>;

export const OpeningInterpretationSchema = z.object({
  id: z.string(),
  wallId: z.string(),
  kind: OpeningKindSchema,
  offset: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  sill: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  provenance: ProvenanceSchema,
});
export type OpeningInterpretation = z.infer<typeof OpeningInterpretationSchema>;

export const DetectionStatusSchema = z.enum([
  'auto',
  'verified',
  'corrected',
  'rejected',
]);
export type DetectionStatus = z.infer<typeof DetectionStatusSchema>;

export const DetectionInterpretationSchema = z.object({
  id: z.string(),
  category: z.string(),
  label: z.string(),
  obb: OrientedBoundingBoxSchema,
  confidence: z.number().min(0).max(1),
  maskRegionId: z.string().nullable().optional(),
  status: DetectionStatusSchema,
  provenance: ProvenanceSchema,
});
export type DetectionInterpretation = z.infer<typeof DetectionInterpretationSchema>;

export const Point2DSchema = z.tuple([z.number(), z.number()]);
export type Point2D = z.infer<typeof Point2DSchema>;

export const RoomInterpretationSchema = z.object({
  provenance: ProvenanceSchema,
  floor: FloorPlaneSchema,
  ceilingHeight: z.number().positive(),
  outline: z.array(Point2DSchema),
  walls: z.array(WallInterpretationSchema),
  openings: z.array(OpeningInterpretationSchema),
  detections: z.array(DetectionInterpretationSchema),
});
export type RoomInterpretation = z.infer<typeof RoomInterpretationSchema>;
