// Worker: the ProcessRunner the kernel dispatches processes to.
import type { Kernel, ProcessRunner, RunHandle } from "@kernelagent/kernel";

export class Worker implements ProcessRunner {
  constructor(private kernel: Kernel) {}

  async run(h: RunHandle): Promise<void> {
    const proc = this.kernel.pm.require(h.pid);
    const system = `You are a ${proc.role} process running inside KernelAgent. Complete your goal and reply with the result.`;
    const res = await this.kernel.callModel(h, {
      system,
      messages: [{ role: "user", content: proc.goal }],
      tools: [],
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    this.kernel.exit(h, text);
  }
}
