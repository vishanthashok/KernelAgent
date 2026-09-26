import { describe, expect, it } from "vitest";
import { makeKernel, sleep, syscallEvents } from "./helpers.ts";

const states = (kernel: ReturnType<typeof makeKernel>["kernel"], jobId: string, pid: string) =>
  kernel.bus
    .getEvents({ jobId, pid, limit: 10_000 })
    .filter((e) => e.type === "STATE_CHANGE")
    .map((e) => `${(e.payload as any).to}${(e.payload as any).reason ? `:${(e.payload as any).reason}` : ""}`);

describe("kill", () => {
  it("kills a process and its descendants, destroys sandboxes, and logs killed exits", async () => {
    const { kernel, sandbox } = makeKernel({
      mock: {
        scripts: {
          parent: [
            { tool: "SPAWN", input: { role: "child", goal: "wait", capabilities: [{ type: "RECEIVE" }, { type: "FS_WRITE" }] } },
            { tool: "RECEIVE", input: {} },
          ],
          // The child sleeps: if both sat on RECEIVE the kernel would release them as deadlocked.
          child: [{ tool: "FS_WRITE", input: { path: "/x", content: "1" } }, { tool: "SLEEP", input: { ms: 10_000 } }],
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({
      process: { role: "parent", goal: "spawn and wait", capabilities: [{ type: "SPAWN" }, { type: "RECEIVE" }, { type: "FS_WRITE" }] },
    });
    await sleep(80);
    const child = kernel.pm.list({ jobId }).find((p) => p.parentPid === pids.p0)!;
    expect(kernel.pm.get(child.pid)!.status).toBe("WAITING");
    expect(sandbox.list().length).toBe(2);

    const killed = kernel.kill(pids.p0!);
    expect(killed.sort()).toEqual([pids.p0, child.pid].sort());
    const job = await kernel.waitForJob(jobId);
    await sleep(20);
    await kernel.stop();

    expect(job.status).toBe("FAILED");
    for (const pid of killed) {
      expect(kernel.pm.get(pid)).toMatchObject({ status: "TERMINATED", error: "KILLED" });
      const exit = kernel.bus.getEvents({ pid }).find((e) => e.type === "PROCESS_EXIT")!;
      expect(exit.payload).toMatchObject({ killed: true });
    }
    expect(sandbox.list()).toEqual([]);
  });

  it("fails dependents of a killed process", async () => {
    const { kernel } = makeKernel({ mock: { scripts: { slow: [{ tool: "SLEEP", input: { ms: 10_000 } }] } } });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({
      processes: [
        { id: "a", role: "slow", goal: "x" },
        { id: "b", role: "w", goal: "y", dependsOn: ["a"] },
      ],
    });
    await sleep(30);
    kernel.kill(pids.a!);
    await kernel.waitForJob(jobId);
    await kernel.stop();
    expect(kernel.pm.get(pids.b!)).toMatchObject({ status: "FAILED" });
    expect(states(kernel, jobId, pids.b!)).toEqual(["FAILED:DEPENDENCY_FAILED"]);
  });
});

describe("timeout", () => {
  it("fails a process that exceeds its wall-clock limit, retries it, then gives up", async () => {
    const { kernel } = makeKernel({ mock: { scripts: { stuck: [{ tool: "SLEEP", input: { ms: 60_000 } }] } } });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "stuck", goal: "hang", timeoutMs: 120, maxRetries: 1 } });
    const job = await kernel.waitForJob(jobId, 5000);
    await kernel.stop();
    expect(job.status).toBe("FAILED");
    expect(kernel.pm.get(pids.p0!)).toMatchObject({ status: "FAILED", retryCount: 1 });
    expect(states(kernel, jobId, pids.p0!).filter((s) => s.startsWith("FAILED"))).toEqual(["FAILED:TIMEOUT", "FAILED:TIMEOUT"]);
  });
});

describe("retry", () => {
  const crashOnce = () => {
    let crashed = false;
    return () => {
      if (!crashed) {
        crashed = true;
        throw new Error("transient model failure");
      }
      return { tool: "EXEC", input: { cmd: "cat log.txt" } };
    };
  };
  const caps = [{ type: "EXEC" }, { type: "FS_READ" }];

  it("resumes from the last checkpoint and does not replay effects before it", async () => {
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          w: [
            { tool: "EXEC", input: { cmd: "echo effect >> log.txt" } },
            { tool: "CHECKPOINT", input: { note: "effect done" } },
            crashOnce(),
            (ctx) => ({ tool: "EXIT", input: { result: JSON.parse(ctx.lastToolResult!).stdout } }),
          ],
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "w", goal: "g", capabilities: caps } });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();
    expect(job.status).toBe("COMPLETED");
    const p = kernel.pm.get(pids.p0!)!;
    expect(p.retryCount).toBe(1);
    expect(p.result).toBe("effect\n"); // the EXEC before the checkpoint ran exactly once
    expect(kernel.bus.getEvents({ jobId }).some((e) => e.type === "PROCESS_CRASH")).toBe(true);
    expect(syscallEvents(kernel, jobId).filter((s) => s.request.type === "EXEC" && s.request.args.cmd.startsWith("echo"))).toHaveLength(1);
  });

  it("without a checkpoint, restarts clean and re-runs effects (at-least-once)", async () => {
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          w: [
            { tool: "EXEC", input: { cmd: "echo effect >> log.txt" } },
            { tool: "SLEEP", input: { ms: 0 } },
            crashOnce(),
            (ctx) => ({ tool: "EXIT", input: { result: JSON.parse(ctx.lastToolResult!).stdout } }),
          ],
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "w", goal: "g", capabilities: caps } });
    await kernel.waitForJob(jobId);
    await kernel.stop();
    expect(kernel.pm.get(pids.p0!)!.result).toBe("effect\neffect\n");
  });

  it("a retry signal re-queues a permanently failed process", async () => {
    let attempts = 0;
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          flaky: [
            () => {
              if (++attempts <= 1) throw new Error("boom");
              return { text: "ok now" };
            },
          ],
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "flaky", goal: "g", maxRetries: 0 } });
    expect((await kernel.waitForJob(jobId)).status).toBe("FAILED");
    expect(kernel.signal(pids.p0!, "retry")).toMatchObject({ ok: true });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();
    expect(job.status).toBe("COMPLETED");
    expect(kernel.pm.get(pids.p0!)).toMatchObject({ status: "TERMINATED", result: "ok now", retryCount: 1 });
  });
});

