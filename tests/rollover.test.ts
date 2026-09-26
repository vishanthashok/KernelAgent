import { describe, expect, it } from "vitest";
import { createRepositories } from "@kernelagent/db";
import { budgetTokens, Kernel, replayProcesses } from "@kernelagent/kernel";
import { MockLLM, type CompleteOptions, type CompletionRequest, type Message, type MockStep } from "@kernelagent/llm";
import { Worker } from "@kernelagent/runtime";
import { LocalSandbox } from "@kernelagent/sandbox";
import { makeKernel } from "./helpers.ts";

const firstText = (messages: Message[]) => {
  const c = messages[0]?.content;
  return typeof c === "string" ? c : "";
};
const lastUserText = (messages: Message[]) => {
  const c = messages[messages.length - 1]?.content;
  if (typeof c === "string") return c;
  return (c ?? []).flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
};

// Sleeps until its history has been compacted, then exits with an answer.
const untilCompacted: MockStep[] = [...Array(200)].map(
  () => (ctx: { messages: Message[] }) =>
    firstText(ctx.messages).includes("Progress so far")
      ? { tool: "EXIT", input: { result: "finished after rollover" } }
      : { tool: "SLEEP", input: { ms: 0 } },
);

// Sleeps until told the budget is nearly spent, then exits with an answer.
const untilWrapUp: MockStep[] = [...Array(200)].map(
  () => (ctx: { messages: Message[] }) =>
    lastUserText(ctx.messages).includes("budget is nearly spent")
      ? { tool: "EXIT", input: { result: "partial answer" } }
      : { tool: "SLEEP", input: { ms: 0 } },
);

describe("budget rollover", () => {
  it("continues from a compacted history instead of failing, and replay matches", async () => {
    const { kernel } = makeKernel({ mock: { scripts: { worker: untilCompacted } } });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "worker", goal: "long task", tokenBudget: 3000 } });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();

    expect(job.status).toBe("COMPLETED");
    const p = kernel.pm.get(pids.p0!)!;
    expect(p.result).toBe("finished after rollover");
    expect(p.tokenBudget).toBe(6000);

    const events = kernel.bus.getEvents({ jobId, limit: 100_000 });
    const ext = events.filter((e) => e.type === "BUDGET_EXTENDED");
    expect(ext).toHaveLength(1);
    expect(ext[0]!.payload).toMatchObject({ tokenBudget: 6000, added: 3000, rollover: 1 });

    // The call after the rollover sends one compacted message that lists the earlier steps.
    const calls = events.filter((e) => e.type === "LLM_CALL").map((e) => (e.payload as any).request.messages as Message[]);
    const after = calls.find((m) => firstText(m).includes("Progress so far"))!;
    expect(after).toHaveLength(1);
    expect(firstText(after)).toContain("Your goal: long task");
    expect(firstText(after)).toContain("- SLEEP(");

    const r = replayProcesses(events).get(p.pid)!;
    expect({ tokenBudget: r.tokenBudget, tokensUsed: r.tokensUsed }).toEqual({ tokenBudget: p.tokenBudget, tokensUsed: p.tokensUsed });
  });

  it("asks for the answer once rollovers are used up", async () => {
    const { kernel } = makeKernel({ mock: { scripts: { worker: untilWrapUp } }, config: { maxRollovers: 0 } });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "worker", goal: "long task", tokenBudget: 3000 } });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();
    expect(job.status).toBe("COMPLETED");
    expect(kernel.pm.get(pids.p0!)!.result).toBe("partial answer");
  });

  it("never extends past the job budget", async () => {
    const { kernel } = makeKernel({ mock: { scripts: { worker: untilWrapUp } } });
    kernel.start();
    const { jobId } = kernel.submitJob({ tokenBudget: 3000, process: { role: "worker", goal: "long task", tokenBudget: 3000 } });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();
    expect(job.status).toBe("COMPLETED");
    expect(kernel.bus.getEvents({ jobId, limit: 100_000 }).some((e) => e.type === "BUDGET_EXTENDED")).toBe(false);
  });
});

describe("cache-weighted budgets", () => {
  it("charges cached input at a tenth", async () => {
    class CachedMock extends MockLLM {
      override async complete(req: CompletionRequest, opts?: CompleteOptions) {
        const r = await super.complete(req, opts);
        return { ...r, cacheReadTokens: r.inputTokens };
      }
    }
    const kernel = new Kernel({
      llm: new CachedMock(),
      sandbox: new LocalSandbox(),
      repos: createRepositories(":memory:"),
      config: { tickMs: 10 },
    });
    kernel.attachRunner(new Worker(kernel));
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "x", goal: "y" } });
    await kernel.waitForJob(jobId);
    await kernel.stop();

    const call = kernel.bus.getEvents({ jobId }).find((e) => e.type === "LLM_CALL")!.payload as any;
    expect(call.cacheReadTokens).toBe(call.inputTokens);
    const p = kernel.pm.get(pids.p0!)!;
    expect(p.tokensUsed).toBe(budgetTokens(call.inputTokens, call.outputTokens, { read: call.inputTokens }));
    expect(p.tokensUsed).toBeLessThan(call.inputTokens + call.outputTokens);
    expect(replayProcesses(kernel.bus.getEvents({ jobId })).get(p.pid)!.tokensUsed).toBe(p.tokensUsed);
  });
});

describe("child exit notice and RECEIVE deadlocks", () => {
  it("wakes a parent blocked on RECEIVE when its child fails, with the child's last output", async () => {
    const { kernel } = makeKernel({
      config: { maxRollovers: 0 },
      mock: {
        scripts: {
          boss: [
            { tool: "SPAWN", input: { role: "hog", goal: "burn", capabilities: [], tokenBudget: 500 } },
            { tool: "RECEIVE", input: {} },
            (ctx) => ({ tool: "EXIT", input: { result: ctx.lastToolResult! } }),
          ],
          hog: [...Array(200)].map(() => ({ tool: "SLEEP", input: { ms: 0 }, text: "working on it" })),
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({
      process: { role: "boss", goal: "delegate", tokenBudget: 50_000, maxRetries: 0, capabilities: [{ type: "SPAWN" }, { type: "RECEIVE" }] },
    });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();

    expect(job.status).toBe("FAILED"); // the child failed
    const boss = kernel.pm.get(pids.p0!)!;
    expect(boss.status).toBe("TERMINATED");
    const msg = JSON.parse(boss.result!).message;
    expect(msg).toMatchObject({ type: "CHILD_EXIT", role: "hog", status: "FAILED", lastOutput: "working on it" });
    expect(msg.error).toMatch(/TOKEN_BUDGET_EXCEEDED/);
  });

  it("releases processes that all wait on RECEIVE with nobody left to send", async () => {
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          listener: [{ tool: "RECEIVE", input: {} }, (ctx) => ({ tool: "EXIT", input: { result: ctx.lastToolResult! } })],
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({
      processes: [
        { id: "a", role: "listener", goal: "wait", capabilities: [{ type: "RECEIVE" }] },
        { id: "b", role: "listener", goal: "wait", capabilities: [{ type: "RECEIVE" }] },
      ],
    });
    const job = await kernel.waitForJob(jobId, 5000);
    await kernel.stop();
    expect(job.status).toBe("COMPLETED");
    for (const pid of [pids.a!, pids.b!]) expect(JSON.parse(kernel.pm.get(pid)!.result!)).toMatchObject({ closed: true });
  });
});
