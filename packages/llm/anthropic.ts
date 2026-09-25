// AnthropicClient: wraps @anthropic-ai/sdk. Syscalls reach the model as tools.
// Selected when LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY is set.
import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResponse, ContentBlock, Message, ModelClient } from "./index.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export class AnthropicClient implements ModelClient {
  readonly provider = "anthropic";
  readonly model: string;
  private client: Anthropic;
  private maxTokens: number;

  constructor(opts: { apiKey?: string; model?: string; maxTokens?: number } = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model || DEFAULT_ANTHROPIC_MODEL;
    this.maxTokens = opts.maxTokens ?? 16_000;
  }

  async complete(req: CompletionRequest, opts: { signal?: AbortSignal } = {}): Promise<CompletionResponse> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        system: req.system,
        messages: req.messages.map(toParam),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
      },
      opts.signal ? { signal: opts.signal } : undefined,
    );

    if (response.stop_reason === "refusal") {
      throw new Error(`model refused the request: ${JSON.stringify(response.stop_details ?? null)}`);
    }

    const content: ContentBlock[] = response.content.map((b): ContentBlock => {
      if (b.type === "text") return { type: "text", text: b.text };
      if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      // Thinking and other provider blocks are carried back unchanged on the next turn.
      return { type: "opaque", provider: "anthropic", block: b };
    });

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      raw: response,
    };
  }
}

function toParam(m: Message): Anthropic.MessageParam {
  if (typeof m.content === "string") return { role: m.role, content: m.content };
  const blocks = m.content.map((b) => {
    switch (b.type) {
      case "text":
        return { type: "text" as const, text: b.text };
      case "tool_use":
        return { type: "tool_use" as const, id: b.id, name: b.name, input: b.input };
      case "tool_result":
        return {
          type: "tool_result" as const,
          tool_use_id: b.tool_use_id,
          content: b.content,
          ...(b.is_error ? { is_error: true } : {}),
        };
      case "opaque":
        return b.block as Anthropic.ContentBlockParam;
    }
  });
  return { role: m.role, content: blocks as Anthropic.ContentBlockParam[] };
}
