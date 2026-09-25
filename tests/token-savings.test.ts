import { describe, expect, it, vi } from "vitest";
import { costUsd } from "@kernelagent/kernel";
import { AnthropicClient } from "@kernelagent/llm/anthropic";
import { capToolResult, MAX_TOOL_RESULT_CHARS } from "@kernelagent/runtime";
import { makeKernel } from "./helpers.ts";

/** An AnthropicClient whose SDK call is replaced by a spy. */
function stubbedClient(usage: Record<string, number | null>) {
  const client = new AnthropicClient({ apiKey: "test-key" });
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn",
    usage: { output_tokens: 10, ...usage },
  });
  (client as unknown as { client: { messages: { create: typeof create } } }).client.messages.create = create;
  return { client, create };
}

const REQ = { system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: [] };

describe("prompt caching and cost", () => {
  it("asks the API to cache the prefix and reports cached tokens", async () => {
    const { client, create } = stubbedClient({ input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 });
    const res = await client.complete(REQ);
    expect(create.mock.calls[0]![0].cache_control).toEqual({ type: "ephemeral" });
    expect(res).toMatchObject({ inputTokens: 1050, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 50 });
  });

  it("prices cache reads at 0.1x and writes at 1.25x of input", () => {
    // claude-sonnet-5: $2 in, $10 out per MTok.
    const full = costUsd("claude-sonnet-5", 1_000_000, 0);
    expect(full).toBeCloseTo(2, 10);
    expect(costUsd("claude-sonnet-5", 1_000_000, 0, { read: 1_000_000 })).toBeCloseTo(0.2, 10);
    expect(costUsd("claude-sonnet-5", 1_000_000, 0, { write: 1_000_000 })).toBeCloseTo(2.5, 10);
    expect(costUsd("claude-sonnet-5", 1_000_000, 1_000_000, { read: 500_000 })).toBeCloseTo(1 + 0.1 + 10, 10);
    // Dated snapshot ids price like their base id.
    expect(costUsd("claude-haiku-4-5-20251001", 1_000_000, 0)).toBeCloseTo(1, 10);
  });
});

describe("effort", () => {
  it("sends effort only to models that accept it", async () => {
    const { client, create } = stubbedClient({ input_tokens: 1 });
    await client.complete(REQ, { model: "claude-sonnet-5", effort: "low" });
    await client.complete(REQ, { model: "claude-haiku-4-5-20251001", effort: "low" });
    await client.complete(REQ, { model: "claude-sonnet-5" });
    expect(create.mock.calls[0]![0].output_config).toEqual({ effort: "low" });
    expect(create.mock.calls[1]![0].output_config).toBeUndefined();
    expect(create.mock.calls[2]![0].output_config).toBeUndefined();
  });

  it("gives listed processes the job effort and spawned children subagentEffort", async () => {
    const { kernel, llm } = makeKernel({
      mock: {
        scripts: {
          lead: [{ tool: "SPAWN", input: { role: "child", goal: "sub" } }, { text: "done" }],
          child: [{ text: "child done" }],
        },
      },
    });
    const seen: Record<string, string | undefined> = {};
    const complete = llm.complete.bind(llm);
    vi.spyOn(llm, "complete").mockImplementation((req, opts) => {
      seen[req.metadata!.role] = opts?.effort;
      return complete(req, opts);
    });
    kernel.start();
    const a = kernel.submitJob({ effort: "high", process: { role: "lead", goal: "g", capabilities: [{ type: "SPAWN" }] } });
    await kernel.waitForJob(a.jobId);
    expect(seen).toEqual({ lead: "high", child: "low" });

    const b = kernel.submitJob({ effort: "medium", subagentEffort: "medium", process: { role: "lead", goal: "g", capabilities: [{ type: "SPAWN" }] } });
    await kernel.waitForJob(b.jobId);
    expect(seen).toEqual({ lead: "medium", child: "medium" });
    await kernel.stop();
  });
});

describe("input hygiene", () => {
  it("caps tool results the model sees and keeps the head and tail", () => {
    expect(capToolResult("short")).toBe("short");
    const big = "a".repeat(30_000) + "END";
    const capped = capToolResult(big);
    expect(capped.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(capped.startsWith("aaaa")).toBe(true);
    expect(capped.endsWith("END")).toBe(true);
    expect(capped).toContain("truncated");
  });

  it("clips long peer goals in the system prompt", async () => {
    const { kernel } = makeKernel();
    kernel.start();
    const long = "x".repeat(5000);
    const { jobId, pids } = kernel.submitJob({
      processes: [
        { id: "a", role: "one", goal: long },
        { id: "b", role: "two", goal: "short goal" },
      ],
    });
    await kernel.waitForJob(jobId);
    const call = kernel.bus.getEvents({ jobId, pid: pids.b!, limit: 100 }).find((e) => e.type === "LLM_CALL")!;
    const system = (call.payload as { request: { system: string } }).request.system;
    expect(system.length).toBeLessThan(long.length);
    expect(system).toContain("x".repeat(100));
    await kernel.stop();
  });
});
