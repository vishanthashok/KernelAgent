// Execution loop: one process, from RUNNING to EXIT.
//
//   build context -> call model (LLM_CALL) -> for each tool_use: syscall (SYSCALL)
//   -> append tool_results -> loop, until EXIT or a final text answer.
//
// Turn and syscall boundaries are the yield points where the scheduler regains control.
import type { ContentBlock, ToolResultBlock, ToolUseBlock } from "@kernelagent/llm";
import { syscallTools, type Kernel, type RunHandle, type SyscallType } from "@kernelagent/kernel";
import { ProcessContext, type ContextSnapshot } from "./context.ts";

export interface ExecutionLoopOptions {
  maxTurns?: number;
}

// Syscalls every process may call. The rest are exposed only if a capability allows them.
const ALWAYS: ReadonlySet<SyscallType> = new Set(["SLEEP", "CHECKPOINT", "EXIT"]);

export async function runExecutionLoop(kernel: Kernel, h: RunHandle, opts: ExecutionLoopOptions = {}): Promise<void> {
  const maxTurns = opts.maxTurns ?? 40;
  const proc = kernel.pm.require(h.pid);
  const held = new Set(proc.capabilities.map((c) => c.type));
  const tools = syscallTools((t) => ALWAYS.has(t) || held.has(t as never));

  const ctx =
    h.resume && h.resume.context
      ? ProcessContext.restore(proc, h.resume.context as ContextSnapshot, h.resume.checkpointSeq)
      : ProcessContext.fresh(proc);

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await kernel.callModel(h, { system: ctx.system, messages: ctx.messages, tools });
    ctx.messages.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (uses.length === 0) {
      // A final text answer with no tool call is treated as EXIT with that text.
      await kernel.syscall(h, { type: "EXIT", args: { result: textOf(res.content) } });
      return;
    }

    const results: ToolResultBlock[] = [];
    for (const u of uses) {
      const r = await kernel.syscall(
        h,
        { type: u.name, args: u.input ?? {} },
        { snapshot: () => ctx.snapshot(u.id, results) },
      );
      if (r.ok && u.name === "EXIT") return;
      if (!r.ok && r.code === "ABORTED") return;
      results.push({
        type: "tool_result",
        tool_use_id: u.id,
        content: r.ok ? (typeof r.value === "string" ? r.value : JSON.stringify(r.value)) : JSON.stringify({ error: r.error, code: r.code }),
        ...(r.ok ? {} : { is_error: true }),
      });
    }
    ctx.messages.push({ role: "user", content: results });

    // Turn boundary: cooperatively yield if others are waiting for a slot.
    if (kernel.scheduler.readyQueue().length > 0 && kernel.scheduler.running() >= kernel.config.maxConcurrency) {
      await kernel.yield(h);
    }
  }
  throw new Error(`MAX_TURNS: no EXIT after ${maxTurns} turns`);
}

function textOf(content: ContentBlock[]): string {
  return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}
