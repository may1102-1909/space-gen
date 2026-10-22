import { toJSONSchema } from 'zod';
import {
  ProjectManifestSchema,
  ScanAssetSchema,
  MaskRegionSchema,
  RoomInterpretationSchema,
  EditProposalSchema,
  EditRecordSchema,
  AssetRefSchema,
  VariantSchema,
  ConversionJobStatusSchema,
} from '../lib/contracts';

const schemas = {
  ProjectManifest: toJSONSchema(ProjectManifestSchema),
  ScanAsset: toJSONSchema(ScanAssetSchema),
  MaskRegion: toJSONSchema(MaskRegionSchema),
  RoomInterpretation: toJSONSchema(RoomInterpretationSchema),
  EditProposal: toJSONSchema(EditProposalSchema),
  EditRecord: toJSONSchema(EditRecordSchema),
  AssetRef: toJSONSchema(AssetRefSchema),
  Variant: toJSONSchema(VariantSchema),
  ConversionJobStatus: toJSONSchema(ConversionJobStatusSchema),
};

console.log(JSON.stringify(schemas, null, 2));
