import { describe, expect, it } from "vitest";
import { costUsd, RateLimiter, TokenBucket } from "@kernelagent/kernel";
import { makeKernel, sleep } from "./helpers.ts";

const loopForever = [...Array(200)].map(() => ({ tool: "SLEEP", input: { ms: 0 } }));

describe("token budgets", () => {
  it("moves a process over its budget to FAILED with TOKEN_BUDGET_EXCEEDED and does not retry", async () => {
    // No rollovers, so the hard limit is what stops it.
    const { kernel } = makeKernel({ mock: { scripts: { hog: loopForever } }, config: { maxRollovers: 0 } });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "hog", goal: "burn tokens", tokenBudget: 3000 } });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();
    const p = kernel.pm.get(pids.p0!)!;
    expect(job.status).toBe("FAILED");
    expect(p.status).toBe("FAILED");
    expect(p.error).toMatch(/TOKEN_BUDGET_EXCEEDED/);
    expect(p.retryCount).toBe(0);
    expect(p.tokensUsed).toBeGreaterThan(3000);
    // The overrun is bounded by one call.
    const calls = kernel.bus.getEvents({ jobId, limit: 10000 }).filter((e) => e.type === "LLM_CALL");
    const last = calls[calls.length - 1]!.payload as { inputTokens: number; outputTokens: number };
    expect(p.tokensUsed - (last.inputTokens + last.outputTokens)).toBeLessThanOrEqual(3000);
  });

  it("enforces the job-wide budget across processes", async () => {
    const { kernel } = makeKernel({ mock: { scripts: { hog: loopForever } } });
    kernel.start();
    const { jobId } = kernel.submitJob({
      tokenBudget: 2000,
      processes: [
        { id: "a", role: "hog", goal: "a", tokenBudget: 100_000 },
        { id: "b", role: "hog", goal: "b", tokenBudget: 100_000 },
      ],
    });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();
    expect(job.status).toBe("FAILED");
    const errors = kernel.pm.list({ jobId }).map((p) => p.error);
    expect(errors.some((e) => /JOB_TOKEN_BUDGET_EXCEEDED/.test(e ?? ""))).toBe(true);
  });

  it("accounts cost from the price table", async () => {
    const { kernel } = makeKernel();
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "x", goal: "y" } });
    await kernel.waitForJob(jobId);
    await kernel.stop();
    const p = kernel.pm.get(pids.p0!)!;
    const call = kernel.bus.getEvents({ jobId }).find((e) => e.type === "LLM_CALL")!.payload as any;
    expect(p.costUsd).toBeCloseTo(costUsd("mock-llm", call.inputTokens, call.outputTokens), 10);
  });
});

describe("rate limiter", () => {
  it("token bucket refills over time", () => {
    let t = 0;
    const b = new TokenBucket(60, 60_000, () => t);
    expect(b.tryTake(60)).toBe(true);
    expect(b.tryTake(1)).toBe(false);
    t += 1000;
    expect(b.available()).toBeCloseTo(1);
    expect(b.msUntil(10)).toBe(9000);
    t += 120_000;
    expect(b.available()).toBe(60); // capped
  });

  it("acquire waits for capacity", async () => {
    let t = 0;
    const rl = new RateLimiter({ requestsPerMinute: 1, tokensPerMinute: 1000 }, () => t);
    await rl.acquire(10);
    expect(rl.canDispatch()).toBe(false);
    let done = false;
    const p = rl.acquire(10).then(() => (done = true));
    await sleep(20);
    expect(done).toBe(false);
    t += 60_000;
    await p;
    expect(done).toBe(true);
  });

  it("caps dispatch: processes stay READY when the request bucket is empty", async () => {
    const { kernel } = makeKernel({ config: { rateLimits: { requestsPerMinute: 2, tokensPerMinute: 1_000_000 }, maxConcurrency: 10 } });
    kernel.start();
    const { jobId } = kernel.submitJob({
      processes: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, role: "w", goal: `g${i}` })),
    });
    await sleep(150);
    const byStatus = kernel.pm.list({ jobId }).map((p) => p.status).sort();
    const calls = kernel.bus.getEvents({ jobId }).filter((e) => e.type === "LLM_CALL").length;
    await kernel.stop();
    expect(calls).toBe(2);
    expect(byStatus.filter((s) => s === "TERMINATED")).toHaveLength(2);
    expect(byStatus.filter((s) => s === "READY")).toHaveLength(3);
    expect(kernel.scheduler.throttled).toBeGreaterThan(0);
  });
});
