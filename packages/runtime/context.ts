// Process context: system prompt + message history. This is what a checkpoint snapshots.
import type { Message, ToolResultBlock, ToolUseBlock } from "@kernelagent/llm";
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

/** Peer goals are for addressing, not doing. Long ones would repeat in every peer's prompt. */
const PEER_GOAL_CHARS = 200;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function describeCap(c: Capability): string {
  return `${c.type}${c.scope ? `(${c.scope})` : ""}${c.requiresApproval ? " [needs operator approval]" : ""}`;
}

/** Chat memory shown to a process: shared notes and earlier requests with their answers. */
export interface MemoryView {
  entries: { kind: string; content: string }[];
  /** The process holds MEMORY and can call REMEMBER and RECALL. */
  canWrite: boolean;
}

function memorySection(m: MemoryView | undefined): string[] {
  if (!m || (!m.canWrite && m.entries.length === 0)) return [];
  const lines = m.entries.map((e) => `- [${e.kind}] ${e.content.replace(/\n/g, "\n  ")}`);
  return [
    ``,
    `Chat memory, shared by every agent in this chat and kept across messages (oldest first):`,
    ...(lines.length ? lines : [`- (empty)`]),
    ...(m.canWrite
      ? [
          `Use REMEMBER to save facts, decisions, and results that later messages or other agents need. Keep notes short.`,
          `Use RECALL to search older memory that is not shown here.`,
        ]
      : []),
  ];
}

export function systemPrompt(p: Process, peers: Pick<Process, "pid" | "role" | "goal">[] = [], memory?: MemoryView): string {
  const caps = p.capabilities.length ? p.capabilities.map(describeCap).join(", ") : "none";
  const peerLines = peers.map((q) => `  - pid ${q.pid} (${q.role}): ${clip(q.goal, PEER_GOAL_CHARS)}`);
  return [
    `You are process ${p.pid}, a "${p.role}" agent running inside KernelAgent, an operating-system-style kernel for AI agents.`,
    `Your only way to affect the world is the syscall tools you are given. Each call is checked against your capabilities.`,
    `Capabilities: ${caps}.`,
    `Token budget: ${p.tokenBudget} tokens in total.`,
    ...(p.parentPid ? [`Your parent process is pid ${p.parentPid}.`] : []),
    ...(peerLines.length ? [`Other processes in your job (address them by pid with SEND):`, ...peerLines] : []),
    ``,
    `Rules:`,
    `- Work step by step with syscalls. File paths are inside your own sandbox.`,
    `- A denied syscall means you lack the capability. Do not retry it; find another way or report it.`,
    `- After an effectful step you would not want to repeat (a write, a command, a message), call CHECKPOINT.`,
    `  If you crash and are retried, you resume from your latest checkpoint. Work after it may run again.`,
    `- Your EXIT result is shown to the user as your answer. Make it complete and readable.`,
    `- To hand files to the user (a report, PDF, image, CSV), save them under /output/ in your sandbox.`,
    `  Everything in /output/ is kept and offered for download after you exit. Other files are deleted.`,
    `- When the goal is done, call EXIT with your answer.`,
    `- Keep tool output small: use head, tail, grep, or wc instead of printing whole files. Every turn resends it.`,
    `- A CHILD_EXIT message means that child is done: use its result or lastOutput. Never wait for a child that has exited.`,
    `- If RECEIVE returns closed, nobody can message you any more. Finish and EXIT with what you have.`,
    ...memorySection(memory),
  ].join("\n");
}

// Limits for the digest a rollover leaves in place of the history.
const DIGEST_ARGS_CHARS = 150;
const DIGEST_RESULT_CHARS = 300;
const DIGEST_TEXT_CHARS = 1500;
const DIGEST_MAX_STEPS = 40;

/** One line per tool call (name, args, result), plus the latest assistant text. */
export function digestHistory(messages: Message[]): { steps: string[]; lastText: string } {
  const results = new Map<string, ToolResultBlock>();
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, b);
  }
  const steps: string[] = [];
  let lastText = "";
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (typeof m.content === "string") {
      if (m.content.trim()) lastText = m.content.trim();
      continue;
    }
    const text = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (text) lastText = text;
    for (const b of m.content) {
      if (b.type !== "tool_use") continue;
      const u = b as ToolUseBlock;
      const r = results.get(u.id);
      const out = r ? oneLine(typeof r.content === "string" ? r.content : JSON.stringify(r.content)) : "(no result)";
      steps.push(`- ${u.name}(${clip(oneLine(JSON.stringify(u.input ?? {})), DIGEST_ARGS_CHARS)}) ${r?.is_error ? "failed" : "->"} ${clip(out, DIGEST_RESULT_CHARS)}`);
    }
  }
  const dropped = steps.length - DIGEST_MAX_STEPS;
  const kept = dropped > 0 ? [`- (${dropped} earlier steps omitted)`, ...steps.slice(dropped)] : steps;
  return { steps: kept, lastText: clip(lastText, DIGEST_TEXT_CHARS) };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export class ProcessContext {
  constructor(
    readonly system: string,
    readonly messages: Message[],
  ) {}

  static fresh(p: Process, peers: Process[] = [], memory?: MemoryView): ProcessContext {
    return new ProcessContext(systemPrompt(p, peers, memory), [{ role: "user", content: `Your goal: ${p.goal}` }]);
  }

  /** Rebuild a context from a checkpoint snapshot, closing out the interrupted turn. */
  static restore(p: Process, snap: ContextSnapshot, checkpointSeq: number, peers: Process[] = [], memory?: MemoryView): ProcessContext {
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
    return new ProcessContext(systemPrompt(p, peers, memory), messages);
  }

  /**
   * Replace the history with one message: the goal plus a digest of the work so far. Used when
   * a process rolls over its token budget. The system prompt is untouched, so its cache holds.
   */
  compact(goal: string): void {
    const digest = digestHistory(this.messages);
    this.messages.splice(0, this.messages.length, {
      role: "user",
      content: [
        `Your goal: ${goal}`,
        ``,
        `You are continuing this goal with a compacted history to save tokens. Your sandbox files are unchanged.`,
        `Progress so far:`,
        ...(digest.steps.length ? digest.steps : [`- (no tool calls yet)`]),
        ...(digest.lastText ? [``, `Your latest notes:`, digest.lastText] : []),
        ``,
        `Continue from here. Do not redo finished steps.`,
      ].join("\n"),
    });
  }

  /** Add a note to the pending user turn without changing earlier messages. */
  appendNote(text: string): void {
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== "user") {
      this.messages.push({ role: "user", content: text });
    } else if (typeof last.content === "string") {
      last.content = `${last.content}\n\n${text}`;
    } else {
      last.content.push({ type: "text", text });
    }
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
