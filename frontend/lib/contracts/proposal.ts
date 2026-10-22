import { z } from 'zod';
import { Vector3Schema } from './primitives';

export const EditOpSchema = z.enum(['replace', 'add', 'move', 'remove']);
export type EditOp = z.infer<typeof EditOpSchema>;

export const AssetSourceSchema = z.enum(['catalog', 'upload', 'generated', 'segmented']);
export type AssetSource = z.infer<typeof AssetSourceSchema>;

export const ProposalAssetDimensionsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  depth: z.number().positive(),
});
export type ProposalAssetDimensions = z.infer<
  typeof ProposalAssetDimensionsSchema
>;

export const ProposalAssetSchema = z.object({
  source: AssetSourceSchema,
  url: z.string(),
  dimensions: ProposalAssetDimensionsSchema,
});
export type ProposalAsset = z.infer<typeof ProposalAssetSchema>;

export const ProposalTransformSchema = z.object({
  position: Vector3Schema,
  rotationY: z.number(),
  scale: Vector3Schema,
});
export type ProposalTransform = z.infer<typeof ProposalTransformSchema>;

export const ViolationSeveritySchema = z.enum(['error', 'warning', 'info']);
export type ViolationSeverity = z.infer<typeof ViolationSeveritySchema>;

export const ViolationSchema = z.object({
  rule: z.string(),
  severity: ViolationSeveritySchema,
  detail: z.string(),
  nodeIds: z.array(z.string()),
});
export type Violation = z.infer<typeof ViolationSchema>;

export const ProposalValidationSchema = z.object({
  ok: z.boolean(),
  violations: z.array(ViolationSchema),
});
export type ProposalValidation = z.infer<typeof ProposalValidationSchema>;

export const ProposalStatusSchema = z.enum(['pending', 'accepted', 'rejected']);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const EditProposalSchema = z.object({
  id: z.string(),
  op: EditOpSchema,
  targetNodeId: z.string().nullable().optional(),
  asset: ProposalAssetSchema.nullable().optional(),
  transform: ProposalTransformSchema.nullable().optional(),
  rationale: z.string(),
  validation: ProposalValidationSchema,
  status: ProposalStatusSchema,
});
export type EditProposal = z.infer<typeof EditProposalSchema>;

export const EditRecordSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  proposalId: z.string().nullable().optional(),
  op: EditOpSchema,
  targetNodeId: z.string().nullable().optional(),
  description: z.string(),
  userComment: z.string().nullable().optional(),
});
export type EditRecord = z.infer<typeof EditRecordSchema>;
