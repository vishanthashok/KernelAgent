// MockLLM: deterministic, scriptable model. Lets examples and tests run with no keys.
//
// A script is a list of steps per role. The step for a call is chosen by the number of
// assistant turns already in the conversation, so the mock is stateless and a process
// resumed from a checkpoint picks up at the right step.
import {
  estimateTokens,
  type CompletionRequest,
  type CompleteOptions,
  type CompletionResponse,
  type ContentBlock,
  type Message,
  type ModelClient,
  type ModelInfo,
  type ToolResultBlock,
} from "./index.ts";

export interface MockContext {
  role: string;
  goal: string;
  pid: string;
  jobId: string;
  turn: number;
  messages: Message[];
  /** Other processes in the same job. */
  peers: { pid: string; role: string }[];
  /** Text of the most recent tool_result, if any. */
  lastToolResult?: string;
  lastToolError?: boolean;
}

export type MockStepValue =
  | { tool: string; input: unknown; text?: string }
  | { text: string }
  | ContentBlock[];

export type MockStep = MockStepValue | ((ctx: MockContext) => MockStepValue);

export type MockScript = MockStep[];

export interface MockLLMOptions {
  /** Scripts keyed by role. */
  scripts?: Record<string, MockScript>;
  /** Used for roles with no script. */
  defaultScript?: MockScript;
  /** Artificial latency per call in ms. */
  latencyMs?: number;
}

const DEFAULT_SCRIPT: MockScript = [(ctx) => ({ text: `[mock ${ctx.role}] completed: ${ctx.goal}` })];

function lastToolResult(messages: Message[]): ToolResultBlock | undefined {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || typeof last.content === "string") return undefined;
  const blocks = last.content.filter((b): b is ToolResultBlock => b.type === "tool_result");
  return blocks[blocks.length - 1];
}

export class MockLLM implements ModelClient {
  readonly provider = "mock";
  readonly model = "mock-llm";
  private scripts: Record<string, MockScript>;
  private defaultScript: MockScript;
  private latencyMs: number;

  constructor(opts: MockLLMOptions = {}) {
    this.scripts = { ...(opts.scripts ?? {}) };
    this.defaultScript = opts.defaultScript ?? DEFAULT_SCRIPT;
    this.latencyMs = opts.latencyMs ?? 0;
  }

  setScript(role: string, script: MockScript): void {
    this.scripts[role] = script;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: this.model, name: "Mock LLM (scripted, no key)" }];
  }

  async complete(req: CompletionRequest, opts: CompleteOptions = {}): Promise<CompletionResponse> {
    if (this.latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.latencyMs);
        opts.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(opts.signal!.reason);
        });
      });
    }
    opts.signal?.throwIfAborted();

    const meta = req.metadata ?? { pid: "?", role: "default", goal: "", jobId: "?" };
    const turn = req.messages.filter((m) => m.role === "assistant").length;
    const tr = lastToolResult(req.messages);
    const ctx: MockContext = {
      role: meta.role,
      goal: meta.goal,
      pid: meta.pid,
      jobId: meta.jobId,
      turn,
      messages: req.messages,
      peers: meta.peers ?? [],
      ...(tr ? { lastToolResult: tr.content, lastToolError: tr.is_error === true } : {}),
    };

    const script = this.scripts[meta.role] ?? this.defaultScript;
    const step = script[turn];
    const value: MockStepValue =
      step === undefined ? { text: `[mock ${meta.role}] script finished` } : typeof step === "function" ? step(ctx) : step;
    const content = toBlocks(value, turn);

    return {
      content,
      inputTokens: estimateTokens(req.system) + estimateTokens(req.messages) + estimateTokens(req.tools),
      outputTokens: estimateTokens(content),
      raw: { mock: true, model: this.model, role: meta.role, turn, content },
    };
  }
}

function toBlocks(v: MockStepValue, turn: number): ContentBlock[] {
  if (Array.isArray(v)) return v;
  if ("tool" in v) {
    const blocks: ContentBlock[] = [];
    if (v.text) blocks.push({ type: "text", text: v.text });
    blocks.push({ type: "tool_use", id: `toolu_mock_${turn}`, name: v.tool, input: v.input });
    return blocks;
  }
  return [{ type: "text", text: v.text }];
}
