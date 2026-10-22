/**
 * Pending EditProposals shown as ghost Pascal item nodes before the user accepts them.
 *
 * Ghosts are Pascal "created carry drafts" (core history-drafts): undo history and every save
 * (`getSceneDocument`) leave them out, and undo/redo keeps them where they are. They sit at the
 * scene root in scene coordinates, so they stay put as the camera orbits. Would-be masks are kept
 * here, never on the scan node, until the proposal is accepted.
 */
import { create } from 'zustand';
import { beginSceneHistoryDraft, runSceneHistoryDraftWrite, useScene, type AnyNode, type AnyNodeId } from '@pascal-app/core';
import type { EditProposal, MaskRegion, ProposalTransform } from '@/lib/contracts';
import { interpretationFromPascalNodes, sceneFromPascalNodes, toProposalValidation, validate } from '@/lib/placement';
import { createMaskRegionForNode } from '@/lib/splat/splatMasking';
import { acceptProposals as commitProposals, type ProposalLabel } from './applyProposal';
import { getTrustedInterpretation } from './interpretationReview';
import { createItemNode, replaceItemAsset, type ItemNode } from './itemEditing';
import { findScanNode, nodeViews } from './nodes';

/** metadata key on a ghost node; its value is the proposal id. */
export const GHOST_KEY = 'proposalPreview';

export interface ProposalPreview {
  /** The proposal as currently adjusted (transform + live validation). */
  proposal: EditProposal;
  meta: ProposalLabel;
  ghostId: string | null;
  /** The MaskRegion accepting would commit, shown in ghost mode meanwhile. */
  mask: MaskRegion | null;
  status: EditProposal['status'];
}

export const useProposalPreviews = create<{ previews: Record<string, ProposalPreview> }>(() => ({ previews: {} }));

const draftEnds = new Map<string, () => void>();

export function isProposalGhost(node: unknown): boolean {
  const metadata = (node as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  return typeof metadata?.[GHOST_KEY] === 'string';
}

/** The scene without ghost nodes: what the AI, the validator and saves should see. */
export function withoutProposalGhosts<T>(nodes: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(nodes).filter(([, n]) => !isProposalGhost(n)));
}

const ghostIdFor = (proposalId: string) => `item_ghost_${proposalId}`;

function itemTarget(proposal: EditProposal, nodes: Record<string, unknown>): ItemNode | undefined {
  const node = proposal.targetNodeId ? (nodes[proposal.targetNodeId] as ItemNode | undefined) : undefined;
  return node?.type === 'item' ? node : undefined;
}

/** The item the proposal would produce, as a root-level ghost node (null for remove). */
export function ghostNodeFor(proposal: EditProposal, nodes: Record<string, unknown>, meta: ProposalLabel): ItemNode | null {
  const t = proposal.transform ?? undefined;
  const target = itemTarget(proposal, nodes);
  let node: ItemNode | null = null;
  if (proposal.op === 'add' && proposal.asset && t) {
    const { width, height, depth } = proposal.asset.dimensions;
    node = createItemNode({ name: meta.label, category: meta.category, src: proposal.asset.url, dimensions: [width, height, depth], position: t.position, rotation: [0, t.rotationY, 0], scale: t.scale });
  } else if (proposal.op === 'move' && target && t) {
    node = { ...target, position: t.position, rotation: [0, t.rotationY, 0] };
  } else if (proposal.op === 'replace' && target && proposal.asset) {
    const { width, height, depth } = proposal.asset.dimensions;
    node = replaceItemAsset(target, { name: meta.label, category: target.asset?.category ?? meta.category, src: proposal.asset.url, dimensions: [width, height, depth] });
    if (t) node = { ...node, position: t.position, rotation: [0, t.rotationY, 0], scale: t.scale };
  }
  if (!node) return null;
  return {
    ...node,
    id: ghostIdFor(proposal.id) as ItemNode['id'],
    name: `${meta.label} (proposed)`,
    parentId: null,
    children: [],
    metadata: { [GHOST_KEY]: proposal.id },
  } as ItemNode;
}

