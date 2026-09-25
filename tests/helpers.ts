import { createRepositories } from "@kernelagent/db";
import { Kernel, type KernelConfig } from "@kernelagent/kernel";
import { MockLLM, type MockLLMOptions } from "@kernelagent/llm";
import { Worker } from "@kernelagent/runtime";

export function makeKernel(opts: { mock?: MockLLMOptions; config?: Partial<KernelConfig>; now?: () => number } = {}) {
  const llm = new MockLLM(opts.mock);
  const kernel = new Kernel({
    llm,
    repos: createRepositories(":memory:"),
    config: { tickMs: 10, maxConcurrency: 4, ...opts.config },
    ...(opts.now ? { now: opts.now } : {}),
  });
  kernel.attachRunner(new Worker(kernel));
  return { kernel, llm };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
