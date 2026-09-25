import { describe, expect, it } from "vitest";
import { CapabilityEscalationError, CapabilityManager, type Capability } from "@kernelagent/kernel";
import { makeKernel, syscallEvents } from "./helpers.ts";

const cm = new CapabilityManager();

describe("capability check", () => {
  it("allows only capabilities the process holds, respecting scope", () => {
    const p = { capabilities: [{ type: "FS_READ", scope: "/data" }, { type: "EXEC" }] as Capability[] };
    expect(cm.check(p, { type: "EXEC" })).toBe(true);
    expect(cm.check(p, { type: "FS_READ", resource: "/data/a.txt" })).toBe(true);
    expect(cm.check(p, { type: "FS_READ", resource: "/data" })).toBe(true);
    expect(cm.check(p, { type: "FS_READ", resource: "/database" })).toBe(false);
    expect(cm.check(p, { type: "FS_READ", resource: "/etc/passwd" })).toBe(false);
    expect(cm.check(p, { type: "FS_WRITE", resource: "/data/a.txt" })).toBe(false);
    expect(cm.check(p, { type: "SPAWN" })).toBe(false);
  });

  it("matches NET host allowlists and SEND pid scopes", () => {
    const p = { capabilities: [{ type: "NET", scope: "api.example.com, *.docs.io" }, { type: "SEND", scope: "101,102" }] as Capability[] };
    expect(cm.check(p, { type: "NET", resource: "api.example.com" })).toBe(true);
    expect(cm.check(p, { type: "NET", resource: "a.docs.io" })).toBe(true);
    expect(cm.check(p, { type: "NET", resource: "evil.com" })).toBe(false);
    expect(cm.check(p, { type: "SEND", resource: "102" })).toBe(true);
    expect(cm.check(p, { type: "SEND", resource: "103" })).toBe(false);
  });
});

describe("attenuation on SPAWN", () => {
  const parent: Capability[] = [
    { type: "FS_READ" },
    { type: "FS_WRITE", scope: "/work" },
    { type: "SEND", scope: "101,102" },
    { type: "EXEC", requiresApproval: true },
  ];

  it("grants subsets, including narrower scopes", () => {
    expect(cm.attenuate(parent, [{ type: "FS_READ", scope: "/work/src" }, { type: "FS_WRITE", scope: "/work/out" }, { type: "SEND", scope: "101" }])).toEqual([
      { type: "FS_READ", scope: "/work/src" },
      { type: "FS_WRITE", scope: "/work/out" },
      { type: "SEND", scope: "101" },
    ]);
  });

  it("grants nothing when nothing is requested", () => {
    expect(cm.attenuate(parent, [])).toEqual([]);
  });

  it("rejects a capability type the parent lacks", () => {
    expect(() => cm.attenuate(parent, [{ type: "SPAWN" }])).toThrow(CapabilityEscalationError);
    expect(() => cm.attenuate(parent, [{ type: "NET" }])).toThrow(/not held/);
  });

  it("rejects a wider scope than the parent's", () => {
    expect(() => cm.attenuate(parent, [{ type: "FS_WRITE" }])).toThrow(/wider/);
    expect(() => cm.attenuate(parent, [{ type: "FS_WRITE", scope: "/" }])).toThrow(CapabilityEscalationError);
    expect(() => cm.attenuate(parent, [{ type: "FS_WRITE", scope: "/work/../etc" }])).toThrow(CapabilityEscalationError);
    expect(() => cm.attenuate(parent, [{ type: "SEND", scope: "101,103" }])).toThrow(CapabilityEscalationError);
  });

  it("keeps the parent's approval gate", () => {
    expect(cm.attenuate(parent, [{ type: "EXEC" }])).toEqual([{ type: "EXEC", requiresApproval: true }]);
  });
});

describe("capabilities enforced by the kernel", () => {
  it("denies a syscall without the capability, logs it as denied, and does not execute it", async () => {
    const { kernel, sandbox } = makeKernel({
      mock: {
        scripts: {
          sneaky: [
            { tool: "FS_WRITE", input: { path: "/pwned.txt", content: "x" } },
            { tool: "EXEC", input: { cmd: "echo hi" } },
            (ctx) => ({ tool: "EXIT", input: { result: `denied=${ctx.lastToolError}` } }),
          ],
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "sneaky", goal: "escalate", capabilities: [{ type: "FS_READ" }] } });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();

    expect(job.status).toBe("COMPLETED");
    const sys = syscallEvents(kernel, jobId);
    expect(sys.map((s) => [s.request.type, s.denied === true])).toEqual([
      ["FS_WRITE", true],
      ["EXEC", true],
      ["EXIT", false],
    ]);
    expect(sys[0]!.code).toBe("DENIED");
    expect(kernel.pm.get(pids.p0!)?.result).toBe("denied=true");
    expect(sandbox.list()).toEqual([]); // sandbox destroyed, and nothing was written
  });

  it("SPAWN attenuates capabilities and rejects privilege escalation", async () => {
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          parent: [
            { tool: "SPAWN", input: { role: "child", goal: "escalate", capabilities: [{ type: "EXEC" }] } },
            { tool: "SPAWN", input: { role: "child", goal: "read", capabilities: [{ type: "FS_READ", scope: "/src" }] } },
            { text: "spawned" },
          ],
          child: [{ text: "child done" }],
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({
      process: { role: "parent", goal: "delegate", capabilities: [{ type: "SPAWN" }, { type: "FS_READ" }] },
    });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();

    expect(job.status).toBe("COMPLETED");
    const sys = syscallEvents(kernel, jobId).filter((s) => s.request.type === "SPAWN");
    expect(sys[0]).toMatchObject({ ok: false, denied: true, code: "DENIED" });
    expect(sys[0]!.error).toMatch(/escalation/);
    expect(sys[1]).toMatchObject({ ok: true });

    const children = kernel.pm.list({ jobId }).filter((p) => p.parentPid === pids.p0);
    expect(children).toHaveLength(1);
    expect(children[0]!.capabilities).toEqual([{ type: "FS_READ", scope: "/src" }]);
    expect(children[0]!.status).toBe("TERMINATED");
  });
});
