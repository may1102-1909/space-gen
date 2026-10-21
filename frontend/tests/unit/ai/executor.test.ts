import { describe, expect, it } from 'vitest';
import { buildAgentContext } from '@/lib/ai/agent';
import { catalogFromPublicManifest, searchCatalog } from '@/lib/ai/catalog';
import { runSpatialAgent } from '@/lib/ai/executor';
import { measureGlb } from '@/lib/ai/glb';
import { lastToolResponse, ScriptedModel } from '@/lib/ai/scriptedModel';
import { READ_ONLY_TOOL_NAMES, SPATIAL_TOOLS, type solvePlacementTool } from '@/lib/ai/tools';
import { proposalToSceneActions } from '@/lib/pascal/applyProposal';
import catalogManifest from '@/public/catalog/catalogManifest.json';
import { boxGlb, loadEvalCatalog, realisticFixture } from '../../evals/ai/fixtures';

const room = realisticFixture();
const context = () =>
  buildAgentContext({ prompt: '', nodes: room.nodes, interpretation: room.interpretation, selectedIds: [] }, loadEvalCatalog());

type Solve = Exclude<ReturnType<typeof solvePlacementTool>, { error: string }>;

describe('spatial agent executor (scripted model)', () => {
  it('exposes only read tools plus submit_proposals', () => {
    expect(SPATIAL_TOOLS.map((t) => t.name).sort()).toEqual(
      ['get_room_interpretation', 'get_scene_summary', 'search_catalog', 'solve_placement', 'submit_proposals', 'validate_proposals'],
    );
    expect(READ_ONLY_TOOL_NAMES).not.toContain('submit_proposals');
  });

  it('answers a mutating tool name with an error and leaves the context untouched', async () => {
    const ctx = context();
    const before = JSON.stringify(ctx.scene);
    const model = new ScriptedModel([
      { toolCalls: [{ name: 'update_node_transform', args: { nodeId: 'item_sofa_01', position: [0, 0, 0] } }] },
      (messages) => {
        expect(lastToolResponse<{ error: string }>(messages, 'update_node_transform')?.error).toMatch(/Unknown tool/);
        return { toolCalls: [{ name: 'submit_proposals', args: { message: 'none', proposals: [] } }] };
      },
    ]);
    const result = await runSpatialAgent({ model, context: ctx, prompt: 'move the sofa' });
    expect(result.trace.steps).toEqual([
      { tool: 'update_node_transform', ok: false },
      { tool: 'submit_proposals', ok: true },
    ]);
    expect(JSON.stringify(ctx.scene)).toBe(before);
  });

  it('fills validation with the placement validator, including errors on a colliding draft', async () => {
    const model = new ScriptedModel([
      {
        toolCalls: [
          {
            name: 'submit_proposals',
            args: {
              message: 'two moves',
              proposals: [
                { op: 'move', targetNodeId: 'item_sofa_01', transform: { position: [4, 0, 3.2], rotationY: 0, scale: [1, 1, 1] }, rationale: 'onto the coffee table' },
                { op: 'move', targetNodeId: 'item_sofa_01', transform: { position: [4, 0, 4.6], rotationY: 0, scale: [1, 1, 1] }, rationale: 'nudge back' },
                { op: 'teleport', rationale: 'bad op' },
              ],
            },
          },
        ],
      },
    ]);
    const result = await runSpatialAgent({ model, context: context(), prompt: 'move the sofa', idPrefix: 't' });
    expect(result.proposals.map((p) => p.id)).toEqual(['t_0', 't_1']);
    expect(result.proposals[0].validation.ok).toBe(false);
    expect(result.proposals[0].validation.violations.map((v) => v.rule)).toContain('item-overlap');
    expect(result.proposals[1].validation.ok).toBe(true);
    expect(result.proposals.every((p) => p.status === 'pending')).toBe(true);
    expect(result.rejectedDrafts).toHaveLength(1);
  });

  it('submits solver drafts from tool results, and forces structured output when the model stops early', async () => {
    const model = new ScriptedModel(
      [
        { toolCalls: [{ name: 'solve_placement', args: { op: 'add', assetId: 'chair_nordic_walnut', count: 2, anchorId: 'item_dining_table' } }] },
        { text: 'Here are two chairs.' },
      ],
      (req) => {
        const solved = lastToolResponse<Solve>(req.messages, 'solve_placement')!;
        return { message: 'Two chairs at the table.', proposals: solved.layouts[0].proposals };
      },
    );
    const result = await runSpatialAgent({ model, context: context(), prompt: 'add 2 chairs' });
    expect(result.trace.forcedStructuredOutput).toBe(true);
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals.every((p) => p.op === 'add' && p.validation.ok)).toBe(true);
  });
});

describe('GLB measurement', () => {
  it('measures box geometry through node transforms and rescales millimetre files', () => {
    expect(measureGlb(boxGlb([0.6, 0.9, 0.5]))).toEqual([0.6, 0.9, 0.5]);
    expect(measureGlb(boxGlb([0.45, 1.2, 0.45], 1000))).toEqual([0.45, 1.2, 0.45]);
    expect(() => measureGlb(new Uint8Array(24))).toThrow(/Not a GLB/);
  });
});

describe('catalog search', () => {
  it('ranks by category, style, colour and size', () => {
    const [best] = searchCatalog(catalogFromPublicManifest(catalogManifest), {
      category: 'chair',
      styleTags: ['leather', 'lounge'],
      colorHex: '#2B2625',
      dimensions: [0.85, 0.82, 0.85],
    });
    expect(best.entry.id).toBe('chair_eames_lounge');
  });
});

describe('accepting a proposal', () => {
  const base = { rationale: 'r', status: 'pending' as const, validation: { ok: true, violations: [] } };

  it('maps add/move/remove to scene actions', () => {
    const add = proposalToSceneActions(
      { ...base, id: 'a', op: 'add', asset: { source: 'catalog', url: '/m.glb', dimensions: { width: 1, height: 1, depth: 1 } }, transform: { position: [1, 0, 2], rotationY: 0.5, scale: [1, 1, 1] } },
      room.nodes,
      { label: 'Chair', category: 'chair' },
    );
    expect(add[0]).toMatchObject({ action: 'create_node', parentId: 'level_1', node: { type: 'item', position: [1, 0, 2], rotation: [0, 0.5, 0] } });
    expect(
      proposalToSceneActions({ ...base, id: 'm', op: 'move', targetNodeId: 'item_sofa_01', transform: { position: [4, 0, 5], rotationY: 0, scale: [1, 1, 1] } }, room.nodes, { label: '', category: '' }),
    ).toEqual([{ action: 'update_transform', nodeId: 'item_sofa_01', position: [4, 0, 5], rotation: [0, 0, 0] }]);
    expect(proposalToSceneActions({ ...base, id: 'r', op: 'remove', targetNodeId: 'item_tv_console' }, room.nodes, { label: '', category: '' })).toEqual([
      { action: 'delete_node', nodeId: 'item_tv_console' },
    ]);
  });

  it('refuses proposals with blocking violations', () => {
    expect(() =>
      proposalToSceneActions(
        { ...base, id: 'x', op: 'remove', targetNodeId: 'item_tv_console', validation: { ok: false, violations: [] } },
        room.nodes,
        { label: '', category: '' },
      ),
    ).toThrow(/blocking/);
  });
});
