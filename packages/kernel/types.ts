// Canonical data models for KernelAgent. Every other package imports these.

export type ProcessStatus =
  | "NEW"
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "TERMINATED"
  | "FAILED";

export type CapabilityType =
  | "FS_READ"
  | "FS_WRITE"
  | "EXEC"
  | "SPAWN"
  | "NET"
  | "SEND"
  | "RECEIVE";

export interface Capability {
  type: CapabilityType;
  // Optional scoping: path prefix for FS, host allowlist for NET, pid for SEND.
  scope?: string;
  // Human approval gate: a syscall using this capability waits for approve/deny.
  requiresApproval?: boolean;
}

export interface Process {
  pid: string;
  parentPid?: string;
  jobId: string;

  role: string;
  goal: string;
  status: ProcessStatus;

  priority: number;
  enqueuedAt?: number;

  tokenBudget: number;
  tokensUsed: number;
  costUsd: number;

  sandboxId?: string;
  capabilities: Capability[];

  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  lastCheckpointSeq?: number;

  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;

  // Wall-clock limit in ms, measured from first RUNNING.
  timeoutMs: number;
  // Accumulated time spent RUNNING, used for the derived CPU* figure.
  runtimeMs: number;
  // Final result passed to EXIT.
  result?: string;
}

export type KernelEventType =
  | "JOB_SUBMITTED"
  | "PROCESS_CREATED"
  | "PROCESS_SCHEDULED"
  | "STATE_CHANGE"
  | "LLM_CALL"
  | "SYSCALL"
  | "MESSAGE"
  | "BLOCKED"
  | "CHECKPOINT"
  | "PROCESS_EXIT"
  | "PROCESS_CRASH";

export interface KernelEvent<P = unknown> {
  sequence: number;
  jobId: string;
  pid?: string;
  type: KernelEventType;
  payload: P;
  timestamp: number;
}

export type JobStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface Job {
  id: string;
  spec: import("./job-spec.ts").JobSpec;
  status: JobStatus;
  createdAt: number;
  tokenBudget?: number;
}

export const TERMINAL_STATES: ReadonlySet<ProcessStatus> = new Set(["TERMINATED", "FAILED"]);

/** Error marker for a process that was killed. A killed process is TERMINATED but did not succeed. */
export const KILLED = "KILLED";

/** A dependency is satisfied only by a process that TERMINATED on its own (EXIT), not by a kill. */
export function exitedSuccessfully(p: Pick<Process, "status" | "error">): boolean {
  return p.status === "TERMINATED" && p.error !== KILLED;
}
