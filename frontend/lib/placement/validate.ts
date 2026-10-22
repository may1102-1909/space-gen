import type { EditProposal, ProposalValidation, RoomInterpretation, Violation } from '@/lib/contracts';
import { buildRoom, resolveConfig } from './room';
import { PLACEMENT_RULES, type RuleContext } from './rules';
import type { PlacementAttachment, PlacementConfig, PlacementItem, PlacementScene } from './types';

export interface ValidateOptions {
  config?: Partial<PlacementConfig>;
  /** Category of an added asset (proposals carry none); moves/replaces use the target's category. */
  category?: string;
  attachTo?: PlacementAttachment;
  /** Restrict to these rule ids (default: all). */
  rules?: string[];
}

type Resolved = { subject: PlacementItem } | { violations: Violation[] } | null;

const incomplete = (proposal: EditProposal, detail: string): Resolved => ({
  violations: [{ rule: 'proposal-incomplete', severity: 'error', detail, nodeIds: proposal.targetNodeId ? [proposal.targetNodeId] : [] }],
});

/** Builds the item the proposal would produce. Transform position is the base center (Pascal semantics). */
export function subjectFromProposal(
  proposal: EditProposal,
  scene: PlacementScene,
  options: Pick<ValidateOptions, 'category' | 'attachTo'> = {},
): Resolved {
  if (proposal.op === 'remove') return null;
  const target = proposal.targetNodeId ? scene.items.find((i) => i.id === proposal.targetNodeId) : undefined;
  if (proposal.op !== 'add' && !target) {
    return {
      violations: [
        {
          rule: 'target-missing',
          severity: 'error',
          detail: `Proposal ${proposal.id} targets "${proposal.targetNodeId ?? ''}", which is not in the scene.`,
          nodeIds: proposal.targetNodeId ? [proposal.targetNodeId] : [],
        },
      ],
    };
  }
  if (proposal.op === 'add' && (!proposal.asset || !proposal.transform)) {
    return incomplete(proposal, `Add proposal ${proposal.id} needs both an asset and a transform.`);
  }
  if (proposal.op === 'move' && !proposal.transform) {
    return incomplete(proposal, `Move proposal ${proposal.id} has no transform.`);
  }

  const dims = proposal.asset?.dimensions;
  const base: [number, number, number] = dims
    ? [dims.width, dims.height, dims.depth]
    : [target!.obb.size[0], target!.obb.size[1], target!.obb.size[2]];
  const t = proposal.transform;
  const size: [number, number, number] = t ? [base[0] * t.scale[0], base[1] * t.scale[1], base[2] * t.scale[2]] : base;
  const position = t
    ? t.position
    : ([target!.obb.center[0], target!.obb.center[1] - target!.obb.size[1] / 2, target!.obb.center[2]] as const);
  const yaw = t ? t.rotationY : target!.obb.yaw;

  return {
    subject: {
      id: target?.id ?? proposal.targetNodeId ?? proposal.id,
      name: target?.name ?? proposal.asset?.url.split('/').pop() ?? proposal.id,
      category: (options.category ?? target?.category ?? 'item').toLowerCase(),
      obb: { center: [position[0], position[1] + size[1] / 2, position[2]], size, yaw },
      attachTo: options.attachTo ?? target?.attachTo ?? 'floor',
      groupId: target?.groupId,
    },
  };
}

/** Runs the selected rules for one subject item. */
export function validateItem(
  subject: PlacementItem,
  ctx: RuleContext,
  config: PlacementConfig,
  rules: string[] = Object.keys(PLACEMENT_RULES),
): Violation[] {
  const out: Violation[] = [];
  for (const id of rules) {
    const rule = PLACEMENT_RULES[id];
    if (rule) out.push(...rule(subject, ctx, config));
  }
  return out;
}

/** Validates an EditProposal against the scene (plain data from the adapter) and the room interpretation. */
export function validate(
  proposal: EditProposal,
  scene: PlacementScene,
  interpretation: RoomInterpretation,
  options: ValidateOptions = {},
): Violation[] {
  const resolved = subjectFromProposal(proposal, scene, options);
  if (!resolved) return [];
  if ('violations' in resolved) return resolved.violations;
  const { subject } = resolved;
  const ctx: RuleContext = {
    room: buildRoom(interpretation),
    obstacles: scene.items.filter((i) => i.id !== subject.id),
  };
  return validateItem(subject, ctx, resolveConfig(options.config), options.rules);
}

/** Packs violations into the contract's ProposalValidation (ok = no errors). */
export function toProposalValidation(violations: Violation[]): ProposalValidation {
  return { ok: !violations.some((v) => v.severity === 'error'), violations };
}
