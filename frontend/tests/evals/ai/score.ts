/**
 * Scores one agent answer: right target, valid placement (re-validated here with the T13
 * validator, independent of the agent's own validation field) and useful rationale.
 */
import type { EditProposal } from '@/lib/contracts';
import { buildAgentContext, handleSpatialRequest, type SpatialResponse } from '@/lib/ai/agent';
import type { CatalogEntry } from '@/lib/ai/catalog';
import type { SpatialModel } from '@/lib/ai/model';
import { buildRoom, subjectFromProposal, validate, yawFacing, type PlacementScene } from '@/lib/placement';
import type { EvalCase } from './cases';

export interface CaseScore {
  id: string;
  pass: boolean;
  rightTarget: boolean;
  validPlacement: boolean;
  usefulRationale: boolean;
  problems: string[];
  proposals: number;
  toolCalls: number;
  turns: number;
  tokens: number;
  latencyMs: number;
}

const REASON_WORDS = /\b(wall|clear|clearance|walkway|gap|fit|fits|facing|face|match|matches|style|around|collision|orientation|spot|measured|toward|frees|removes|grouped|seat|backed|sight|same|shifted)\b/i;

const plan = (p: [number, number, number]) => [p[0], p[2]] as [number, number];
const dist2 = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export function scoreResponse(c: EvalCase, response: SpatialResponse, catalog: CatalogEntry[]): Omit<CaseScore, 'latencyMs' | 'tokens' | 'toolCalls' | 'turns'> {
  const room = c.room();
  const ctx = buildAgentContext({ prompt: c.prompt, nodes: room.nodes, interpretation: room.interpretation, selectedIds: c.selectedIds ?? [], attachment: undefined }, catalog);
  const e = c.expect;
  const problems: string[] = [];
  const ps: EditProposal[] = response.proposals;
  const item = (id: string) => ctx.scene.items.find((i) => i.id === id);

  // right target
  let rightTarget = true;
  const fail = (msg: string) => {
    rightTarget = false;
    problems.push(msg);
  };
  if (e.op === 'none') {
    if (ps.length) fail(`expected no proposals, got ${ps.length}`);
  } else if (!ps.length) {
    fail('no proposals');
  } else {
    if (ps.some((p) => p.op !== e.op)) fail(`ops ${ps.map((p) => p.op).join(',')} != ${e.op}`);
    if (e.count !== undefined && ps.length !== e.count) fail(`count ${ps.length} != ${e.count}`);
    if (e.targets && ps.some((p) => !e.targets!.includes(p.targetNodeId ?? ''))) fail(`targets ${ps.map((p) => p.targetNodeId).join(',')} not in ${e.targets.join(',')}`);
    if (e.assetSource && ps.some((p) => p.asset?.source !== e.assetSource)) fail(`asset source != ${e.assetSource}`);
    if (e.assetCategory) {
      for (const p of ps) {
        const cat = response.annotations[p.id]?.category ?? '';
        if (!e.assetCategory.some((w) => cat.includes(w))) fail(`asset category "${cat}" not ${e.assetCategory.join('/')}`);
      }
    }
    if (e.near) {
      const anchor = item(e.near.id)!;
      for (const p of ps) {
        const d = p.transform ? dist2(plan(p.transform.position), [anchor.obb.center[0], anchor.obb.center[2]]) : Infinity;
        if (d > e.near.radius) fail(`${p.id} is ${d.toFixed(2)} m from ${e.near.id} (> ${e.near.radius})`);
      }
    }
    if (e.againstWalls && ps[0]?.transform) {
      const walls = buildRoom(ctx.interpretation).walls.filter((w) => e.againstWalls!.ids.includes(w.id));
      const [x, z] = plan(ps[0].transform.position);
      const best = Math.min(...walls.map((w) => Math.abs((x - w.a[0]) * w.inward[0] + (z - w.a[1]) * w.inward[1])));
      if (!(best <= e.againstWalls.distance)) fail(`ends ${best.toFixed(2)} m from ${e.againstWalls.ids.join('/')}`);
    }
    if (e.closerTo && ps[0]?.transform) {
      const t = item(ps[0].targetNodeId ?? '')!;
      const o = item(e.closerTo)!;
      const oc: [number, number] = [o.obb.center[0], o.obb.center[2]];
      const before = dist2([t.obb.center[0], t.obb.center[2]], oc);
      const after = dist2(plan(ps[0].transform.position), oc);
      if (!(after < before - 0.05)) fail(`not closer to ${e.closerTo}: ${before.toFixed(2)} -> ${after.toFixed(2)}`);
    }
    if (e.facing && ps[0]?.transform) {
      const o = item(e.facing)!;
      const [x, z] = plan(ps[0].transform.position);
      const want = yawFacing([o.obb.center[0] - x, o.obb.center[2] - z]);
      if (angleDiff(ps[0].transform.rotationY, want) > 0.35) fail(`yaw ${ps[0].transform.rotationY.toFixed(2)} does not face ${e.facing} (${want.toFixed(2)})`);
    }
  }

  if (e.messageIncludes && !response.message.toLowerCase().includes(e.messageIncludes.toLowerCase())) {
    fail(`message lacks "${e.messageIncludes}": "${response.message}"`);
  }

  // valid placement: independent re-validation, batch-aware
  let validPlacement = true;
  let scene: PlacementScene = { items: [...ctx.scene.items] };
  for (const p of ps) {
    const category = p.op === 'add' ? response.annotations[p.id]?.category : item(p.targetNodeId ?? '')?.category;
    const errors = validate(p, scene, ctx.interpretation, { category }).filter((v) => v.severity === 'error');
    if (errors.length || !p.validation.ok) {
      validPlacement = false;
      problems.push(`${p.id}: ${errors.map((v) => v.rule).join(',') || 'validation.ok=false'}`);
    }
    if (p.op === 'remove') scene = { items: scene.items.filter((i) => i.id !== p.targetNodeId) };
    else {
      const r = subjectFromProposal(p, scene, { category });
      if (r && 'subject' in r) {
        const s = p.op === 'add' ? { ...r.subject, id: p.id, groupId: `batch:${p.asset?.url}` } : r.subject;
        scene = { items: [...scene.items.filter((i) => i.id !== s.id), s] };
      }
    }
  }

  // useful rationale
  let usefulRationale = true;
  if (e.op === 'none') {
    if (response.message.length < 20 || !/\bnot\b|\bcan(no|')t\b|unsupported/i.test(response.message)) {
      usefulRationale = false;
      problems.push('decline message does not explain why');
    }
  }
  for (const p of ps) {
    const target = p.targetNodeId ? item(p.targetNodeId) : undefined;
    const label = response.annotations[p.id]?.label ?? '';
    const names = [target?.name, target?.category?.replace('_', ' '), label, response.annotations[p.id]?.category?.replace('_', ' ')]
      .filter((n): n is string => !!n)
      .map((n) => n.toLowerCase());
    const r = p.rationale.toLowerCase();
    const ok = p.rationale.length >= 40 && names.some((n) => r.includes(n)) && REASON_WORDS.test(p.rationale);
    if (!ok) {
      usefulRationale = false;
      problems.push(`weak rationale for ${p.id}: "${p.rationale.slice(0, 80)}"`);
    }
  }

  return { id: c.id, pass: rightTarget && validPlacement && usefulRationale, rightTarget, validPlacement, usefulRationale, problems, proposals: ps.length };
}

export async function runEvalCase(c: EvalCase, model: SpatialModel, catalog: CatalogEntry[]): Promise<CaseScore> {
  const room = c.room();
  const started = Date.now();
  const response = await handleSpatialRequest(
    { prompt: c.prompt, nodes: room.nodes, interpretation: room.interpretation, selectedIds: c.selectedIds ?? [], attachment: c.attachment },
    { model, catalog, idPrefix: c.id },
  );
  const latencyMs = Date.now() - started;
  const score = scoreResponse(c, response, catalog);
  if (response.rejectedDrafts.length) score.problems.push(`${response.rejectedDrafts.length} malformed draft(s): ${response.rejectedDrafts[0].error}`);
  return {
    ...score,
    toolCalls: response.trace.steps.length,
    turns: response.trace.turns,
    tokens: response.trace.usage.inputTokens + response.trace.usage.outputTokens,
    latencyMs,
  };
}

export function summarize(scores: CaseScore[]): string {
  const rows = scores.map(
    (s) =>
      `${s.pass ? 'PASS' : 'FAIL'}  ${s.id.padEnd(34)} target=${+s.rightTarget} valid=${+s.validPlacement} rationale=${+s.usefulRationale} proposals=${s.proposals} tools=${s.toolCalls} tokens=${s.tokens} ${s.latencyMs}ms${s.problems.length ? `\n      ${s.problems.join('\n      ')}` : ''}`,
  );
  const passed = scores.filter((s) => s.pass).length;
  rows.push(`pass rate: ${passed}/${scores.length} (${((100 * passed) / Math.max(1, scores.length)).toFixed(1)}%)`);
  return rows.join('\n');
}
