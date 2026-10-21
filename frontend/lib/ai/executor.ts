/**
 * Spatial agent loop. The model may call read-only tools (tools.ts) and must finish with
 * EditProposal drafts. The executor never touches the scene store: it validates every draft
 * with the placement validator, fills `validation`, and returns pending proposals that the
 * user accepts or rejects in the UI.
 */
import { z } from 'zod';
import type { AgentMessage, InlineImage, ModelUsage, SpatialModel, ToolCall } from './model';
import { INTERIOR_DESIGNER_SYSTEM_PROMPT } from './prompts/interiorDesignerPrompt';
import { finalizeProposals, type FinalizedProposals } from './proposals';
import { runReadTool, SPATIAL_TOOLS, SUBMISSION_JSON_SCHEMA, SUBMIT_TOOL, type AgentContext } from './tools';

export interface AgentTraceStep {
  tool: string;
  ok: boolean;
}

const SubmissionSchema = z.object({ message: z.string(), proposals: z.array(z.unknown()) });

export interface AgentResult extends FinalizedProposals {
  message: string;
  trace: { model: string; steps: AgentTraceStep[]; turns: number; usage: ModelUsage; forcedStructuredOutput: boolean };
}

export interface RunAgentOptions {
  model: SpatialModel;
  context: AgentContext;
  prompt: string;
  image?: InlineImage;
  maxTurns?: number;
  idPrefix?: string;
}

const addUsage = (a: ModelUsage, b?: ModelUsage): ModelUsage =>
  b ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens } : a;

function contextPrompt(ctx: AgentContext, prompt: string): string {
  const extras: string[] = [];
  if (ctx.selectedIds.length) extras.push(`Selected item ids: ${ctx.selectedIds.join(', ')}`);
  if (ctx.upload) extras.push(`The user uploaded a 3D model "${ctx.upload.name}" measuring ${ctx.upload.dimensions.join(' x ')} m (w x h x d).`);
  if (ctx.reference) extras.push(`The user attached a reference photo; vision analysis: ${JSON.stringify(ctx.reference)}`);
  return [`User request: ${prompt}`, ...extras].join('\n');
}

export async function runSpatialAgent(options: RunAgentOptions): Promise<AgentResult> {
  const { model, context: ctx, prompt, image, maxTurns = 8, idPrefix = 'proposal' } = options;
  const messages: AgentMessage[] = [{ role: 'user', text: contextPrompt(ctx, prompt), image }];
  const steps: AgentTraceStep[] = [];
  let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
  let submission: z.infer<typeof SubmissionSchema> | null = null;
  let lastText = '';
  let turns = 0;

  for (; turns < maxTurns && !submission; turns++) {
    const turn = await model.generate({ system: INTERIOR_DESIGNER_SYSTEM_PROMPT, messages, tools: SPATIAL_TOOLS });
    usage = addUsage(usage, turn.usage);
    const calls: ToolCall[] = turn.toolCalls ?? [];
    messages.push({ role: 'model', text: turn.text, toolCalls: calls, raw: turn.raw });
    if (turn.text) lastText = turn.text;
    if (!calls.length) break;

    const results = calls.map((call) => {
      if (call.name === SUBMIT_TOOL) {
        const parsed = SubmissionSchema.safeParse(call.args);
        steps.push({ tool: call.name, ok: parsed.success });
        if (parsed.success) submission = parsed.data;
        return { id: call.id, name: call.name, response: parsed.success ? { received: parsed.data.proposals.length } : { error: parsed.error.message } };
      }
      let response: unknown;
      try {
        response = runReadTool(ctx, call.name, call.args ?? {});
      } catch (err) {
        response = { error: err instanceof Error ? err.message : String(err) };
      }
      const ok = !(response && typeof response === 'object' && 'error' in response);
      steps.push({ tool: call.name, ok });
      return { id: call.id, name: call.name, response };
    });
    messages.push({ role: 'tool', results });
  }

  let forcedStructuredOutput = false;
  if (!submission) {
    // The model stopped without submitting: ask once more under a strict response schema.
    forcedStructuredOutput = true;
    messages.push({ role: 'user', text: 'Now return your final answer as JSON: a message and the EditProposal drafts (empty list if no edit fits).' });
    const { value, usage: u } = await model.generateJson({ system: INTERIOR_DESIGNER_SYSTEM_PROMPT, messages, schema: SUBMISSION_JSON_SCHEMA });
    usage = addUsage(usage, u);
    const parsed = SubmissionSchema.safeParse(value);
    submission = parsed.success ? parsed.data : { message: lastText || 'No proposals.', proposals: [] };
  }

  const done = submission as z.infer<typeof SubmissionSchema>;
  const finalized = finalizeProposals(ctx, done.proposals, idPrefix);
  return {
    message: done.message || lastText,
    ...finalized,
    trace: { model: model.name, steps, turns, usage, forcedStructuredOutput },
  };
}
