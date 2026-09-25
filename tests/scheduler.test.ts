import { describe, expect, it } from "vitest";
import { createRepositories } from "@kernelagent/db";
import { EventBus, ProcessManager, Scheduler, type Process } from "@kernelagent/kernel";
import { makeKernel } from "./helpers.ts";

function setup(opts: { maxConcurrency?: number; agingFactor?: number; canDispatch?: () => boolean } = {}) {
  let clock = 0;
  const now = () => clock;
  const repos = createRepositories(":memory:");
  const bus = new EventBus(repos.events, now);
  const pm = new ProcessManager(bus, repos.processes, now);
  const dispatched: string[] = [];
  const sched = new Scheduler(pm, {
    maxConcurrency: opts.maxConcurrency ?? 1,
    agingFactor: opts.agingFactor ?? 0,
    tickMs: 1000,
    now,
    ...(opts.canDispatch ? { canDispatch: opts.canDispatch } : {}),
    dispatch: (p: Process) => dispatched.push(p.pid),
  });
  const add = (pid: string, priority: number, dependsOn: string[] = []) => {
    pm.create({ pid, jobId: "j", role: "r", goal: "g", priority, tokenBudget: 10, capabilities: [], dependsOn, maxRetries: 0, timeoutMs: 1e9 });
    pm.transition(pid, "READY");
  };
  const finish = (pid: string) => pm.transition(pid, "TERMINATED");
  return { pm, sched, dispatched, add, finish, advance: (ms: number) => (clock += ms) };
}

describe("scheduler", () => {
  it("dispatches by priority, highest first", () => {
    const s = setup();
    s.add("1", 1);
    s.add("2", 5);
    s.add("3", 3);
    for (let i = 0; i < 3; i++) {
      s.sched.tick();
      s.finish(s.dispatched[s.dispatched.length - 1]!);
    }
    expect(s.dispatched).toEqual(["2", "3", "1"]);
  });

  it("aging lets a long-waiting low-priority process overtake", () => {
    const s = setup({ agingFactor: 1 });
    s.add("low", 0);
    s.advance(20_000); // low has waited 20s -> effective 20
    s.add("high", 10);
    s.sched.tick();
    expect(s.dispatched).toEqual(["low"]);
  });

  it("without aging, the same setup starves the low-priority process", () => {
    const s = setup({ agingFactor: 0 });
    s.add("low", 0);
    s.advance(20_000);
    s.add("high", 10);
    s.sched.tick();
    expect(s.dispatched).toEqual(["high"]);
  });

  it("respects dependencies", () => {
    const s = setup({ maxConcurrency: 5 });
    s.add("a", 0);
    s.add("b", 100, ["a"]);
    s.sched.tick();
    expect(s.dispatched).toEqual(["a"]);
    s.finish("a");
    s.sched.tick();
    expect(s.dispatched).toEqual(["a", "b"]);
  });

  it("honors the concurrency cap", () => {
    const s = setup({ maxConcurrency: 2 });
    for (let i = 1; i <= 5; i++) s.add(String(i), 0);
    expect(s.sched.tick()).toBe(2);
    expect(s.sched.running()).toBe(2);
    expect(s.sched.tick()).toBe(0);
    s.finish(s.dispatched[0]!);
    expect(s.sched.tick()).toBe(1);
  });

  it("leaves processes READY when the admission check refuses", () => {
    let allow = false;
    const s = setup({ maxConcurrency: 5, canDispatch: () => allow });
    s.add("1", 0);
    expect(s.sched.tick()).toBe(0);
    expect(s.pm.get("1")?.status).toBe("READY");
    allow = true;
    expect(s.sched.tick()).toBe(1);
  });
});

describe("scheduler inside the kernel", () => {
  it("runs processes concurrently but never above MAX_CONCURRENCY", async () => {
    const { kernel } = makeKernel({ mock: { latencyMs: 30 }, config: { maxConcurrency: 3 } });
    kernel.start();
    const { jobId } = kernel.submitJob({
      processes: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, role: "worker", goal: `task ${i}` })),
    });
    const job = await kernel.waitForJob(jobId, 10_000);
    await kernel.stop();
    expect(job.status).toBe("COMPLETED");

    let running = 0;
    let peak = 0;
    for (const e of kernel.bus.getEvents({ jobId })) {
      if (e.type !== "STATE_CHANGE") continue;
      const { from, to } = e.payload as { from: string; to: string };
      if (to === "RUNNING") running++;
      if (from === "RUNNING") running--;
      peak = Math.max(peak, running);
    }
    expect(peak).toBe(3);
  });

  it("keeps dependents NEW until their dependencies TERMINATE", async () => {
    const { kernel } = makeKernel({ mock: { latencyMs: 20 } });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({
      processes: [
        { id: "a", role: "planner", goal: "plan" },
        { id: "b", role: "coder", goal: "code", dependsOn: ["a"] },
        { id: "c", role: "reviewer", goal: "review", dependsOn: ["a", "b"] },
      ],
    });
    expect(kernel.pm.get(pids.b!)?.status).toBe("NEW");
    expect(kernel.pm.get(pids.c!)?.status).toBe("NEW");
    await kernel.waitForJob(jobId);
    await kernel.stop();

    const order = kernel.bus
      .getEvents({ jobId })
      .filter((e) => e.type === "STATE_CHANGE")
      .map((e) => `${e.pid}:${(e.payload as { to: string }).to}`);
    const idx = (s: string) => order.indexOf(s);
    expect(idx(`${pids.b}:READY`)).toBeGreaterThan(idx(`${pids.a}:TERMINATED`));
    expect(idx(`${pids.c}:READY`)).toBeGreaterThan(idx(`${pids.b}:TERMINATED`));
  });

  it("fails dependents when a dependency fails permanently", async () => {
    const { kernel } = makeKernel({
      mock: { scripts: { broken: [() => { throw new Error("model exploded"); }] } },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({
      processes: [
        { id: "a", role: "broken", goal: "x", maxRetries: 1 },
        { id: "b", role: "coder", goal: "y", dependsOn: ["a"] },
      ],
    });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();
    expect(job.status).toBe("FAILED");
    expect(kernel.pm.get(pids.a!)).toMatchObject({ status: "FAILED", retryCount: 1 });
    expect(kernel.pm.get(pids.b!)).toMatchObject({ status: "FAILED" });
  });
});
