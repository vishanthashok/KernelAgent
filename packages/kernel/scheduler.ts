// Scheduler: one algorithm, a priority queue with aging.
// Scheduling is cooperative. The scheduler runs on job submit, state changes,
// syscall completion, and a periodic tick. It never preempts a RUNNING process.
import type { ProcessManager } from "./process-manager.ts";
import { exitedSuccessfully, type Process } from "./types.ts";

export interface SchedulerOptions {
  maxConcurrency: number;
  agingFactor: number; // priority points per second spent READY
  tickMs: number;
  now?: () => number;
  /** Extra admission check, e.g. the LLM rate limiter. */
  canDispatch?: () => boolean;
  /** Called after the process is RUNNING. */
  dispatch: (p: Process) => void;
  /** Called before dispatch, e.g. to emit PROCESS_SCHEDULED. */
  onSchedule?: (p: Process, effectivePriority: number) => void;
}

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private pending = false;
  private ticking = false;
  private now: () => number;
  /** Count of dispatch decisions refused because a limit was hit. */
  throttled = 0;

  constructor(
    private pm: ProcessManager,
    private opts: SchedulerOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  effectivePriority(p: Process, now = this.now()): number {
    const waitedSec = Math.max(0, now - (p.enqueuedAt ?? now)) / 1000;
    return p.priority + this.opts.agingFactor * waitedSec;
  }

  private depsSatisfied(p: Process): boolean {
    return p.dependsOn.every((d) => {
      const dep = this.pm.get(d);
      return dep !== undefined && exitedSuccessfully(dep);
    });
  }

  /** READY processes whose deps are done, ordered best-first. */
  readyQueue(now = this.now()): { process: Process; effectivePriority: number }[] {
    return this.pm
      .list({ status: "READY" })
      .filter((p) => this.depsSatisfied(p))
      .map((process) => ({ process, effectivePriority: this.effectivePriority(process, now) }))
      .sort(
        (a, b) =>
          b.effectivePriority - a.effectivePriority ||
          (a.process.enqueuedAt ?? 0) - (b.process.enqueuedAt ?? 0) ||
          Number(a.process.pid) - Number(b.process.pid) ||
          a.process.pid.localeCompare(b.process.pid),
      );
  }

  queueDepth(): number {
    return this.pm.countByStatus("READY");
  }

  running(): number {
    return this.pm.countByStatus("RUNNING");
  }

  /** Run one dispatch pass. Returns the number of processes dispatched. */
  tick(): number {
    if (this.ticking) {
      this.pending = true;
      return 0;
    }
    this.ticking = true;
    let dispatched = 0;
    try {
      const now = this.now();
      for (const { process, effectivePriority } of this.readyQueue(now)) {
        if (this.running() >= this.opts.maxConcurrency) {
          this.throttled++;
          break;
        }
        if (this.opts.canDispatch && !this.opts.canDispatch()) {
          this.throttled++;
          break;
        }
        // Re-read: an earlier dispatch in this pass may have changed state.
        if (this.pm.get(process.pid)?.status !== "READY") continue;
        this.opts.onSchedule?.(process, effectivePriority);
        const running = this.pm.transition(process.pid, "RUNNING", { reason: "DISPATCH" });
        dispatched++;
        this.opts.dispatch(running);
      }
    } finally {
      this.ticking = false;
    }
    if (this.pending) {
      this.pending = false;
      this.request();
    }
    return dispatched;
  }

  /** Coalesced asynchronous tick request. Safe to call from inside hooks. */
  request(): void {
    if (this.pending) return;
    this.pending = true;
    setImmediate(() => {
      this.pending = false;
      this.tick();
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
