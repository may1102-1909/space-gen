import { describe, expect, it } from 'vitest';
import { HeuristicModel } from '@/lib/ai/heuristicModel';
import { EVAL_CASES } from '../../evals/ai/cases';
import { loadEvalCatalog } from '../../evals/ai/fixtures';
import { runEvalCase, summarize, type CaseScore } from '../../evals/ai/score';

describe('spatial agent eval (deterministic offline model)', () => {
  const catalog = loadEvalCatalog();

  it('has 15 cases over the realistic room and synthetic rooms', () => {
    expect(EVAL_CASES).toHaveLength(15);
    expect(new Set(EVAL_CASES.map((c) => c.room().id))).toEqual(new Set(['realistic_room', 'synthetic_dining', 'synthetic_bedroom']));
  });

  it('passes every case: right target, valid placement, useful rationale', async () => {
    const scores: CaseScore[] = [];
    for (const c of EVAL_CASES) scores.push(await runEvalCase(c, new HeuristicModel({ vision: c.fakeVision }), catalog));
    console.log(summarize(scores));
    expect(scores.filter((s) => !s.pass).map((s) => `${s.id}: ${s.problems.join('; ')}`)).toEqual([]);
    // Trajectory budget from the eval skill: under 8 tool calls per task.
    expect(Math.max(...scores.map((s) => s.toolCalls))).toBeLessThan(8);
  });
});
