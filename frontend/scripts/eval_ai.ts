/**
 * Live spatial-agent eval against Gemini: npm run eval:ai
 * Needs GEMINI_API_KEY in the environment or frontend/.env.local; without it the run is reported as pending.
 * Photo cases are skipped: the eval set has no real reference photos, only the fake model's vision answers.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_GEMINI_MODEL, GeminiModel } from '../lib/ai/geminiModel';
import { EVAL_CASES } from '../tests/evals/ai/cases';
import { loadEvalCatalog } from '../tests/evals/ai/fixtures';
import { runEvalCase, summarize, type CaseScore } from '../tests/evals/ai/score';

function loadEnvLocal() {
  const file = path.resolve(__dirname, '../.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function main() {
  loadEnvLocal();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('eval:ai pending: GEMINI_API_KEY is not set (env or frontend/.env.local). The deterministic eval runs in vitest.');
    return;
  }
  const modelName = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const catalog = loadEvalCatalog();
  const scores: CaseScore[] = [];
  for (const c of EVAL_CASES) {
    if (c.fakeVision) {
      console.log(`SKIP  ${c.id} (needs a real reference photo)`);
      continue;
    }
    try {
      scores.push(await runEvalCase(c, new GeminiModel(apiKey, modelName), catalog));
    } catch (err) {
      scores.push({ id: c.id, pass: false, rightTarget: false, validPlacement: false, usefulRationale: false, problems: [`error: ${err instanceof Error ? err.message : String(err)}`], proposals: 0, toolCalls: 0, turns: 0, tokens: 0, latencyMs: 0 });
    }
  }
  console.log(`model: ${modelName}`);
  console.log(summarize(scores));
  const tokens = scores.reduce((t, s) => t + s.tokens, 0);
  console.log(`total tokens: ${tokens}, mean latency: ${Math.round(scores.reduce((t, s) => t + s.latencyMs, 0) / Math.max(1, scores.length))} ms`);
  if (scores.some((s) => !s.pass)) process.exitCode = 1;
}

main();
