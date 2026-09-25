// Live provider checks. Skipped unless the matching key is set, so the suite stays hermetic.
import { describe, expect, it } from "vitest";
import { createRepositories } from "@kernelagent/db";
import { Kernel } from "@kernelagent/kernel";
import { Worker } from "@kernelagent/runtime";
import { LocalSandbox } from "@kernelagent/sandbox";

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("AnthropicClient (live)", () => {
  it("completes a coding task through syscalls", async () => {
    const { AnthropicClient } = await import("@kernelagent/llm/anthropic");
    const kernel = new Kernel({
      llm: new AnthropicClient({ model: process.env.ANTHROPIC_MODEL }),
      sandbox: new LocalSandbox(),
      repos: createRepositories(":memory:"),
    });
    kernel.attachRunner(new Worker(kernel));
    kernel.start();
    const { jobId, pids } = kernel.submitJob({
      process: {
        role: "coder",
        goal: "Write /hello.sh that prints 'hello kernel', run it with sh, and EXIT with its exact output.",
        capabilities: [{ type: "FS_READ" }, { type: "FS_WRITE" }, { type: "EXEC" }],
        tokenBudget: 60_000,
      },
    });
    const job = await kernel.waitForJob(jobId, 180_000);
    await kernel.stop();
    expect(job.status).toBe("COMPLETED");
    expect(kernel.pm.get(pids.p0!)!.result).toContain("hello kernel");
  }, 200_000);
});

describe.skipIf(!process.env.E2B_API_KEY)("E2BSandbox (live)", () => {
  it("writes, executes, and reads", async () => {
    const { E2BSandbox } = await import("@kernelagent/sandbox/e2b");
    const sbx = new E2BSandbox({ apiKey: process.env.E2B_API_KEY! });
    const { sandboxId } = await sbx.create("1");
    try {
      await sbx.writeFile(sandboxId, "a.sh", "echo hi");
      expect(await sbx.exec(sandboxId, "sh a.sh")).toMatchObject({ stdout: "hi\n", exitCode: 0 });
      expect(await sbx.readFile(sandboxId, "a.sh")).toBe("echo hi");
    } finally {
      await sbx.destroy(sandboxId);
    }
  }, 120_000);
});
