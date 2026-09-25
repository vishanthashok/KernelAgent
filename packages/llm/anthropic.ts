// AnthropicClient: wraps @anthropic-ai/sdk. Syscalls reach the model as tools.
// Selected when LLM_PROVIDER=anthropic. Jobs may bring their own key (see Kernel.submitJob).
import Anthropic from "@anthropic-ai/sdk";
import type { CompleteOptions, CompletionRequest, CompletionResponse, ContentBlock, Message, ModelClient, ModelInfo } from "./index.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

/** Used when the Models API cannot be reached. The live list replaces it when it can. */
export const FALLBACK_ANTHROPIC_MODELS: ModelInfo[] = [
  { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
];

const MODEL_LIST_TTL_MS = 10 * 60_000;

/** Models that accept output_config.effort. Others (Haiku 4.5, older Sonnets) reject it with a 400. */
export const EFFORT_MODELS = /^claude-(fable|mythos|opus-5|opus-4-[5-8]|sonnet-5|sonnet-4-6)/;

const MAX_USER_CLIENTS = 100;

export class AnthropicClient implements ModelClient {
  readonly provider = "anthropic";
  readonly model: string;
  readonly acceptsUserKeys = true;
  readonly requiresUserKey: boolean;
  /** Client on the server's own key. Unset when the server runs on user keys only. */
  private client: Anthropic | undefined;
  /** Clients for keys users brought, reused across calls. Memory only. */
  private userClients = new Map<string, Anthropic>();
  private maxTokens: number;
  private modelCache = new Map<string, { at: number; models: ModelInfo[] }>();

  constructor(opts: { apiKey?: string; model?: string; maxTokens?: number } = {}) {
    this.client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : undefined;
    this.requiresUserKey = !this.client;
    this.model = opts.model || DEFAULT_ANTHROPIC_MODEL;
    this.maxTokens = opts.maxTokens ?? 16_000;
  }

  private clientFor(apiKey?: string): Anthropic {
    if (apiKey) {
      let c = this.userClients.get(apiKey);
      if (!c) {
        if (this.userClients.size >= MAX_USER_CLIENTS) this.userClients.delete(this.userClients.keys().next().value!);
        c = new Anthropic({ apiKey });
        this.userClients.set(apiKey, c);
      }
      return c;
    }
    if (!this.client) throw new Error("no Anthropic API key: this server needs you to bring your own key");
    return this.client;
  }

  /**
   * Models a key can use, from the Models API, cached for 10 minutes. The server's key
   * falls back to a built-in list on error. A user's key throws, so a bad key is reported.
   */
  async listModels(opts: { apiKey?: string } = {}): Promise<ModelInfo[]> {
    const cacheKey = opts.apiKey ?? "";
    const now = Date.now();
    const hit = this.modelCache.get(cacheKey);
    if (hit && now - hit.at < MODEL_LIST_TTL_MS) return hit.models;
    let models: ModelInfo[] = [];
    if (!opts.apiKey && !this.client) {
      models = FALLBACK_ANTHROPIC_MODELS;
    } else {
      try {
        for await (const m of this.clientFor(opts.apiKey).models.list({ limit: 100 })) models.push({ id: m.id, name: m.display_name || m.id });
        if (models.length === 0) models = FALLBACK_ANTHROPIC_MODELS;
      } catch (err) {
        if (opts.apiKey) throw new Error(`Anthropic rejected this key: ${(err as Error).message}`);
        console.warn(`[llm] could not list Anthropic models, using the built-in list: ${(err as Error).message}`);
        models = FALLBACK_ANTHROPIC_MODELS;
      }
    }
    if (!models.some((m) => m.id === this.model)) models = [{ id: this.model, name: this.model }, ...models];
    if (this.modelCache.size >= MAX_USER_CLIENTS) this.modelCache.delete(this.modelCache.keys().next().value!);
    this.modelCache.set(cacheKey, { at: now, models });
    return models;
  }

  async complete(req: CompletionRequest, opts: CompleteOptions = {}): Promise<CompletionResponse> {
    const model = opts.model || this.model;
    const response = await this.clientFor(opts.apiKey).messages.create(
      {
        model,
        max_tokens: this.maxTokens,
        // Cache the whole prefix (tools, system, history). Each agent turn then reads the
        // previous turn's prefix from cache at a tenth of the input price.
        cache_control: { type: "ephemeral" },
        ...(opts.effort && EFFORT_MODELS.test(model) ? { output_config: { effort: opts.effort } } : {}),
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

    // usage.input_tokens counts only uncached input. Report the total and the cached parts.
    const cacheRead = response.usage.cache_read_input_tokens ?? 0;
    const cacheWrite = response.usage.cache_creation_input_tokens ?? 0;
    return {
      content,
      inputTokens: response.usage.input_tokens + cacheRead + cacheWrite,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
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