/** The MaskRegion accepting would add: the replaced item, or a removed scanned object. */
export function wouldBeMask(proposal: EditProposal, nodes: Record<string, unknown>): MaskRegion | null {
  const target = itemTarget(proposal, nodes);
  if (!target || !findScanNode(nodes as Record<string, AnyNode>)) return null;
  const metadata = (target.metadata ?? {}) as { detectionId?: string; maskRegionId?: string };
  if (proposal.op === 'replace') return createMaskRegionForNode(target);
  if (proposal.op === 'remove' && metadata.detectionId && !metadata.maskRegionId) return createMaskRegionForNode(target);
  return null;
}

function createGhost(node: ItemNode) {
  const id = node.id as AnyNodeId;
  const end = beginSceneHistoryDraft(id, null);
  try {
    runSceneHistoryDraftWrite(() => useScene.getState().applyNodeChanges({ create: [{ node: node as AnyNode }] }));
  } catch (error) {
    end();
    throw error;
  }
  draftEnds.set(node.id, end);
}

function deleteGhost(id: string | null) {
  if (!id) return;
  try {
    if (useScene.getState().nodes[id as AnyNodeId]) {
      runSceneHistoryDraftWrite(() => useScene.getState().applyNodeChanges({ delete: [id as AnyNodeId] }));
    }
  } finally {
    draftEnds.get(id)?.();
    draftEnds.delete(id);
  }
}

const setPreview = (id: string, patch: Partial<ProposalPreview>) =>
  useProposalPreviews.setState((s) => (s.previews[id] ? { previews: { ...s.previews, [id]: { ...s.previews[id], ...patch } } } : s));

/** Shows each pending proposal as a ghost (and would-be mask). Re-previewing an id is a no-op. */
export function previewProposals(proposals: EditProposal[], labels: Record<string, ProposalLabel>): void {
  const nodes = useScene.getState().nodes as Record<string, unknown>;
  const added: Record<string, ProposalPreview> = {};
  for (const proposal of proposals) {
    if (proposal.status !== 'pending' || useProposalPreviews.getState().previews[proposal.id]) continue;
    const meta = labels[proposal.id] ?? { label: 'Item', category: 'item' };
    const ghost = ghostNodeFor(proposal, nodes, meta);
    if (ghost) createGhost(ghost);
    added[proposal.id] = { proposal, meta, ghostId: ghost?.id ?? null, mask: wouldBeMask(proposal, nodes), status: 'pending' };
  }
  useProposalPreviews.setState((s) => ({ previews: { ...s.previews, ...added } }));
}

/** Re-runs the placement validator for a proposal against the scene without ghosts. */
export function revalidate(proposal: EditProposal, meta: ProposalLabel, nodes: Record<string, unknown>) {
  const sceneNodes = withoutProposalGhosts(nodes);
  const scene = sceneFromPascalNodes(sceneNodes);
  // Same input the request used: reviewed scan elements only, else the Pascal walls.
  const interpretation = getTrustedInterpretation(nodeViews(sceneNodes)).interpretation ?? interpretationFromPascalNodes(sceneNodes);
  const category = proposal.op === 'add' ? meta.category : (scene.items.find((i) => i.id === proposal.targetNodeId)?.category ?? meta.category);
  return toProposalValidation(validate(proposal, scene, interpretation, { category }));
}

const sameTransform = (a: ProposalTransform | null | undefined, b: ProposalTransform) =>
  !!a && Math.abs(a.rotationY - b.rotationY) < 1e-4 && [0, 1, 2].every((i) => Math.abs(a.position[i] - b.position[i]) < 1e-4 && Math.abs(a.scale[i] - b.scale[i]) < 1e-4);

