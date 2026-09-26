import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exampleScripts } from "../examples/scripts.ts";
import { makeKernel } from "./helpers.ts";

const job = (name: string) => JSON.parse(readFileSync(new URL(`../examples/${name}/job.json`, import.meta.url), "utf8"));

describe("integration: example workloads with MockLLM + LocalSandbox", () => {
  it("coding-task runs to TERMINATED with a stable event sequence", async () => {
    const { kernel, sandbox } = makeKernel({ mock: { scripts: exampleScripts } });
    kernel.start();
    const { jobId, pids } = kernel.submitJob(job("coding-task"));
    const done = await kernel.waitForJob(jobId);
    await kernel.stop();

    expect(done.status).toBe("COMPLETED");
    expect(kernel.pm.get(pids.coder!)).toMatchObject({ status: "TERMINATED", result: "2 3 5 7 11 13 17 19 23 29 31 37 41 43 47" });
    expect(sandbox.list()).toEqual([]);
    expect(kernel.repos.artifacts.list({ jobId }).map((a) => a.path)).toEqual(["primes.py", "primes.txt"]);

    const events = kernel.bus.getEvents({ jobId });
    for (let i = 1; i < events.length; i++) expect(events[i]!.sequence).toBeGreaterThan(events[i - 1]!.sequence);
    const trace = events.map((e) =>
      e.type === "STATE_CHANGE"
        ? `STATE ${(e.payload as any).from}->${(e.payload as any).to}`
        : e.type === "SYSCALL"
          ? `SYSCALL ${(e.payload as any).request.type}`
          : e.type,
    );
    expect(trace).toEqual([
      "JOB_SUBMITTED",
      "PROCESS_CREATED",
      "STATE NEW->READY",
      "PROCESS_SCHEDULED",
      "STATE READY->RUNNING",
      "LLM_CALL",
      "SYSCALL FS_WRITE",
      "LLM_CALL",
      "SYSCALL EXEC",
      "LLM_CALL",
      "CHECKPOINT",
      "SYSCALL CHECKPOINT",
      "LLM_CALL",
      "SYSCALL FS_READ",
      "LLM_CALL",
      "SYSCALL EXIT",
      "PROCESS_EXIT",
      "STATE RUNNING->TERMINATED",
      "ARTIFACT", // /output/primes.py
      "ARTIFACT", // /output/primes.txt
    ]);
  });

  it("research-pipeline completes: DAG, IPC, SPAWN with attenuation, and a denied escalation", async () => {
    const { kernel } = makeKernel({ mock: { scripts: exampleScripts } });
    kernel.start();
    const { jobId, pids } = kernel.submitJob(job("research-pipeline"));
    const done = await kernel.waitForJob(jobId);
    await kernel.stop();

    expect(done.status).toBe("COMPLETED");
    const procs = kernel.pm.list({ jobId });
    expect(procs.map((p) => p.status)).toEqual(Array(5).fill("TERMINATED"));
    const checker = procs.find((p) => p.role === "fact-checker")!;
    expect(checker.parentPid).toBe(pids.reviewer);
    expect(checker.capabilities).toEqual([{ type: "SEND", scope: pids.reviewer }]);
    const denied = kernel.bus.getEvents({ jobId, limit: 10_000 }).filter((e) => e.type === "SYSCALL" && (e.payload as any).denied);
    expect(denied).toHaveLength(1);
    // Five SENDs plus the CHILD_EXIT the fact-checker's exit sends to the reviewer.
    const mail = kernel.channel.mailbox.list({ jobId });
    expect(mail).toHaveLength(6);
    expect(mail.filter((m) => (m.body as any)?.type === "CHILD_EXIT")).toHaveLength(1);
    expect(mail.filter((m) => (m.body as any)?.type !== "CHILD_EXIT").every((m) => m.delivered)).toBe(true);
  });
});
