/**
 * Provider-neutral model interface for the spatial agent. The agent only talks to a model
 * through this interface, so tests can swap in a scripted fake (scriptedModel.ts) and the
 * route can use Gemini (geminiModel.ts) or the offline planner (heuristicModel.ts).
 */

/** A JSON Schema object (the subset Gemini accepts: type, properties, items, enum, required, min/maxItems). */
export type JsonSchema = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id?: string;
  name: string;
  response: unknown;
}

export interface InlineImage {
  mimeType: string;
  /** Base64 payload without the data-URL prefix. */
  data: string;
}

export type AgentMessage =
  | { role: 'user'; text: string; image?: InlineImage }
  /** `raw` keeps the provider's own turn (e.g. Gemini thought signatures) for faithful replay. */
  | { role: 'model'; text?: string; toolCalls?: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: ToolResult[] };

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelTurn {
  text?: string;
  toolCalls?: ToolCall[];
  raw?: unknown;
  usage?: ModelUsage;
}

export interface GenerateRequest {
  system: string;
  messages: AgentMessage[];
  tools: ToolSpec[];
}

export interface GenerateJsonRequest {
  system: string;
  messages: AgentMessage[];
  schema: JsonSchema;
}

export interface SpatialModel {
  readonly name: string;
  /** One agent turn: the model either calls tools or answers in text. */
  generate(request: GenerateRequest): Promise<ModelTurn>;
  /** Structured output constrained to `schema`; returns the parsed JSON value. */
  generateJson(request: GenerateJsonRequest): Promise<{ value: unknown; usage?: ModelUsage }>;
}
