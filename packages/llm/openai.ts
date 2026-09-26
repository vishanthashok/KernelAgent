// OpenAIClient: wraps the openai SDK (Chat Completions with tools). Syscalls reach the model
// as function tools. Used through RoutingClient for gpt-* and o* models. Jobs may bring
// their own key, like the Anthropic client.
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { CompleteOptions, CompletionRequest, CompletionResponse, ContentBlock, Message, ModelClient, ModelInfo } from "./index.ts";

export const DEFAULT_OPENAI_MODEL = "gpt-5";

/** Used when the Models API cannot be reached. The live list replaces it when it can. */
export const FALLBACK_OPENAI_MODELS: ModelInfo[] = [
  { id: "gpt-5", name: "GPT-5", provider: "openai" },
  { id: "gpt-5-mini", name: "GPT-5 mini", provider: "openai" },
  { id: "gpt-4.1", name: "GPT-4.1", provider: "openai" },
];

/** Model ids this client runs. */
export const OPENAI_MODEL = /^(gpt-|chatgpt-|o\d)/;
/** Listed models that are not chat models with tool use. */
const NON_CHAT = /(audio|realtime|transcribe|tts|image|search|instruct|embedding|codex|moderation)/;
/** Reasoning models accept reasoning_effort. Others reject it. */
export const REASONING_MODELS = /^(gpt-5|o\d)/;

const MODEL_LIST_TTL_MS = 10 * 60_000;
const MAX_USER_CLIENTS = 100;

export class OpenAIClient implements ModelClient {
  readonly provider = "openai";
  readonly model: string;
  readonly acceptsUserKeys = true;
  readonly requiresUserKey: boolean;
  private client: OpenAI | undefined;
  private userClients = new Map<string, OpenAI>();
  private maxTokens: number;
  private modelCache = new Map<string, { at: number; models: ModelInfo[] }>();

  constructor(opts: { apiKey?: string; model?: string; maxTokens?: number } = {}) {
    this.client = opts.apiKey ? new OpenAI({ apiKey: opts.apiKey }) : undefined;
    this.requiresUserKey = !this.client;
    this.model = opts.model || DEFAULT_OPENAI_MODEL;
    this.maxTokens = opts.maxTokens ?? 16_000;
  }

  private clientFor(apiKey?: string): OpenAI {
    if (apiKey) {
      let c = this.userClients.get(apiKey);
      if (!c) {
        if (this.userClients.size >= MAX_USER_CLIENTS) this.userClients.delete(this.userClients.keys().next().value!);
        c = new OpenAI({ apiKey });
        this.userClients.set(apiKey, c);
      }
      return c;
    }
    if (!this.client) throw new Error("no OpenAI API key: this server needs you to bring your own key");
    return this.client;
  }

  /** Chat models a key can use, cached for 10 minutes. A user's key throws, so a bad key is reported. */
  async listModels(opts: { apiKey?: string } = {}): Promise<ModelInfo[]> {
    const cacheKey = opts.apiKey ?? "";
    const now = Date.now();
    const hit = this.modelCache.get(cacheKey);
    if (hit && now - hit.at < MODEL_LIST_TTL_MS) return hit.models;
    let models: ModelInfo[] = [];
    if (!opts.apiKey && !this.client) {
      models = FALLBACK_OPENAI_MODELS;
    } else {
      try {
        for await (const m of this.clientFor(opts.apiKey).models.list()) {
          if (OPENAI_MODEL.test(m.id) && !NON_CHAT.test(m.id)) models.push({ id: m.id, name: m.id, provider: "openai" });
        }
        models.sort((a, b) => a.id.localeCompare(b.id));
        if (models.length === 0) models = FALLBACK_OPENAI_MODELS;
      } catch (err) {
        if (opts.apiKey) throw new Error(`OpenAI rejected this key: ${(err as Error).message}`);
        console.warn(`[llm] could not list OpenAI models, using the built-in list: ${(err as Error).message}`);
        models = FALLBACK_OPENAI_MODELS;
      }
    }
    if (this.modelCache.size >= MAX_USER_CLIENTS) this.modelCache.delete(this.modelCache.keys().next().value!);
    this.modelCache.set(cacheKey, { at: now, models });
    return models;
  }

  async complete(req: CompletionRequest, opts: CompleteOptions = {}): Promise<CompletionResponse> {
    const model = opts.model || this.model;
    const response = await this.clientFor(opts.apiKey).chat.completions.create(
      {
        model,
        max_completion_tokens: this.maxTokens,
        ...(opts.effort && REASONING_MODELS.test(model) ? { reasoning_effort: opts.effort } : {}),
        messages: toOpenAIMessages(req.system, req.messages),
        ...(req.tools.length ? { tools: req.tools.map(toOpenAITool) } : {}),
      },
      opts.signal ? { signal: opts.signal } : undefined,
    );
    const choice = response.choices[0];
    if (!choice) throw new Error("OpenAI returned no choices");
    if (choice.message.refusal) throw new Error(`model refused the request: ${choice.message.refusal}`);
    return {
      content: fromOpenAIMessage(choice.message),
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      // OpenAI caches long prefixes on its own. It reports reads only and never charges for writes.
      cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
      raw: response,
    };
  }
}

function toOpenAITool(t: { name: string; description: string; input_schema: Record<string, unknown> }): ChatCompletionTool {
  return { type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } };
}

/** Kernel messages to Chat Completions messages. Tool results become role "tool" messages. */
export function toOpenAIMessages(system: string, messages: Message[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      const calls = m.content.flatMap((b) =>
        b.type === "tool_use"
          ? [{ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }]
          : [],
      );
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // A user turn: tool results first (they must follow the assistant's tool calls), then any text.
    const texts: string[] = [];
    for (const b of m.content) {
      if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `ERROR: ${b.content}` : b.content });
      else if (b.type === "text") texts.push(b.text);
    }
    if (texts.length) out.push({ role: "user", content: texts.join("\n") });
  }
  return out;
}

/** A Chat Completions message to kernel content blocks. Arguments that are not JSON pass through as a string. */
export function fromOpenAIMessage(msg: { content: string | null; tool_calls?: { id: string; type: string; function?: { name: string; arguments: string } }[] | undefined }): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (msg.content) blocks.push({ type: "text", text: msg.content });
  for (const c of msg.tool_calls ?? []) {
    if (c.type !== "function" || !c.function) continue;
    let input: unknown;
    try {
      input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      input = c.function.arguments;
    }
    blocks.push({ type: "tool_use", id: c.id, name: c.function.name, input });
  }
  return blocks;
}
