import type { ProposalValidation } from '@/lib/contracts';

export type PlacementViolationCode =
  | 'OUTSIDE_ROOM'
  | 'OVERLAP_ITEM'
  | 'OVERLAP_WALL'
  | 'DOOR_SWING'
  | 'WALKWAY'
  | 'FRONT_CLEARANCE'
  | 'NOT_SUPPORTED'
  | 'WINDOW_SILL';

export type PlacementSeverity = 'error' | 'warning' | 'info';

export type DetailValue = string | number | boolean | null | number[] | string[];

export interface PlacementViolation {
  code: PlacementViolationCode;
  severity: PlacementSeverity;
  message: string;
  /** First entry is the subject being validated; the rest are the conflicting nodes/walls/openings. */
  nodeIds: string[];
  details: Record<string, DetailValue>;
}

export interface PlacementOptions {
  /** Overlaps/penetrations up to this depth (m) are ignored. */
  overlapTolerance: number;
  /** Minimum clear corridor width (m) between furniture/walls. */
  walkwayMin: number;
  /** Gaps narrower than this (m) are treated as sealed slots, not walkways. */
  walkwayPinchIgnore: number;
  /** A corridor must run at least this long (m) to count as a walkway. */
  walkwayMinLength: number;
  /** Front clearance depth (m) per normalised category; `default` applies otherwise. */
  frontClearance: Record<string, number> & { default: number };
  /** Which hinge side door swings use; `both` is the conservative union of both leaves. */
  doorHinge: 'start' | 'end' | 'both';
  /** Window keep-out depth (m) in front of the window span. */
  windowZoneDepth: number;
  /** Max vertical gap (m) to count as resting on floor / another item. */
  supportTolerance: number;
  /** Max horizontal gap (m) to a wall face to count as wall-attached. */
  wallAttachTolerance: number;
  /** Category override for the proposal subject (EditProposal assets carry no category). */
  category?: string;
  /** Treat non-rejected interpretation detections (not already represented by an item) as obstacles. */
  includeDetections: boolean;
  /** Node ids that are never treated as obstacles. */
  ignoreIds: string[];
}

export const DEFAULT_PLACEMENT_OPTIONS: PlacementOptions = {
  overlapTolerance: 0.02,
  walkwayMin: 0.9,
  walkwayPinchIgnore: 0.25,
  walkwayMinLength: 0.5,
  frontClearance: { default: 0.6, chair: 0.45, stool: 0.4 },
  doorHinge: 'start',
  windowZoneDepth: 0.35,
  supportTolerance: 0.03,
  wallAttachTolerance: 0.05,
  includeDetections: true,
  ignoreIds: [],
};

/** Maps placement violations onto the shared contract's ProposalValidation. */
export function toProposalValidation(violations: PlacementViolation[]): ProposalValidation {
  return {
    ok: !violations.some((v) => v.severity === 'error'),
    violations: violations.map((v) => ({ rule: v.code, severity: v.severity, detail: v.message, nodeIds: v.nodeIds })),
  };
}
