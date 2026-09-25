// Execution loop: one process, from RUNNING to EXIT.
//
//   build context -> call model (LLM_CALL) -> for each tool_use: syscall (SYSCALL)
//   -> append tool_results -> loop, until EXIT or a final text answer.
//
// Turn and syscall boundaries are the yield points where the scheduler regains control.
import type { ContentBlock, ToolResultBlock, ToolUseBlock } from "@kernelagent/llm";
import { syscallTools, type Kernel, type RunHandle, type SyscallType } from "@kernelagent/kernel";
import { ProcessContext, type ContextSnapshot, type MemoryView } from "./context.ts";

export interface ExecutionLoopOptions {
  maxTurns?: number;
}

// Syscalls every process may call. The rest are exposed only if a capability allows them.
const ALWAYS: ReadonlySet<SyscallType> = new Set(["SLEEP", "CHECKPOINT", "EXIT"]);
// Syscalls whose capability has a different name.
const NEEDS: Partial<Record<SyscallType, string>> = { REMEMBER: "MEMORY", RECALL: "MEMORY" };

export async function runExecutionLoop(kernel: Kernel, h: RunHandle, opts: ExecutionLoopOptions = {}): Promise<void> {
  const maxTurns = opts.maxTurns ?? 40;
  const proc = kernel.pm.require(h.pid);
  const held = new Set<string>(proc.capabilities.map((c) => c.type));
  // Memory tools only make sense when the job has a memory to use.
  const hasMemory = kernel.memoryScope(proc.jobId) !== undefined;
  if (!hasMemory) held.delete("MEMORY");
  // The tool list is fixed per process: a changing list would break the prompt cache.
  const tools = syscallTools((t) => ALWAYS.has(t) || held.has(NEEDS[t] ?? t));

  // Peers and memory are fixed at start so the system prompt stays byte-stable across turns.
  const peers = kernel.pm.list({ jobId: proc.jobId }).filter((p) => p.pid !== proc.pid);
  const memory: MemoryView | undefined = hasMemory
    ? { entries: kernel.memoryContext(proc.jobId), canWrite: held.has("MEMORY") }
    : undefined;
  const ctx =
    h.resume && h.resume.context
      ? ProcessContext.restore(proc, h.resume.context as ContextSnapshot, h.resume.checkpointSeq, peers, memory)
      : ProcessContext.fresh(proc, peers, memory);

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
        content: capToolResult(
          r.ok ? (typeof r.value === "string" ? r.value : JSON.stringify(r.value)) : JSON.stringify({ error: r.error, code: r.code }),
        ),
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

/** Longest tool result the model sees. The SYSCALL event keeps the full value. */
export const MAX_TOOL_RESULT_CHARS = 16_000;

/**
 * Trim a tool result to MAX_TOOL_RESULT_CHARS, keeping the head and tail. Every later turn
 * resends it, so one large command output would otherwise be paid for on every call.
 */
export function capToolResult(s: string, max = MAX_TOOL_RESULT_CHARS): string {
  if (s.length <= max) return s;
  const keep = max - 80;
  const head = s.slice(0, Math.ceil(keep * 0.75));
  const tail = s.slice(s.length - Math.floor(keep * 0.25));
  return `${head}\n[... truncated ${s.length - head.length - tail.length} chars ...]\n${tail}`;
}

function textOf(content: ContentBlock[]): string {
  return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}
