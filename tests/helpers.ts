import { createRepositories } from "@kernelagent/db";
import { Kernel, type KernelConfig } from "@kernelagent/kernel";
import { MockLLM, type MockLLMOptions } from "@kernelagent/llm";
import { Worker } from "@kernelagent/runtime";
import { LocalSandbox } from "@kernelagent/sandbox";

export function makeKernel(opts: { mock?: MockLLMOptions; config?: Partial<KernelConfig>; now?: () => number } = {}) {
  const llm = new MockLLM(opts.mock);
  const sandbox = new LocalSandbox();
  const kernel = new Kernel({
    llm,
    sandbox,
    repos: createRepositories(":memory:"),
    config: { tickMs: 10, maxConcurrency: 4, ...opts.config },
    ...(opts.now ? { now: opts.now } : {}),
  });
  kernel.attachRunner(new Worker(kernel));
  return { kernel, llm, sandbox };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Payloads of SYSCALL events for a job, in order. */
export function syscallEvents(kernel: Kernel, jobId: string) {
  return kernel.bus
    .getEvents({ jobId, limit: 100_000 })
    .filter((e) => e.type === "SYSCALL")
    .map((e) => ({ pid: e.pid, ...(e.payload as Record<string, any>) }) as Record<string, any>);
}