/** Adjusting a ghost: adopt its transform and validate it live. */
export function updatePreviewTransform(id: string, transform: ProposalTransform): void {
  const entry = useProposalPreviews.getState().previews[id];
  if (!entry || entry.status !== 'pending' || sameTransform(entry.proposal.transform, transform)) return;
  const moved = { ...entry.proposal, transform };
  const proposal = { ...moved, validation: revalidate(moved, entry.meta, useScene.getState().nodes as Record<string, unknown>) };
  setPreview(id, { proposal });
}

export function transformOfNode(node: { position?: number[]; rotation?: number[]; scale?: number[] }): ProposalTransform {
  const p = node.position ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  return { position: [p[0], p[1], p[2]], rotationY: node.rotation?.[1] ?? 0, scale: [s[0], s[1], s[2]] };
}

export function rejectProposal(id: string): void {
  const entry = useProposalPreviews.getState().previews[id];
  if (!entry || entry.status !== 'pending') return;
  deleteGhost(entry.ghostId);
  setPreview(id, { status: 'rejected', ghostId: null, mask: null });
}

/**
 * Accepts pending proposals as one undo step: their nodes, masks and EditRecords. Ghosts are
 * removed first (outside history); proposals with blocking violations are skipped.
 */
export function acceptPreviewedProposals(ids: string[]): void {
  const previews = useProposalPreviews.getState().previews;
  const entries = ids.map((id) => previews[id]).filter((e): e is ProposalPreview => !!e && e.status === 'pending' && e.proposal.validation.ok);
  if (!entries.length) return;
  const nodes = withoutProposalGhosts(useScene.getState().nodes as Record<string, unknown>);
  // Throws before anything changes if a proposal no longer applies.
  const accepted = entries.map((e) => ({ proposal: e.proposal, meta: e.meta, mask: e.mask }));
  commitProposals(accepted, nodes);
  for (const e of entries) {
    deleteGhost(e.ghostId);
    setPreview(e.proposal.id, { status: 'accepted', ghostId: null, mask: null });
  }
}

/** Drops every preview (e.g. before loading another project document). */
export function clearProposalPreviews(): void {
  for (const entry of Object.values(useProposalPreviews.getState().previews)) deleteGhost(entry.ghostId);
  useProposalPreviews.setState({ previews: {} });
}

export function pendingPreviewMasks(previews: Record<string, ProposalPreview>): MaskRegion[] {
  return Object.values(previews).flatMap((e) =>
    e.status === 'pending' && e.mask ? [{ ...e.mask, id: `preview_${e.mask.id}`, ghost: true, opacity: 0.25 }] : [],
  );
}

/**
 * Keeps previews in sync with their ghost nodes: an edited ghost (gizmo, panel) updates the
 * proposal transform and validation; a ghost deleted from the scene rejects its proposal.
 */
export function installProposalPreviewSync(): () => void {
  return useScene.subscribe((state, prev) => {
    if (state.nodes === prev.nodes) return;
    for (const entry of Object.values(useProposalPreviews.getState().previews)) {
      if (entry.status !== 'pending' || !entry.ghostId) continue;
      const ghost = state.nodes[entry.ghostId as AnyNodeId];
      if (!ghost) {
        // Undo/redo writes the jumped-to state first and puts drafts back right after.
        const { ghostId } = entry;
        queueMicrotask(() => {
          if (useScene.getState().nodes[ghostId as AnyNodeId] || useProposalPreviews.getState().previews[entry.proposal.id]?.ghostId !== ghostId) return;
          draftEnds.get(ghostId)?.();
          draftEnds.delete(ghostId);
          setPreview(entry.proposal.id, { status: 'rejected', ghostId: null, mask: null });
        });
      } else if (ghost !== prev.nodes[entry.ghostId as AnyNodeId]) {
        updatePreviewTransform(entry.proposal.id, transformOfNode(ghost as ItemNode));
      }
    }
  });
}
