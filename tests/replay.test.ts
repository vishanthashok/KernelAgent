import { describe, expect, it } from "vitest";
import { replayProcesses } from "@kernelagent/kernel";
import { makeKernel } from "./helpers.ts";

describe("replay", () => {
  it("reconstructs every process from the event log, matching live state", async () => {
    const pids: Record<string, string> = {};
    let crashed = false;
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          planner: [
            { tool: "SPAWN", input: { role: "helper", goal: "help", capabilities: [{ type: "FS_WRITE", scope: "/h" }] } },
            () => ({ tool: "SEND", input: { to: pids.coder!, message: "go" } }),
            { tool: "EXIT", input: { result: "planned" } },
          ],
          helper: [{ tool: "FS_WRITE", input: { path: "/h/x", content: "1" } }, { text: "helped" }],
          coder: [
            { tool: "RECEIVE", input: {} },
            { tool: "FS_WRITE", input: { path: "/a.txt", content: "a" } },
            { tool: "CHECKPOINT", input: {} },
            () => {
              if (!crashed) {
                crashed = true;
                throw new Error("transient crash");
              }
              return { tool: "EXIT", input: { result: "coded" } };
            },
          ],
          denied: [{ tool: "EXEC", input: { cmd: "id" } }, { text: "gave up" }],
        },
      },
    });
    kernel.start();
    const res = kernel.submitJob({
      processes: [
        { id: "planner", role: "planner", goal: "plan", priority: 5, capabilities: [{ type: "SPAWN" }, { type: "SEND" }, { type: "FS_WRITE" }] },
        { id: "coder", role: "coder", goal: "code", capabilities: [{ type: "RECEIVE" }, { type: "FS_WRITE" }] },
        { id: "denied", role: "denied", goal: "try", dependsOn: ["planner"] },
      ],
    });
    Object.assign(pids, res.pids);
    const job = await kernel.waitForJob(res.jobId);
    await kernel.stop();
    expect(job.status).toBe("COMPLETED");

    const replayed = replayProcesses(kernel.bus.getEvents({ jobId: res.jobId, limit: 100_000 }));
    const live = kernel.pm.list({ jobId: res.jobId });
    expect(replayed.size).toBe(live.length);
    expect(live.length).toBe(4); // including the spawned helper
    for (const l of live) {
      const r = replayed.get(l.pid)!;
      const pick = (p: Record<string, unknown>) => ({
        status: p.status, role: p.role, goal: p.goal, parentPid: p.parentPid, priority: p.priority,
        tokenBudget: p.tokenBudget, tokensUsed: p.tokensUsed, capabilities: p.capabilities, dependsOn: p.dependsOn,
        retryCount: p.retryCount, maxRetries: p.maxRetries, sandboxId: p.sandboxId, lastCheckpointSeq: p.lastCheckpointSeq,
        result: p.result, error: p.error, createdAt: p.createdAt, startedAt: p.startedAt, completedAt: p.completedAt,
        runtimeMs: p.runtimeMs,
      });
      expect(pick(r as never)).toEqual(pick(l as never));
      expect(r.costUsd).toBeCloseTo(l.costUsd, 12);
    }
    expect(kernel.pm.get(pids.coder!)!.retryCount).toBe(1);
  });

  it("rewinds to an earlier sequence", async () => {
    const { kernel } = makeKernel();
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "x", goal: "y" } });
    await kernel.waitForJob(jobId);
    await kernel.stop();
    const events = kernel.bus.getEvents({ jobId });
    const running = events.find((e) => e.type === "STATE_CHANGE" && (e.payload as { to: string }).to === "RUNNING")!;
    expect(replayProcesses(events, running.sequence).get(pids.p0!)!.status).toBe("RUNNING");
    expect(replayProcesses(events, running.sequence - 1).get(pids.p0!)!.status).toBe("READY");
  });
});
