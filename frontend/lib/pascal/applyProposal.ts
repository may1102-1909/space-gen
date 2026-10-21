/**
 * Applies an EditProposal the user accepted. This is the only path from a proposal to the
 * Pascal store, and it runs from a user click, never from AI output directly.
 */
import type { AnyNode } from '@pascal-app/core';
import type { EditProposal } from '@/lib/contracts';
import { createItemNode } from './itemEditing';
import { applySceneActions, type SceneAction } from './sceneBridge';

export interface ProposalLabel {
  label: string;
  category: string;
}

/**
 * Scene actions for one proposal. Transform semantics follow the validator: position is the
 * base center, rotationY the yaw; for add/replace the scale multiplies the asset dimensions,
 * for move the item keeps its current scale.
 */
export function proposalToSceneActions(
  proposal: EditProposal,
  nodes: Record<string, unknown>,
  meta: ProposalLabel,
): SceneAction[] {
  if (proposal.validation && !proposal.validation.ok) {
    throw new Error(`Proposal ${proposal.id} has blocking violations and cannot be applied.`);
  }
  const t = proposal.transform ?? undefined;
  const target = proposal.targetNodeId ? (nodes[proposal.targetNodeId] as { type?: string } | undefined) : undefined;
  if (proposal.op !== 'add' && (!target || target.type !== 'item')) {
    throw new Error(`Proposal ${proposal.id} targets "${proposal.targetNodeId}", which is not an item in the scene.`);
  }

  switch (proposal.op) {
    case 'add': {
      if (!proposal.asset || !t) throw new Error(`Add proposal ${proposal.id} needs an asset and a transform.`);
      const { width, height, depth } = proposal.asset.dimensions;
      const level = Object.values(nodes).find((n) => (n as { type?: string })?.type === 'level') as { id: string } | undefined;
      const node = createItemNode({
        name: meta.label,
        category: meta.category,
        src: proposal.asset.url,
        dimensions: [width, height, depth],
        position: t.position,
        rotation: [0, t.rotationY, 0],
        scale: t.scale,
        parentId: level?.id ?? null,
      });
      return [{ action: 'create_node', node: node as AnyNode, parentId: level?.id }];
    }
    case 'move':
      if (!t) throw new Error(`Move proposal ${proposal.id} has no transform.`);
      return [{ action: 'update_transform', nodeId: proposal.targetNodeId!, position: t.position, rotation: [0, t.rotationY, 0] }];
    case 'replace': {
      if (!proposal.asset) throw new Error(`Replace proposal ${proposal.id} has no asset.`);
      const { width, height, depth } = proposal.asset.dimensions;
      const actions: SceneAction[] = [
        { action: 'replace_asset', nodeId: proposal.targetNodeId!, newModelUrl: proposal.asset.url, newName: meta.label, dimensions: [width, height, depth] },
      ];
      if (t) actions.push({ action: 'update_transform', nodeId: proposal.targetNodeId!, position: t.position, rotation: [0, t.rotationY, 0], scale: t.scale });
      return actions;
    }
    case 'remove':
      return [{ action: 'delete_node', nodeId: proposal.targetNodeId! }];
  }
}

/** Applies an accepted proposal as one undoable scene transaction. */
export function acceptProposal(proposal: EditProposal, nodes: Record<string, unknown>, meta: ProposalLabel): void {
  applySceneActions(proposalToSceneActions(proposal, nodes, meta));
}
