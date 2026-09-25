// ModelClient interface. The kernel only ever talks to a model through this.

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Provider-specific block (e.g. a thinking block) that the kernel must carry back to the
 * provider unchanged but never interprets.
 */
export interface OpaqueBlock {
  type: "opaque";
  provider: string;
  block: unknown;
}

export type ContentBlock = TextBlock | ToolUseBlock | OpaqueBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | (ContentBlock | ToolResultBlock)[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CompletionRequest {
  system: string;
  messages: Message[];
  tools: ToolDef[];
  /** Kernel metadata. Real providers ignore it. The mock uses it to pick a script. */
  metadata?: { pid: string; role: string; goal: string; jobId: string; peers?: { pid: string; role: string }[] };
}

export interface CompletionResponse {
  content: ContentBlock[];
  /** All input tokens, including any read from or written to the prompt cache. */
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the prompt cache. */
  cacheReadTokens?: number;
  /** Input tokens written to the prompt cache. */
  cacheWriteTokens?: number;
  raw: unknown;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface CompleteOptions {
  signal?: AbortSignal;
  /** Override the client's default model for this call. */
  model?: string;
  /** A user's own provider key for this call, instead of the server's. */
  apiKey?: string;
  /** Reasoning effort. Clients drop it for models that do not support it. */
  effort?: Effort;
}

export type Effort = "low" | "medium" | "high";

export interface ModelClient {
  readonly provider: string;
  /** Default model, used when a job does not pick one. */
  readonly model: string;
  complete(req: CompletionRequest, opts?: CompleteOptions): Promise<CompletionResponse>;
  /** Whether a job can bring its own provider key. */
  readonly acceptsUserKeys: boolean;
  /** Whether jobs must bring a key because the server has none. */
  readonly requiresUserKey: boolean;
  /** Models this client can run. With apiKey, the models that key can use. */
  listModels(opts?: { apiKey?: string }): Promise<ModelInfo[]>;
}

/** Rough token estimate: 4 characters per token. Used for rate-limit pre-checks and the mock. */
export function estimateTokens(value: unknown): number {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.max(1, Math.ceil(s.length / 4));
}

export { MockLLM, type MockScript, type MockStep, type MockStepValue, type MockContext, type MockLLMOptions } from "./mock.ts";
export { createModelClient } from "./factory.ts";
