import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "@kernelagent/api";
import { makeKernel } from "./helpers.ts";

type FastifyInstance = Awaited<ReturnType<typeof buildServer>>;
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("GET /metrics", () => {
  it("aggregates the event log into buckets, totals, and breakdowns", async () => {
    const { kernel, llm } = makeKernel({
      mock: {
        scripts: {
          // A denied EXEC (no capability), then a normal exit.
          denied: [{ tool: "EXEC", input: { cmd: "ls" } }, { text: "done" }],
          // A syscall that fails (no such file), then exit.
          reader: [{ tool: "FS_READ", input: { path: "/missing.txt" } }, { text: "read" }],
          crasher: [
            () => {
              throw new Error("boom");
            },
          ],
        },
      },
    });
    // One call reports cache usage, so hit rate and savings are nonzero.
    const complete = llm.complete.bind(llm);
    let first = true;
    vi.spyOn(llm, "complete").mockImplementation(async (req, opts) => {
      const r = await complete(req, opts);
      if (!first) return r;
      first = false;
      return { ...r, inputTokens: 1000, cacheReadTokens: 600, cacheWriteTokens: 0 };
    });
    kernel.start();
    app = await buildServer(kernel);

    const a = kernel.submitJob({ name: "denied job", process: { role: "denied", goal: "g" } });
    const b = kernel.submitJob({ name: "reader job", process: { role: "reader", goal: "g", capabilities: [{ type: "FS_READ" }] } });
    const c = kernel.submitJob({ name: "crash job", process: { role: "crasher", goal: "g", maxRetries: 0 } });
    await Promise.all([a, b, c].map((j) => kernel.waitForJob(j.jobId)));

    const res = await app.inject({ method: "GET", url: "/metrics?range=1h" });
    expect(res.statusCode).toBe(200);
    const m = res.json();

    expect(m.buckets).toHaveLength(60);
    expect(m.bucketMs).toBe(60_000);
    expect(m.to - m.from).toBe(3_600_000);

    const events = kernel.bus.getEvents({ limit: 100_000 });
    const llmCalls = events.filter((e) => e.type === "LLM_CALL");
    const syscalls = events.filter((e) => e.type === "SYSCALL");
    const t = m.totals;
    expect(t.llmCalls).toBe(llmCalls.length);
    expect(t.syscalls).toBe(syscalls.length);
    expect(t.inputTokens).toBe(sum(llmCalls.map((e) => (e.payload as { inputTokens: number }).inputTokens)));
    expect(t.costUsd).toBeCloseTo(sum(llmCalls.map((e) => (e.payload as { costUsd: number }).costUsd)), 10);

    // Buckets add up to the totals.
    expect(sum(m.buckets.map((b: { llmCalls: number }) => b.llmCalls))).toBe(t.llmCalls);
    expect(sum(m.buckets.map((b: { uncachedInput: number; cachedInput: number }) => b.uncachedInput + b.cachedInput))).toBe(t.inputTokens);
    expect(sum(m.buckets.flatMap((b: { syscalls: Record<string, number> }) => Object.values(b.syscalls)))).toBe(t.syscalls);

    // Cache math.
    expect(t.cachedTokens).toBe(600);
    expect(t.cacheHitRate).toBeCloseTo(600 / t.inputTokens, 10);
    expect(t.savingsUsd).toBeGreaterThan(0);

    // Errors: one denial, one failed read, one crash.
    expect(t.denials).toBe(1);
    expect(t.failedSyscalls).toBe(1);
    expect(t.crashes).toBe(1);
    expect(t.errorRate).toBeCloseTo(2 / t.syscalls, 10);
    expect(t.agentsFailed).toBe(1);
    expect(t.agentsFinished).toBe(2);
    expect(t.p95Ms).toBeGreaterThanOrEqual(t.p50Ms);
    const kinds = m.recentErrors.map((e: { kind: string }) => e.kind).sort();
    expect(kinds).toEqual(["crash", "denied", "failed"]);

    // Breakdowns.
    expect(m.byModel).toEqual([expect.objectContaining({ model: "mock-llm", calls: t.llmCalls })]);
    expect(m.topJobs.map((j: { name: string }) => j.name).sort()).toEqual(["denied job", "reader job"]);
    expect(m.syscallTypes).toEqual(expect.arrayContaining(["EXEC", "EXIT", "FS_READ"]));

    // Nothing ran in the hour before.
    expect(m.previous.llmCalls).toBe(0);
    expect(m.now.states.TERMINATED + m.now.states.FAILED).toBe(3);
    await kernel.stop();
  });

  it("rejects an unknown range", async () => {
    const { kernel } = makeKernel();
    app = await buildServer(kernel);
    expect((await app.inject({ method: "GET", url: "/metrics?range=2y" })).statusCode).toBe(400);
  });
});
