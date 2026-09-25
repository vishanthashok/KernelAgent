import { describe, expect, it } from "vitest";
import { SyscallRequestSchema, syscallTools } from "@kernelagent/kernel";
import { makeKernel, syscallEvents } from "./helpers.ts";

describe("syscall schemas", () => {
  it("rejects bad args", () => {
    expect(SyscallRequestSchema.safeParse({ type: "FS_WRITE", args: { path: "/a" } }).success).toBe(false);
    expect(SyscallRequestSchema.safeParse({ type: "SLEEP", args: { ms: -1 } }).success).toBe(false);
    expect(SyscallRequestSchema.safeParse({ type: "REBOOT", args: {} }).success).toBe(false);
    expect(SyscallRequestSchema.safeParse({ type: "FS_READ", args: { path: "/a" } }).success).toBe(true);
  });

  it("exposes every syscall as a tool with a JSON schema", () => {
    const tools = syscallTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["CHECKPOINT", "EXEC", "EXIT", "FS_READ", "FS_WRITE", "RECALL", "RECEIVE", "REMEMBER", "SEND", "SLEEP", "SPAWN"],
    );
    for (const t of tools) expect(t.input_schema.type).toBe("object");
  });
});

describe("syscall dispatch", () => {
  it("returns a structured validation error and logs it", async () => {
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          sloppy: [
            { tool: "FS_WRITE", input: { path: "/a.txt" } },
            { tool: "TELEPORT", input: {} },
            (ctx) => ({ tool: "EXIT", input: { result: ctx.lastToolResult ?? "" } }),
          ],
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "sloppy", goal: "x", capabilities: [{ type: "FS_WRITE" }] } });
    await kernel.waitForJob(jobId);
    await kernel.stop();
    const sys = syscallEvents(kernel, jobId);
    expect(sys.slice(0, 2).map((s) => s.code)).toEqual(["VALIDATION", "VALIDATION"]);
    expect(JSON.parse(kernel.pm.get(pids.p0!)!.result!)).toMatchObject({ code: "VALIDATION" });
  });

  it("emits the right events for each syscall", async () => {
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          tour: [
            { tool: "FS_WRITE", input: { path: "/notes/a.txt", content: "hello" } },
            { tool: "FS_READ", input: { path: "notes/a.txt" } },
            { tool: "EXEC", input: { cmd: "cat notes/a.txt; echo err 1>&2; exit 3" } },
            { tool: "CHECKPOINT", input: { note: "wrote a.txt" } },
            { tool: "SLEEP", input: { ms: 20 } },
            (ctx) => ({ tool: "SEND", input: { to: ctx.pid, message: "note to self" } }),
            { tool: "RECEIVE", input: {} },
            { tool: "EXIT", input: { result: "done" } },
          ],
        },
      },
    });
    kernel.start();
    const { jobId } = kernel.submitJob({
      process: {
        role: "tour",
        goal: "use every syscall",
        capabilities: [{ type: "FS_READ" }, { type: "FS_WRITE", scope: "/notes" }, { type: "EXEC" }, { type: "SEND" }, { type: "RECEIVE" }],
      },
    });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();
    expect(job.status).toBe("COMPLETED");

    const sys = syscallEvents(kernel, jobId);
    expect(sys.map((s) => [s.request.type, s.ok, s.retrySafety])).toEqual([
      ["FS_WRITE", true, "EFFECTFUL"],
      ["FS_READ", true, "SAFE"],
      ["EXEC", true, "UNSAFE_REPLAY"],
      ["CHECKPOINT", true, "SAFE"],
      ["SLEEP", true, "SAFE"],
      ["SEND", true, "EFFECTFUL"],
      ["RECEIVE", true, "EFFECTFUL"],
      ["EXIT", true, "TERMINAL"],
    ]);
    expect(sys[1]!.result).toBe("hello");
    expect(sys[2]!.result).toEqual({ stdout: "hello", stderr: "err\n", exitCode: 3 });
    expect(sys[6]!.result).toMatchObject({ message: "note to self" });
    for (const s of sys) expect(typeof s.durationMs).toBe("number");

    const types = kernel.bus.getEvents({ jobId }).map((e) => e.type);
    expect(types).toContain("CHECKPOINT");
    expect(types).toContain("BLOCKED"); // SLEEP
    expect(types).toContain("MESSAGE");
  });

  it("keeps file access inside the sandbox", async () => {
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          escape: [
            { tool: "FS_READ", input: { path: "/../../../../etc/hostname" } },
            (ctx) => ({ tool: "EXIT", input: { result: String(ctx.lastToolError) } }),
          ],
        },
      },
    });
    kernel.start();
    const { jobId } = kernel.submitJob({ process: { role: "escape", goal: "x", capabilities: [{ type: "FS_READ" }] } });
    await kernel.waitForJob(jobId);
    await kernel.stop();
    const read = syscallEvents(kernel, jobId)[0]!;
    expect(read.request.args.path).toBe("/../../../../etc/hostname");
    expect(read.ok).toBe(false);
    expect(read.code).toBe("EXEC_ERROR"); // resolved to <sandbox>/etc/hostname, which does not exist
  });
});