describe("approval gate", () => {
  const script = {
    gated: [{ tool: "EXEC", input: { cmd: "echo ran" } }, (ctx: any) => ({ tool: "EXIT", input: { result: ctx.lastToolError ? "denied" : "approved" } })],
  };
  const spec = { process: { role: "gated", goal: "g", capabilities: [{ type: "EXEC", requiresApproval: true }] } };

  for (const decision of ["approve", "deny"] as const) {
    it(`waits in WAITING until the operator signals ${decision}`, async () => {
      const { kernel } = makeKernel({ mock: { scripts: script } });
      kernel.start();
      const { jobId, pids } = kernel.submitJob(spec);
      await sleep(50);
      expect(kernel.pm.get(pids.p0!)!.status).toBe("WAITING");
      expect(kernel.waitingOn(pids.p0!)).toBe("APPROVAL");
      expect(syscallEvents(kernel, jobId)).toHaveLength(0); // nothing executed yet
      expect(kernel.signal(pids.p0!, decision)).toMatchObject({ ok: true });
      await kernel.waitForJob(jobId);
      await kernel.stop();
      const exec = syscallEvents(kernel, jobId)[0]!;
      expect(exec.approval).toBe(decision === "approve" ? "approved" : "denied");
      expect(exec.ok).toBe(decision === "approve");
      expect(kernel.pm.get(pids.p0!)!.result).toBe(decision === "approve" ? "approved" : "denied");
    });
  }
});
