import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSceneHistory, getSceneDocument, useScene, type AnyNode, type AnyNodeId } from '@pascal-app/core';
import type { EditProposal } from '@/lib/contracts';
import { createItemNode } from './itemEditing';
import { readEditHistory, redoSceneAction, undoSceneAction } from './sceneBridge';
import { scanMetadata, findScanNode } from './nodes';
import {
  acceptPreviewedProposals,
  clearProposalPreviews,
  installProposalPreviewSync,
  pendingPreviewMasks,
  previewProposals,
  rejectProposal,
  useProposalPreviews,
} from './proposalPreview';

const CHAIR = 'item_detected_chair';
const SOFA = 'item_sofa';
const label = { label: 'Modern Chair', category: 'chair' };

function seed() {
  const scan = {
    object: 'node', id: 'scan_fixture', type: 'scan', name: 'Room scan', parentId: null, url: '/room.sog',
    visible: true, opacity: 100, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, layers: { model: false },
    metadata: { format: 'sog', maskRegions: [] },
  } as unknown as AnyNode;
  const chair = { ...createItemNode({ name: 'Detected Chair', category: 'chair', src: '/chair.glb', dimensions: [0.9, 0.9, 0.9], position: [0.5, 0, -4.5] }, CHAIR), metadata: { detectionId: 'det_chair_01' } };
  const sofa = createItemNode({ name: 'Sofa', category: 'sofa', src: '/sofa.glb', dimensions: [2, 0.8, 0.9], position: [3, 0, -4.5] }, SOFA);
  useScene.getState().applyNodeChanges({ create: [{ node: scan }, { node: chair as AnyNode }, { node: sofa as AnyNode }] });
  clearSceneHistory();
}

const proposal = (over: Partial<EditProposal> = {}): EditProposal => ({
  id: 'proposal_t_0',
  op: 'replace',
  targetNodeId: CHAIR,
  asset: { source: 'upload', url: 'http://api/assets/modern.glb', dimensions: { width: 0.9, height: 0.9, depth: 0.9 } },
  transform: { position: [0.5, 0, -4.5], rotationY: 0, scale: [1, 1, 1] },
  rationale: 'Replaces the chair with your model.',
  validation: { ok: true, violations: [] },
  status: 'pending',
  ...over,
});

const pastSteps = () => useScene.temporal.getState().pastStates.length;
const nodes = () => useScene.getState().nodes as Record<string, AnyNode & { metadata?: Record<string, unknown> }>;
const ghostIds = () => Object.values(nodes()).filter((n) => n.metadata?.proposalPreview).map((n) => n.id);
const preview = (id = 'proposal_t_0') => useProposalPreviews.getState().previews[id];

let uninstall: () => void = () => {};

beforeEach(() => {
  clearProposalPreviews();
  useScene.getState().clearScene();
  clearSceneHistory();
  seed();
  uninstall = installProposalPreviewSync();
});
afterEach(() => uninstall());

