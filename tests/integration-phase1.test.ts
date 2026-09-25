import { describe, expect, it } from "vitest";
import { makeKernel } from "./helpers.ts";

describe("phase 1 integration", () => {
  it("drives a job to completion and records every state change and LLM call", async () => {
    const { kernel } = makeKernel();
    kernel.start();
    const { jobId, pids } = kernel.submitJob({ process: { role: "planner", goal: "say hello" } });
    const job = await kernel.waitForJob(jobId);
    await kernel.stop();

    expect(job.status).toBe("COMPLETED");
    const events = kernel.bus.getEvents({ jobId });
    expect(events.map((e) => e.type)).toEqual([
      "JOB_SUBMITTED",
      "PROCESS_CREATED",
      "STATE_CHANGE", // NEW -> READY
      "PROCESS_SCHEDULED",
      "STATE_CHANGE", // READY -> RUNNING
      "LLM_CALL",
      "PROCESS_EXIT",
      "STATE_CHANGE", // RUNNING -> TERMINATED
    ]);
    const llm = events.find((e) => e.type === "LLM_CALL")!.payload as Record<string, unknown>;
    expect(llm).toHaveProperty("request.system");
    expect(llm).toHaveProperty("response.raw");
    expect(kernel.pm.get(pids.p0!)?.tokensUsed).toBeGreaterThan(0);
  });
});
