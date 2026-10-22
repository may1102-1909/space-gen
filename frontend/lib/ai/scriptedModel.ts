/**
 * Deterministic fake model for tests: plays back a script of turns. A step may be a fixed turn
 * or a function of the conversation so far (e.g. "submit the solver's first layout").
 */
import type { AgentMessage, GenerateJsonRequest, GenerateRequest, ModelTurn, SpatialModel, ToolResult } from './model';

export type ScriptStep = ModelTurn | ((messages: AgentMessage[]) => ModelTurn);

export class ScriptedModel implements SpatialModel {
  readonly name = 'scripted';
  private index = 0;
  readonly requests: GenerateRequest[] = [];

  constructor(
    private readonly steps: ScriptStep[],
    private readonly json: (request: GenerateJsonRequest) => unknown = () => ({ message: '', proposals: [] }),
  ) {}

  async generate(request: GenerateRequest): Promise<ModelTurn> {
    this.requests.push(request);
    const step = this.steps[this.index++];
    if (!step) return { text: 'Script finished.' };
    return typeof step === 'function' ? step(request.messages) : step;
  }

  async generateJson(request: GenerateJsonRequest) {
    return { value: this.json(request) };
  }
}

/** Latest response of the named tool in the conversation. */
export function lastToolResponse<T = unknown>(messages: AgentMessage[], name: string): T | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'tool') continue;
    const hit = [...m.results].reverse().find((r: ToolResult) => r.name === name);
    if (hit) return hit.response as T;
  }
  return undefined;
}
