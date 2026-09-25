import { describe, expect, it } from "vitest";
import { makeKernel, syscallEvents } from "./helpers.ts";

describe("coding task", () => {
  it("writes a program, runs it in the sandbox, and reads its output", async () => {
    const { kernel, sandbox } = makeKernel({
      mock: {
        scripts: {
          coder: [
            { tool: "FS_WRITE", input: { path: "/fib.sh", content: "a=0; b=1; for i in 1 2 3 4 5 6 7 8 9 10; do t=$b; b=$((a+b)); a=$t; done; echo $a\n" } },
            { tool: "EXEC", input: { cmd: "sh fib.sh > out.txt" } },
            { tool: "CHECKPOINT", input: { note: "program ran" } },
            { tool: "FS_READ", input: { path: "/out.txt" } },
            (ctx) => ({ tool: "EXIT", input: { result: `fib(10) = ${ctx.lastToolResult!.trim()}` } }),
          ],
        },
      },
    });
    kernel.start();
    const { jobId, pids } = kernel.submitJob({
      process: {
        role: "coder",
        goal: "Compute the 10th Fibonacci number with a shell script",
        capabilities: [{ type: "FS_READ" }, { type: "FS_WRITE" }, { type: "EXEC" }],
      },
    });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();

    expect(job.status).toBe("COMPLETED");
    const p = kernel.pm.get(pids.p0!)!;
    expect(p.result).toBe("fib(10) = 55");
    expect(p.sandboxId).toMatch(/^sbx_/);
    expect(p.lastCheckpointSeq).toBeGreaterThan(0);
    expect(syscallEvents(kernel, jobId).every((s) => s.ok)).toBe(true);
    expect(sandbox.list()).toEqual([]); // destroyed on exit
  });
});
