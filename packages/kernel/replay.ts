// Replay: derive process state from the event log alone. The log is the source of truth;
// this fold must agree with the live process table. It has no runtime dependencies, so
// the console can import it to rewind a job to any sequence number.
import type { Capability, KernelEvent, ProcessStatus } from "./types.ts";
import { budgetTokens } from "./budget.ts";

export interface ReplayedProcess {
  pid: string;
  jobId: string;
  parentPid?: string;
  role: string;
  goal: string;
  status: ProcessStatus;
  priority: number;
  tokenBudget: number;
  tokensUsed: number;
  costUsd: number;
  capabilities: Capability[];
  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
  runtimeMs: number;
  sandboxId?: string;
  lastCheckpointSeq?: number;
  result?: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  /** Timestamp of the current RUNNING slice start, if RUNNING. */
  runningSince?: number;
  waitingOn?: string;
  lastSequence: number;
}

type P = Record<string, any>;

/** Apply one event to a process map in place. Returns the map for chaining. */
export function applyEvent(procs: Map<string, ReplayedProcess>, e: KernelEvent): Map<string, ReplayedProcess> {
  const p = e.payload as P;
  if (e.type === "PROCESS_CREATED" && e.pid) {
    procs.set(e.pid, {
      pid: e.pid,
      jobId: e.jobId,
      ...(p.parentPid ? { parentPid: p.parentPid } : {}),
      role: p.role,
      goal: p.goal,
      status: "NEW",
      priority: p.priority ?? 0,
      tokenBudget: p.tokenBudget ?? 0,
      tokensUsed: 0,
      costUsd: 0,
      capabilities: p.capabilities ?? [],
      dependsOn: p.dependsOn ?? [],
      retryCount: 0,
      maxRetries: p.maxRetries ?? 0,
      timeoutMs: p.timeoutMs ?? 0,
      runtimeMs: 0,
      createdAt: e.timestamp,
      lastSequence: e.sequence,
    });
    return procs;
  }
  const proc = e.pid ? procs.get(e.pid) : undefined;
  if (!proc) return procs;
  proc.lastSequence = e.sequence;

  switch (e.type) {
    case "STATE_CHANGE": {
      const from = p.from as ProcessStatus;
      const to = p.to as ProcessStatus;
      if (from === "RUNNING" && proc.runningSince !== undefined) {
        proc.runtimeMs += e.timestamp - proc.runningSince;
        delete proc.runningSince;
      }
      proc.status = to;
      if (to !== "WAITING") delete proc.waitingOn;
      else if (p.reason) proc.waitingOn = p.reason;
      if (to === "RUNNING") {
        proc.startedAt ??= e.timestamp;
        proc.runningSince = e.timestamp;
      }
      if (to === "TERMINATED" || to === "FAILED") proc.completedAt = e.timestamp;
      if (to === "READY") delete proc.completedAt;
      if (p.error) proc.error = p.error;
      if (from === "FAILED" && to === "READY") {
        proc.retryCount += 1;
        delete proc.startedAt;
        delete proc.error;
      }
      break;
    }
    case "LLM_CALL":
      proc.tokensUsed += budgetTokens(p.inputTokens ?? 0, p.outputTokens ?? 0, { read: p.cacheReadTokens, write: p.cacheWriteTokens });
      proc.costUsd += p.costUsd ?? 0;
      if (p.sandboxId) proc.sandboxId = p.sandboxId;
      break;
    case "SYSCALL":
      if (p.sandboxId) proc.sandboxId = p.sandboxId;
      break;
    case "BUDGET_EXTENDED":
      proc.tokenBudget = p.tokenBudget;
      break;
    case "CHECKPOINT":
      proc.lastCheckpointSeq = e.sequence;
      break;
    case "PROCESS_EXIT":
      if (p.killed) proc.error = "KILLED";
      else proc.result = p.result;
      break;
  }
  return procs;
}

/** Fold events (in sequence order) into process states, optionally stopping at a sequence. */
export function replayProcesses(events: readonly KernelEvent[], untilSeq = Infinity): Map<string, ReplayedProcess> {
  const procs = new Map<string, ReplayedProcess>();
  for (const e of events) {
    if (e.sequence > untilSeq) break;
    applyEvent(procs, e);
  }
  return procs;
}
