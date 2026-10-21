/**
 * Gemini implementation of SpatialModel (@google/genai). Tools are sent as function
 * declarations with JSON-schema parameters; structured output uses responseJsonSchema.
 */
import { GoogleGenAI, type Content, type GenerateContentResponse, type Part } from '@google/genai';
import type { AgentMessage, GenerateJsonRequest, GenerateRequest, ModelTurn, ModelUsage, SpatialModel } from './model';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function toContents(messages: AgentMessage[]): Content[] {
  return messages.map((m): Content => {
    if (m.role === 'user') {
      const parts: Part[] = [];
      if (m.image) parts.push({ inlineData: { mimeType: m.image.mimeType, data: m.image.data } });
      parts.push({ text: m.text });
      return { role: 'user', parts };
    }
    if (m.role === 'model') {
      if (m.raw) return m.raw as Content;
      const parts: Part[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { id: c.id, name: c.name, args: c.args } });
      return { role: 'model', parts };
    }
    return {
      role: 'user',
      parts: m.results.map((r) => ({ functionResponse: { id: r.id, name: r.name, response: { result: r.response } } })),
    };
  });
}

function usageOf(res: GenerateContentResponse): ModelUsage | undefined {
  const u = res.usageMetadata;
  return u ? { inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 } : undefined;
}

export class GeminiModel implements SpatialModel {
  readonly name: string;
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string, private readonly model = DEFAULT_GEMINI_MODEL) {
    this.ai = new GoogleGenAI({ apiKey });
    this.name = `gemini:${model}`;
  }

  async generate(request: GenerateRequest): Promise<ModelTurn> {
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: toContents(request.messages),
      config: {
        systemInstruction: request.system,
        temperature: 0.2,
        tools: [
          {
            functionDeclarations: request.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })),
          },
        ],
      },
    });
    const calls = (res.functionCalls ?? []).map((c) => ({ id: c.id, name: c.name ?? '', args: c.args ?? {} }));
    return {
      text: calls.length ? undefined : res.text,
      toolCalls: calls,
      raw: res.candidates?.[0]?.content,
      usage: usageOf(res),
    };
  }

  async generateJson(request: GenerateJsonRequest) {
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: toContents(request.messages),
      config: {
        systemInstruction: request.system,
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseJsonSchema: request.schema,
      },
    });
    return { value: JSON.parse(res.text ?? 'null'), usage: usageOf(res) };
  }
}
