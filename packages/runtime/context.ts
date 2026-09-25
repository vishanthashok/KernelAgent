// Process context: system prompt + message history. This is what a checkpoint snapshots.
import type { Message, ToolResultBlock } from "@kernelagent/llm";
import type { Capability, Process } from "@kernelagent/kernel";

export interface ContextSnapshot {
  version: 1;
  /** History up to and including the assistant turn that called CHECKPOINT. */
  messages: Message[];
  /** Results of tool calls in that turn that completed before CHECKPOINT. */
  partialResults: ToolResultBlock[];
  /** The tool_use id of the CHECKPOINT call itself. */
  checkpointToolUseId: string;
  checkpointSeq?: number;
}

function describeCap(c: Capability): string {
  return `${c.type}${c.scope ? `(${c.scope})` : ""}${c.requiresApproval ? " [needs operator approval]" : ""}`;
}

export function systemPrompt(p: Process): string {
  const caps = p.capabilities.length ? p.capabilities.map(describeCap).join(", ") : "none";
  return [
    `You are process ${p.pid}, a "${p.role}" agent running inside KernelAgent, an operating-system-style kernel for AI agents.`,
    `Your only way to affect the world is the syscall tools you are given. Each call is checked against your capabilities.`,
    `Capabilities: ${caps}.`,
    `Token budget: ${p.tokenBudget} tokens in total.`,
    ``,
    `Rules:`,
    `- Work step by step with syscalls. File paths are inside your own sandbox.`,
    `- A denied syscall means you lack the capability. Do not retry it; find another way or report it.`,
    `- After an effectful step you would not want to repeat (a write, a command, a message), call CHECKPOINT.`,
    `  If you crash and are retried, you resume from your latest checkpoint. Work after it may run again.`,
    `- When the goal is done, call EXIT with a concise result.`,
  ].join("\n");
}

export class ProcessContext {
  constructor(
    readonly system: string,
    readonly messages: Message[],
  ) {}

  static fresh(p: Process): ProcessContext {
    return new ProcessContext(systemPrompt(p), [{ role: "user", content: `Your goal: ${p.goal}` }]);
  }

  /** Rebuild a context from a checkpoint snapshot, closing out the interrupted turn. */
  static restore(p: Process, snap: ContextSnapshot, checkpointSeq: number): ProcessContext {
    const messages = structuredClone(snap.messages);
    const last = messages[messages.length - 1];
    const results: ToolResultBlock[] = [...snap.partialResults];
    if (last && last.role === "assistant" && typeof last.content !== "string") {
      const done = new Set(results.map((r) => r.tool_use_id));
      for (const b of last.content) {
        if (b.type !== "tool_use" || done.has(b.id)) continue;
        results.push(
          b.id === snap.checkpointToolUseId
            ? { type: "tool_result", tool_use_id: b.id, content: JSON.stringify({ checkpointSeq, resumed: true }) }
            : {
                type: "tool_result",
                tool_use_id: b.id,
                content: JSON.stringify({ error: "not executed: the process failed after its checkpoint and was resumed" }),
                is_error: true,
              },
        );
      }
    }
    if (results.length) messages.push({ role: "user", content: results });
    return new ProcessContext(systemPrompt(p), messages);
  }

  snapshot(checkpointToolUseId: string, partialResults: ToolResultBlock[]): ContextSnapshot {
    return {
      version: 1,
      messages: structuredClone(this.messages),
      partialResults: structuredClone(partialResults),
      checkpointToolUseId,
    };
  }
}
