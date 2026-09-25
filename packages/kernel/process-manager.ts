// Process Manager: owns the process table and the state machine.
// It is the ONLY code that mutates Process.status. Every transition emits STATE_CHANGE.
import type { ProcessRepo } from "@kernelagent/db";
import type { EventBus } from "./event-bus.ts";
import type { Process, ProcessStatus } from "./types.ts";

// Legal transitions. The brief's table plus documented extensions (see docs/decisions.md):
//   * -> TERMINATED     kill from any live state
//   NEW -> FAILED       a dependency failed permanently
//   READY/WAITING -> FAILED   timeout while not running
export const TRANSITIONS: Record<ProcessStatus, readonly ProcessStatus[]> = {
  NEW: ["READY", "FAILED", "TERMINATED"],
  READY: ["RUNNING", "FAILED", "TERMINATED"],
  RUNNING: ["WAITING", "READY", "TERMINATED", "FAILED"],
  WAITING: ["READY", "FAILED", "TERMINATED"],
  FAILED: ["READY"],
  TERMINATED: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    public pid: string,
    public from: ProcessStatus,
    public to: ProcessStatus,
  ) {
    super(`illegal transition for pid ${pid}: ${from} -> ${to}`);
  }
}

export function isLegalTransition(from: ProcessStatus, to: ProcessStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionInfo {
  process: Process;
  from: ProcessStatus;
  to: ProcessStatus;
  reason?: string;
}

export type TransitionHook = (t: TransitionInfo) => void;

export type ProcessPatch = Partial<Omit<Process, "pid" | "jobId" | "status" | "createdAt">>;

export class ProcessManager {
  private table = new Map<string, Process>();
  private runningSince = new Map<string, number>();
  private hooks: TransitionHook[] = [];

  constructor(
    private bus: EventBus,
    private repo: ProcessRepo,
    private now: () => number = Date.now,
  ) {}

  onTransition(h: TransitionHook): void {
    this.hooks.push(h);
  }

  create(init: Omit<Process, "status" | "createdAt" | "tokensUsed" | "costUsd" | "retryCount" | "runtimeMs">): Process {
    if (this.table.has(init.pid)) throw new Error(`pid ${init.pid} already exists`);
    const p: Process = {
      ...init,
      status: "NEW",
      tokensUsed: 0,
      costUsd: 0,
      retryCount: 0,
      runtimeMs: 0,
      createdAt: this.now(),
    };
    this.table.set(p.pid, p);
    this.repo.upsert(p);
    this.bus.emit("PROCESS_CREATED", p.jobId, p.pid, {
      role: p.role,
      goal: p.goal,
      parentPid: p.parentPid,
      priority: p.priority,
      tokenBudget: p.tokenBudget,
      capabilities: p.capabilities,
      dependsOn: p.dependsOn,
      maxRetries: p.maxRetries,
      timeoutMs: p.timeoutMs,
    });
    return { ...p };
  }

  /**
   * On boot, processes left live by a previous kernel run have no execution loop behind them.
   * Mark them FAILED so the table and the log agree. Returns the pids recovered.
   */
  recoverOrphans(): string[] {
    const out: string[] = [];
    for (const row of this.repo.list()) {
      if (row.status === "TERMINATED" || row.status === "FAILED") continue;
      const p = row as unknown as Process;
      const from = p.status;
      this.repo.upsert({ ...row, status: "FAILED", error: "KERNEL_RESTART", completedAt: this.now() });
      this.bus.emit("PROCESS_CRASH", p.jobId, p.pid, { reason: "KERNEL_RESTART", from });
      this.bus.emit("STATE_CHANGE", p.jobId, p.pid, { from, to: "FAILED", reason: "KERNEL_RESTART" });
      out.push(p.pid);
    }
    return out;
  }

  get(pid: string): Process | undefined {
    const p = this.table.get(pid);
    return p ? { ...p } : undefined;
  }

  require(pid: string): Process {
    const p = this.get(pid);
    if (!p) throw new Error(`no such process: ${pid}`);
    return p;
  }

  list(filter: { jobId?: string; status?: ProcessStatus } = {}): Process[] {
    const out: Process[] = [];
    for (const p of this.table.values()) {
      if (filter.jobId && p.jobId !== filter.jobId) continue;
      if (filter.status && p.status !== filter.status) continue;
      out.push({ ...p });
    }
    return out;
  }

  countByStatus(status: ProcessStatus): number {
    let n = 0;
    for (const p of this.table.values()) if (p.status === status) n++;
    return n;
  }

  /** Runtime including the current RUNNING slice, in ms. */
  runtimeMs(pid: string): number {
    const p = this.table.get(pid);
    if (!p) return 0;
    const since = this.runningSince.get(pid);
    return p.runtimeMs + (since !== undefined ? this.now() - since : 0);
  }

  transition(pid: string, to: ProcessStatus, opts: { reason?: string; error?: string } = {}): Process {
    const p = this.table.get(pid);
    if (!p) throw new Error(`no such process: ${pid}`);
    const from = p.status;
    if (!isLegalTransition(from, to)) throw new IllegalTransitionError(pid, from, to);

    const t = this.now();
    const since = this.runningSince.get(pid);
    if (from === "RUNNING" && since !== undefined) {
      p.runtimeMs += t - since;
      this.runningSince.delete(pid);
    }
    p.status = to;
    if (to === "READY") p.enqueuedAt = t;
    if (to === "RUNNING") {
      p.startedAt ??= t;
      this.runningSince.set(pid, t);
    }
    if (to === "TERMINATED" || to === "FAILED") p.completedAt = t;
    if (to === "READY") delete p.completedAt;
    if (opts.error !== undefined) p.error = opts.error;

    this.repo.upsert(p);
    this.bus.emit("STATE_CHANGE", p.jobId, pid, {
      from,
      to,
      ...(opts.reason ? { reason: opts.reason } : {}),
      ...(opts.error ? { error: opts.error } : {}),
    });

    const snapshot = { ...p };
    for (const h of this.hooks) h({ process: snapshot, from, to, ...(opts.reason ? { reason: opts.reason } : {}) });
    return snapshot;
  }

  /** Update non-status fields. Status changes must go through transition(). */
  update(pid: string, patch: ProcessPatch): Process {
    const p = this.table.get(pid);
    if (!p) throw new Error(`no such process: ${pid}`);
    if ("status" in patch) throw new Error("status can only change via transition()");
    Object.assign(p, patch);
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (p as unknown as Record<string, unknown>)[k];
    this.repo.upsert(p);
    return { ...p };
  }
}
