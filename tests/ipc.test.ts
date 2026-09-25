import { describe, expect, it } from "vitest";
import { makeKernel, syscallEvents } from "./helpers.ts";

describe("IPC", () => {
  it("RECEIVE on an empty mailbox blocks, and a SEND wakes it", async () => {
    const pids: Record<string, string> = {};
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          receiver: [{ tool: "RECEIVE", input: {} }, (ctx) => ({ tool: "EXIT", input: { result: ctx.lastToolResult! } })],
          sender: [
            { tool: "SLEEP", input: { ms: 40 } },
            () => ({ tool: "SEND", input: { to: pids.rx!, message: "ping" } }),
            { tool: "EXIT", input: { result: "sent" } },
          ],
        },
      },
    });
    kernel.start();
    const res = kernel.submitJob({
      processes: [
        { id: "rx", role: "receiver", goal: "wait", capabilities: [{ type: "RECEIVE" }] },
        { id: "tx", role: "sender", goal: "send", capabilities: [{ type: "SEND" }] },
      ],
    });
    Object.assign(pids, res.pids);
    const job = await kernel.waitForJob(res.jobId);
    await kernel.stop();
    expect(job.status).toBe("COMPLETED");

    const rx = kernel.bus.getEvents({ jobId: res.jobId, pid: pids.rx });
    const flow = rx
      .filter((e) => e.type === "STATE_CHANGE" || e.type === "BLOCKED")
      .map((e) => (e.type === "BLOCKED" ? "BLOCKED" : `${(e.payload as any).from}->${(e.payload as any).to}`));
    expect(flow).toEqual([
      "NEW->READY",
      "READY->RUNNING",
      "RUNNING->WAITING",
      "BLOCKED",
      "WAITING->READY",
      "READY->RUNNING",
      "RUNNING->TERMINATED",
    ]);
    expect(JSON.parse(kernel.pm.get(pids.rx!)!.result!)).toMatchObject({ from: pids.tx, message: "ping" });
  });

  it("round-trips a request and reply", async () => {
    const pids: Record<string, string> = {};
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          client: [
            () => ({ tool: "SEND", input: { to: pids.server!, message: "2+2?" } }),
            { tool: "RECEIVE", input: {} },
            (ctx) => ({ tool: "EXIT", input: { result: JSON.parse(ctx.lastToolResult!).message } }),
          ],
          server: [
            { tool: "RECEIVE", input: {} },
            (ctx) => ({ tool: "SEND", input: { to: JSON.parse(ctx.lastToolResult!).from, message: "4" } }),
            { tool: "EXIT", input: { result: "served" } },
          ],
        },
      },
    });
    kernel.start();
    const res = kernel.submitJob({
      processes: [
        { id: "server", role: "server", goal: "answer", capabilities: [{ type: "SEND" }, { type: "RECEIVE" }] },
        { id: "client", role: "client", goal: "ask", capabilities: [{ type: "SEND" }, { type: "RECEIVE" }] },
      ],
    });
    Object.assign(pids, res.pids);
    await kernel.waitForJob(res.jobId);
    await kernel.stop();
    expect(kernel.pm.get(pids.client!)!.result).toBe("4");
    expect(kernel.channel.mailbox.list({ jobId: res.jobId }).map((m) => [m.fromPid, m.toPid, m.delivered])).toEqual([
      [pids.client, pids.server, true],
      [pids.server, pids.client, true],
    ]);
  });

  it("SEND to a pid outside the job fails", async () => {
    const { kernel } = makeKernel({
      mock: { scripts: { lost: [{ tool: "SEND", input: { to: "99999", message: "hi" } }, { text: "done" }] } },
    });
    kernel.start();
    const { jobId } = kernel.submitJob({ process: { role: "lost", goal: "x", capabilities: [{ type: "SEND" }] } });
    await kernel.waitForJob(jobId);
    await kernel.stop();
    expect(syscallEvents(kernel, jobId)[0]).toMatchObject({ ok: false, code: "EXEC_ERROR" });
  });
});
