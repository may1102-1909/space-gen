/**
 * EditProposal drafts -> contract EditProposals: schema check, ids, and placement validation.
 */
import { z } from 'zod';
import { EditProposalSchema, type EditProposal } from '@/lib/contracts';
import { subjectFromProposal, toProposalValidation, validate, type PlacementScene } from '@/lib/placement';
import { findCatalogEntryByUrl } from './catalog';
import type { AgentContext } from './tools';

export const ProposalDraftSchema = EditProposalSchema.omit({ id: true, validation: true, status: true });
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;

export interface ProposalAnnotation {
  label: string;
  category: string;
}

export interface FinalizedProposals {
  proposals: EditProposal[];
  annotations: Record<string, ProposalAnnotation>;
  /** Drafts that did not match the EditProposal contract, with the reason. */
  rejectedDrafts: { draft: unknown; error: string }[];
}

/** Accepts [x, y, z] arrays that came through JSON (tuples arrive as plain arrays). */
function normalizeDraft(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const d = { ...(raw as Record<string, unknown>) };
  if (d.targetNodeId === '') d.targetNodeId = null;
  const t = d.transform as Record<string, unknown> | undefined;
  if (t && typeof t === 'object' && !Array.isArray(t.scale)) d.transform = { ...t, scale: [1, 1, 1] };
  return d;
}

function annotate(ctx: AgentContext, p: EditProposal): ProposalAnnotation {
  const target = p.targetNodeId ? ctx.scene.items.find((i) => i.id === p.targetNodeId) : undefined;
  const entry = p.asset ? findCatalogEntryByUrl(ctx.catalog, p.asset.url) : undefined;
  const uploaded = p.asset?.source === 'upload' ? ctx.upload : undefined;
  const label = entry?.name ?? uploaded?.name ?? target?.name ?? p.asset?.url.split('/').pop() ?? 'Item';
  const category = entry?.category ?? uploaded?.category ?? target?.category ?? 'item';
  return { label, category };
}

/**
 * Turns drafts into contract EditProposals. Each proposal is validated against the scene as it
 * would be after the earlier proposals in the batch, so four added chairs are checked against
 * each other and a moved item no longer blocks its old spot.
 */
export function finalizeProposals(
  ctx: AgentContext,
  drafts: unknown[],
  idPrefix = 'proposal',
): FinalizedProposals {
  const proposals: EditProposal[] = [];
  const annotations: Record<string, ProposalAnnotation> = {};
  const rejectedDrafts: FinalizedProposals['rejectedDrafts'] = [];
  let scene: PlacementScene = { items: [...ctx.scene.items] };

  drafts.forEach((raw, index) => {
    const parsed = ProposalDraftSchema.safeParse(normalizeDraft(raw));
    if (!parsed.success) {
      rejectedDrafts.push({ draft: raw, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      return;
    }
    const id = `${idPrefix}_${index}`;
    const proposal: EditProposal = { ...parsed.data, id, status: 'pending', validation: { ok: false, violations: [] } };
    const meta = annotate(ctx, proposal);
    const category = proposal.op === 'add' ? meta.category : (ctx.scene.items.find((i) => i.id === proposal.targetNodeId)?.category ?? meta.category);
    proposal.validation = toProposalValidation(validate(proposal, scene, ctx.interpretation, { category }));
    proposals.push(EditProposalSchema.parse(proposal));
    annotations[id] = meta;

    if (proposal.op === 'remove') {
      scene = { items: scene.items.filter((i) => i.id !== proposal.targetNodeId) };
      return;
    }
    const resolved = subjectFromProposal(proposal, scene, { category });
    if (resolved && 'subject' in resolved) {
      const subject = proposal.op === 'add' ? { ...resolved.subject, id, groupId: `batch:${proposal.asset?.url}` } : resolved.subject;
      scene = { items: [...scene.items.filter((i) => i.id !== subject.id), subject] };
    }
  });
  return { proposals, annotations, rejectedDrafts };
}