describe('proposal preview ghosts', () => {
  it('are rendered as Pascal item nodes but kept out of saves and undo history', () => {
    const savedBefore = getSceneDocument();
    previewProposals([proposal()], { proposal_t_0: label });

    const ghostId = preview().ghostId!;
    expect(ghostIds()).toEqual([ghostId]);
    expect(nodes()[ghostId]).toMatchObject({ type: 'item', position: [0.5, 0, -4.5], parentId: null });
    expect(useScene.getState().rootNodeIds).toContain(ghostId);
    expect(pastSteps()).toBe(0);
    expect(getSceneDocument()).toEqual(savedBefore);
    // The would-be mask is shown in ghost mode but not committed to the scan node.
    expect(pendingPreviewMasks(useProposalPreviews.getState().previews)).toMatchObject([{ itemId: CHAIR, ghost: true, opacity: 0.25 }]);
    expect(scanMetadata(findScanNode()).maskRegions).toEqual([]);

    // A real edit while the ghost is pending is one step; undo/redo keeps the ghost in place.
    useScene.getState().updateNode(SOFA as AnyNodeId, { position: [3, 0, -3] } as Partial<AnyNode>);
    expect(pastSteps()).toBe(1);
    expect(Object.keys(useScene.temporal.getState().pastStates[0].nodes!)).not.toContain(ghostId);
    undoSceneAction();
    expect(ghostIds()).toEqual([ghostId]);
    redoSceneAction();
    expect(ghostIds()).toEqual([ghostId]);
    expect(Object.keys(getSceneDocument().nodes)).not.toContain(ghostId);
  });

  it('adjusting the ghost re-runs validation live without adding history', () => {
    previewProposals([proposal()], { proposal_t_0: label });
    const ghostId = preview().ghostId!;
    useScene.getState().updateNode(ghostId as AnyNodeId, { position: [3, 0, -4.5] } as Partial<AnyNode>);
    expect(pastSteps()).toBe(0);
    expect(preview().proposal.transform!.position).toEqual([3, 0, -4.5]);
    expect(preview().proposal.validation.ok).toBe(false);
    expect(preview().proposal.validation.violations.some((v) => v.severity === 'error' && v.nodeIds.includes(SOFA))).toBe(true);

    useScene.getState().updateNode(ghostId as AnyNodeId, { position: [0.5, 0, -4.5] } as Partial<AnyNode>);
    expect(preview().proposal.validation.ok).toBe(true);
  });

  it('accept commits nodes, mask and EditRecord as exactly one undo step', () => {
    previewProposals([proposal()], { proposal_t_0: label });
    acceptPreviewedProposals(['proposal_t_0']);

    expect(preview().status).toBe('accepted');
    expect(ghostIds()).toEqual([]);
    expect(pastSteps()).toBe(1);
    expect(nodes()[CHAIR]).toMatchObject({ name: 'Modern Chair', asset: { src: 'http://api/assets/modern.glb' } });
    expect(scanMetadata(findScanNode()).maskRegions).toMatchObject([{ itemId: CHAIR, ghost: false }]);
    expect(readEditHistory()).toMatchObject([{ proposalId: 'proposal_t_0', op: 'replace', targetNodeId: CHAIR }]);
    expect(Object.keys(getSceneDocument().nodes).some((id) => id.includes('ghost'))).toBe(false);

    undoSceneAction();
    expect(nodes()[CHAIR]).toMatchObject({ name: 'Detected Chair', asset: { src: '/chair.glb' } });
    expect(scanMetadata(findScanNode()).maskRegions).toEqual([]);
    expect(readEditHistory()).toEqual([]);
    expect(ghostIds()).toEqual([]);

    redoSceneAction();
    expect(nodes()[CHAIR]).toMatchObject({ name: 'Modern Chair' });
    expect(scanMetadata(findScanNode()).maskRegions).toHaveLength(1);
    expect(readEditHistory()).toHaveLength(1);
  });

  it('accept all is one step and keeps every mask', () => {
    previewProposals(
      [proposal(), proposal({ id: 'proposal_t_1', op: 'remove', targetNodeId: SOFA, asset: null, transform: null })],
      { proposal_t_0: label, proposal_t_1: { label: 'Sofa', category: 'sofa' } },
    );
    acceptPreviewedProposals(['proposal_t_0', 'proposal_t_1']);
    expect(pastSteps()).toBe(1);
    expect(nodes()[SOFA]).toBeUndefined();
    expect(readEditHistory()!.map((r) => r.proposalId)).toEqual(['proposal_t_0', 'proposal_t_1']);
    // The sofa was not a scanned object, so removing it adds no mask; the chair's mask stays.
    expect(scanMetadata(findScanNode()).maskRegions).toMatchObject([{ itemId: CHAIR }]);
    undoSceneAction();
    expect(nodes()[SOFA]).toBeDefined();
    expect(readEditHistory()).toEqual([]);
  });

  it('reject leaves no residue in scene, history or save payload', () => {
    const nodesBefore = nodes();
    const savedBefore = getSceneDocument();
    previewProposals([proposal()], { proposal_t_0: label });
    rejectProposal('proposal_t_0');

    expect(preview().status).toBe('rejected');
    expect(ghostIds()).toEqual([]);
    expect(nodes()).toEqual(nodesBefore);
    expect(pastSteps()).toBe(0);
    expect(useScene.temporal.getState().futureStates).toHaveLength(0);
    expect(getSceneDocument()).toEqual(savedBefore);
    expect(pendingPreviewMasks(useProposalPreviews.getState().previews)).toEqual([]);
  });

  it('refuses to accept a proposal with blocking violations', () => {
    previewProposals([proposal({ validation: { ok: false, violations: [{ rule: 'collision', severity: 'error', detail: 'x', nodeIds: [] }] } })], { proposal_t_0: label });
    acceptPreviewedProposals(['proposal_t_0']);
    expect(preview().status).toBe('pending');
    expect(pastSteps()).toBe(0);
  });
});
