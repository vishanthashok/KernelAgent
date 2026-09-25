import { describe, expect, it } from "vitest";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { makeKernel } from "./helpers.ts";

describe("telemetry", () => {
  it("nests LLM and syscall spans under the process run, and the run under its job", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    provider.register();

    const { kernel } = makeKernel({
      mock: { scripts: { w: [{ tool: "SLEEP", input: { ms: 5 } }, { tool: "EXIT", input: { result: "ok" } }] } },
    });
    kernel.start();
    const { jobId } = kernel.submitJob({ process: { role: "w", goal: "g" } });
    await kernel.waitForJob(jobId);
    await kernel.stop();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const byName = (n: string) => spans.filter((s) => s.name === n);
    const job = byName("job")[0]!;
    const run = byName("process.run")[0]!;
    const parentOf = (s: (typeof spans)[number]) => s.parentSpanContext?.spanId;
    expect(parentOf(run)).toBe(job.spanContext().spanId);
    expect(byName("llm.call").length).toBe(2);
    for (const s of [...byName("llm.call"), ...byName("syscall.SLEEP"), ...byName("syscall.EXIT")]) {
      expect(parentOf(s)).toBe(run.spanContext().spanId);
      expect(s.spanContext().traceId).toBe(job.spanContext().traceId);
    }
    expect(byName("scheduler.dispatch").length).toBeGreaterThanOrEqual(2);
    await provider.shutdown();
  });
});
