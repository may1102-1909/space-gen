/**
 * Core geometric and provenance primitives shared across SpaceGen.
 * Frame: Y-up, meters, floor at y=0.
 */
import { z } from 'zod';

export const ProvenanceSchema = z.enum(['auto', 'user']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const Vector3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vector3 = z.infer<typeof Vector3Schema>;

export const Matrix4Schema = z.tuple([
  z.number(), z.number(), z.number(), z.number(),
  z.number(), z.number(), z.number(), z.number(),
  z.number(), z.number(), z.number(), z.number(),
  z.number(), z.number(), z.number(), z.number(),
]);
export type Matrix4 = z.infer<typeof Matrix4Schema>;

export const BoundingBox3DSchema = z.object({
  min: Vector3Schema,
  max: Vector3Schema,
});
export type BoundingBox3D = z.infer<typeof BoundingBox3DSchema>;

export const OrientedBoundingBoxSchema = z.object({
  center: Vector3Schema,
  size: Vector3Schema,
  yaw: z.number(),
});
export type OrientedBoundingBox = z.infer<typeof OrientedBoundingBoxSchema>;
