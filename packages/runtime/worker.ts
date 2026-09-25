// Worker: the ProcessRunner the kernel dispatches processes to.
import type { Kernel, ProcessRunner, RunHandle } from "@kernelagent/kernel";
import { runExecutionLoop, type ExecutionLoopOptions } from "./execution-loop.ts";

export class Worker implements ProcessRunner {
  constructor(
    private kernel: Kernel,
    private opts: ExecutionLoopOptions = {},
  ) {}

  run(h: RunHandle): Promise<void> {
    return runExecutionLoop(this.kernel, h, this.opts);
  }
}
