// Kernel: composition root. Wires the process manager, scheduler, resource manager,
// event bus, and (from Phase 2) the syscall dispatcher, sandbox, and IPC.
// Execution itself lives in @kernelagent/runtime, attached as a ProcessRunner.
import { randomUUID } from "node:crypto";
import { createRepositories, type Repositories } from "@kernelagent/db";
import { estimateTokens, type CompletionRequest, type CompletionResponse, type ModelClient } from "@kernelagent/llm";
import { configFromEnv, costUsd, type KernelConfig } from "./config.ts";
import { EventBus } from "./event-bus.ts";
import { normalizeJobSpec } from "./job-spec.ts";
import { ProcessManager, type TransitionInfo } from "./process-manager.ts";
import { ResourceManager } from "./resource-manager.ts";
import { Scheduler } from "./scheduler.ts";
import { exitedSuccessfully, KILLED, type Capability, type Job, type JobStatus, type Process, type ProcessStatus } from "./types.ts";

/** State handed to a runner when it resumes a process from a checkpoint. */
export interface ResumeState {
  checkpointSeq: number;
  context: unknown;
}

/**
 * A handle for one execution attempt of a process. Every kernel call from a runner passes
 * its handle, so a stale loop (killed, timed out, or superseded by a retry) cannot act.
 */
export interface RunHandle {
  pid: string;
  jobId: string;
  generation: number;
  signal: AbortSignal;
  resume?: ResumeState;
}

export interface ProcessRunner {
  run(handle: RunHandle): Promise<void>;
}

export class KernelAbortedError extends Error {
  constructor(message = "run aborted") {
    super(message);
    this.name = "KernelAbortedError";
  }
}

export class BudgetExceededError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "BudgetExceededError";
  }
}

export type WaitReason = "RECEIVE" | "SLEEP" | "APPROVAL";

interface RunState {
  generation: number;
  abort: AbortController;
  waitingOn?: WaitReason;
  continuation?: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  wakeValue?: unknown;
}

// Failure reasons that retrying cannot fix.
const NON_RETRYABLE = new Set(["TOKEN_BUDGET_EXCEEDED", "JOB_TOKEN_BUDGET_EXCEEDED", "DEPENDENCY_FAILED", "KERNEL_RESTART"]);

export interface KernelOptions {
  llm: ModelClient;
  repos?: Repositories;
  config?: Partial<KernelConfig>;
  now?: () => number;
}

export interface SubmitResult {
  jobId: string;
  /** Map from spec-local process id to kernel pid. */
  pids: Record<string, string>;
}

export class Kernel {
  readonly repos: Repositories;
  readonly bus: EventBus;
  readonly pm: ProcessManager;
  readonly scheduler: Scheduler;
  readonly resources: ResourceManager;
  readonly config: KernelConfig;
  readonly llm: ModelClient;
  readonly now: () => number;
  readonly bootedAt: number;

  private runner?: ProcessRunner;
  private runs = new Map<string, RunState>();
  private jobs = new Map<string, Job>();
  private jobWaiters = new Map<string, ((j: Job) => void)[]>();
  private nextPid: number;
  private watchdog?: NodeJS.Timeout;
  private generations = new Map<string, number>();

  constructor(opts: KernelOptions) {
    this.config = { ...configFromEnv(), ...(opts.config ?? {}) };
    this.now = opts.now ?? Date.now;
    this.bootedAt = this.now();
    this.llm = opts.llm;
    this.repos = opts.repos ?? createRepositories(this.config.dbPath);
    this.bus = new EventBus(this.repos.events, this.now);
    this.pm = new ProcessManager(this.bus, this.repos.processes, this.now);
    this.resources = new ResourceManager(
      this.pm,
      this.config.rateLimits,
      (jobId) => this.jobs.get(jobId)?.tokenBudget,
      this.now,
    );
    this.scheduler = new Scheduler(this.pm, {
      maxConcurrency: this.config.maxConcurrency,
      agingFactor: this.config.agingFactor,
      tickMs: this.config.tickMs,
      now: this.now,
      canDispatch: () => this.resources.limiter(this.llm.provider).canDispatch(),
      onSchedule: (p, effectivePriority) =>
        this.bus.emit("PROCESS_SCHEDULED", p.jobId, p.pid, {
          priority: p.priority,
          effectivePriority,
          queueDepth: this.scheduler.queueDepth(),
          running: this.scheduler.running(),
        }),
      dispatch: (p) => this.onDispatch(p),
    });
    this.pm.onTransition((t) => this.onTransition(t));

    this.pm.recoverOrphans();
    for (const j of this.repos.jobs.list()) if (j.status === "RUNNING") this.repos.jobs.setStatus(j.id, "FAILED");
    this.nextPid = Math.max(100, this.repos.processes.maxNumericPid()) + 1;
  }

  attachRunner(runner: ProcessRunner): void {
    this.runner = runner;
  }

  start(): void {
    this.scheduler.start();
    if (!this.watchdog) {
      this.watchdog = setInterval(() => this.checkTimeouts(), Math.max(50, this.config.tickMs));
      this.watchdog.unref?.();
    }
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = undefined;
    for (const [pid, r] of this.runs) {
      r.abort.abort(new KernelAbortedError("kernel stopped"));
      r.continuation?.reject(new KernelAbortedError("kernel stopped"));
      this.runs.delete(pid);
    }
  }

  // ---------------------------------------------------------------- jobs

  submitJob(input: unknown): SubmitResult {
    const { spec, processes } = normalizeJobSpec(input);
    const jobId = `job_${randomUUID().slice(0, 8)}`;
    const job: Job = {
      id: jobId,
      spec,
      status: "RUNNING",
      createdAt: this.now(),
      ...(spec.tokenBudget !== undefined ? { tokenBudget: spec.tokenBudget } : {}),
    };
    this.jobs.set(jobId, job);
    this.repos.jobs.insert(job);
    this.bus.emit("JOB_SUBMITTED", jobId, undefined, { spec });

    const pids: Record<string, string> = {};
    for (const p of processes) pids[p.id] = this.allocPid();
    for (const p of processes) {
      this.pm.create({
        pid: pids[p.id]!,
        jobId,
        role: p.role,
        goal: p.goal,
        priority: p.priority,
        tokenBudget: p.tokenBudget,
        capabilities: p.capabilities as Capability[],
        dependsOn: p.dependsOn.map((d) => pids[d]!),
        maxRetries: p.maxRetries,
        timeoutMs: p.timeoutMs,
      });
    }
    for (const p of processes) if (p.dependsOn.length === 0) this.pm.transition(pids[p.id]!, "READY", { reason: "SUBMITTED" });
    this.scheduler.request();
    return { jobId, pids };
  }

  /** Create a process inside an existing job. Used by SPAWN. Capabilities must already be attenuated. */
  createChildProcess(parent: Process, init: {
    role: string;
    goal: string;
    capabilities: Capability[];
    priority?: number;
    tokenBudget?: number;
    maxRetries?: number;
    timeoutMs?: number;
  }): Process {
    const pid = this.allocPid();
    this.pm.create({
      pid,
      parentPid: parent.pid,
      jobId: parent.jobId,
      role: init.role,
      goal: init.goal,
      priority: init.priority ?? parent.priority,
      tokenBudget: init.tokenBudget ?? Math.max(1, Math.floor((parent.tokenBudget - parent.tokensUsed) / 2)),
      capabilities: init.capabilities,
      dependsOn: [],
      maxRetries: init.maxRetries ?? parent.maxRetries,
      timeoutMs: init.timeoutMs ?? parent.timeoutMs,
    });
    const p = this.pm.transition(pid, "READY", { reason: "SPAWNED" });
    this.scheduler.request();
    return p;
  }

  getJob(jobId: string): Job | undefined {
    const live = this.jobs.get(jobId);
    if (live) return { ...live };
    const rec = this.repos.jobs.get(jobId);
    return rec ? ({ ...rec, status: rec.status as JobStatus } as Job) : undefined;
  }

  listJobs(): Job[] {
    return this.repos.jobs.list().map((r) => this.jobs.get(r.id) ?? ({ ...r, status: r.status as JobStatus } as Job));
  }

  waitForJob(jobId: string, timeoutMs = 30_000): Promise<Job> {
    const job = this.getJob(jobId);
    if (!job) return Promise.reject(new Error(`no such job: ${jobId}`));
    if (job.status !== "RUNNING") return Promise.resolve(job);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out waiting for job ${jobId}`)), timeoutMs);
      const list = this.jobWaiters.get(jobId) ?? [];
      list.push((j) => {
        clearTimeout(t);
        resolve(j);
      });
      this.jobWaiters.set(jobId, list);
    });
  }

  // ------------------------------------------------------- runner interface

  /** Throw if this handle no longer owns the process. */
  assertLive(h: RunHandle): void {
    const r = this.runs.get(h.pid);
    if (!r || r.generation !== h.generation || h.signal.aborted) throw new KernelAbortedError();
  }

  isLive(h: RunHandle): boolean {
    const r = this.runs.get(h.pid);
    return !!r && r.generation === h.generation && !h.signal.aborted;
  }

  /**
   * Call the model on behalf of a process. Applies the rate limiter, records the full
   * request and response as an LLM_CALL event, and charges the token budget.
   */
  async callModel(h: RunHandle, req: Omit<CompletionRequest, "metadata">): Promise<CompletionResponse> {
    this.assertLive(h);
    const pre = this.resources.checkBudget(h.pid);
    if (pre) {
      this.failRun(h, pre, `${pre}: no budget left before model call`);
      throw new BudgetExceededError(pre);
    }
    const proc = this.pm.require(h.pid);
    const limiter = this.resources.limiter(this.llm.provider);
    const estimate = estimateTokens(req.system) + estimateTokens(req.messages) + estimateTokens(req.tools);
    await limiter.acquire(estimate, h.signal);
    this.assertLive(h);

    const started = this.now();
    const fullReq: CompletionRequest = {
      ...req,
      metadata: { pid: proc.pid, role: proc.role, goal: proc.goal, jobId: proc.jobId },
    };
    const res = await this.llm.complete(fullReq, { signal: h.signal });
    this.assertLive(h);
    limiter.reconcile(estimate, res.inputTokens + res.outputTokens);

    this.bus.emit("LLM_CALL", proc.jobId, proc.pid, {
      provider: this.llm.provider,
      model: this.llm.model,
      request: { system: req.system, messages: req.messages, tools: req.tools },
      response: { content: res.content, raw: res.raw },
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: costUsd(this.llm.model, res.inputTokens, res.outputTokens),
      durationMs: this.now() - started,
    });

    const violation = this.resources.charge(h.pid, this.llm.model, res.inputTokens, res.outputTokens);
    if (violation) {
      this.failRun(h, violation, `${violation}: used ${this.pm.require(h.pid).tokensUsed} tokens`);
      throw new BudgetExceededError(violation);
    }
    return res;
  }

  /** Terminate the calling process with a result. */
  exit(h: RunHandle, result: string): void {
    this.assertLive(h);
    const p = this.pm.update(h.pid, { result });
    this.endRun(h.pid);
    this.bus.emit("PROCESS_EXIT", p.jobId, p.pid, { result, tokensUsed: p.tokensUsed, costUsd: p.costUsd });
    this.pm.transition(h.pid, "TERMINATED", { reason: "EXIT" });
  }

  /** Fail the calling process. The retry policy runs from the transition hook. */
  failRun(h: RunHandle, reason: string, error: string): void {
    if (!this.isLive(h)) return;
    this.endRun(h.pid);
    const p = this.pm.require(h.pid);
    if (p.status === "RUNNING" || p.status === "WAITING" || p.status === "READY") {
      this.pm.transition(h.pid, "FAILED", { reason, error });
    }
  }

  /** Cooperative yield: give up the slot and go back to the ready queue. */
  async yield(h: RunHandle): Promise<void> {
    this.assertLive(h);
    const r = this.runs.get(h.pid)!;
    const p = new Promise<unknown>((resolve, reject) => (r.continuation = { resolve, reject }));
    this.pm.transition(h.pid, "READY", { reason: "YIELD" });
    await p;
    this.assertLive(h);
  }

  /**
   * Block the calling process: RUNNING -> WAITING, emit BLOCKED, release the slot, and
   * wait until wake() makes it READY and the scheduler dispatches it again.
   */
  async block<T = unknown>(h: RunHandle, reason: WaitReason, info: Record<string, unknown> = {}): Promise<T> {
    this.assertLive(h);
    const r = this.runs.get(h.pid)!;
    const p = new Promise<unknown>((resolve, reject) => (r.continuation = { resolve, reject }));
    r.waitingOn = reason;
    delete r.wakeValue;
    const proc = this.pm.transition(h.pid, "WAITING", { reason });
    this.bus.emit("BLOCKED", proc.jobId, proc.pid, { reason, ...info });
    this.scheduler.request();
    const v = await p;
    this.assertLive(h);
    return v as T;
  }

  /** What a WAITING process is waiting on, if anything. */
  waitingOn(pid: string): WaitReason | undefined {
    return this.pm.get(pid)?.status === "WAITING" ? this.runs.get(pid)?.waitingOn : undefined;
  }

  /** Wake a WAITING process. The value is returned from its block() call once it is dispatched. */
  wake(pid: string, value?: unknown, reason = "WAKE"): boolean {
    const r = this.runs.get(pid);
    if (!r || this.pm.get(pid)?.status !== "WAITING") return false;
    r.wakeValue = value;
    delete r.waitingOn;
    this.pm.transition(pid, "READY", { reason });
    this.scheduler.request();
    return true;
  }

  // ------------------------------------------------------------ lifecycle

  private allocPid(): string {
    return String(this.nextPid++);
  }

  private onDispatch(p: Process): void {
    const r = this.runs.get(p.pid);
    if (r?.continuation) {
      const c = r.continuation;
      const v = r.wakeValue;
      delete r.continuation;
      delete r.wakeValue;
      c.resolve(v);
      return;
    }
    this.startRun(p);
  }

  private startRun(p: Process): void {
    if (!this.runner) {
      this.pm.transition(p.pid, "FAILED", { reason: "NO_RUNNER", error: "no runner attached" });
      return;
    }
    const generation = (this.generations.get(p.pid) ?? 0) + 1;
    this.generations.set(p.pid, generation);
    const abort = new AbortController();
    this.runs.set(p.pid, { generation, abort });

    let resume: ResumeState | undefined;
    if (p.lastCheckpointSeq !== undefined) {
      const ev = this.bus.getEvent(p.lastCheckpointSeq);
      if (ev?.type === "CHECKPOINT") resume = { checkpointSeq: ev.sequence, context: (ev.payload as { context: unknown }).context };
    }
    const handle: RunHandle = {
      pid: p.pid,
      jobId: p.jobId,
      generation,
      signal: abort.signal,
      ...(resume ? { resume } : {}),
    };

    Promise.resolve()
      .then(() => this.beforeRun(handle))
      .then(() => this.runner!.run(handle))
      .then(() => {
        // A runner that returns without EXIT ends the process with no result.
        if (this.isLive(handle)) this.exit(handle, "");
      })
      .catch((err: unknown) => {
        if (err instanceof KernelAbortedError || err instanceof BudgetExceededError) return;
        if (!this.isLive(handle)) return;
        const message = err instanceof Error ? err.message : String(err);
        const proc = this.pm.require(handle.pid);
        this.bus.emit("PROCESS_CRASH", proc.jobId, proc.pid, {
          error: message,
          stack: err instanceof Error ? err.stack : undefined,
        });
        this.failRun(handle, "CRASH", message);
      });
  }

  /** Hook for per-run setup (sandbox creation). Overridden in Phase 2 wiring. */
  protected async beforeRun(_h: RunHandle): Promise<void> {}

  /** Hook for cleanup when a process is permanently done. */
  protected async afterExit(_p: Process): Promise<void> {}

  private endRun(pid: string): void {
    const r = this.runs.get(pid);
    if (!r) return;
    this.runs.delete(pid);
    r.abort.abort(new KernelAbortedError());
    r.continuation?.reject(new KernelAbortedError());
  }

  private onTransition(t: TransitionInfo): void {
    const p = t.process;
    if (t.to === "FAILED") {
      this.endRun(p.pid);
      const retryable = !NON_RETRYABLE.has(t.reason ?? "") && t.from !== "NEW";
      if (retryable && p.retryCount < p.maxRetries) {
        this.pm.update(p.pid, { retryCount: p.retryCount + 1, startedAt: undefined });
        this.pm.transition(p.pid, "READY", { reason: `RETRY ${p.retryCount + 1}/${p.maxRetries}` });
        return;
      }
      this.onPermanentEnd(p);
    } else if (t.to === "TERMINATED") {
      this.endRun(p.pid);
      this.onPermanentEnd(p);
    }
    this.scheduler.request();
  }

  private onPermanentEnd(p: Process): void {
    const succeeded = exitedSuccessfully(this.pm.require(p.pid));
    for (const dep of this.pm.list({ jobId: p.jobId, status: "NEW" })) {
      if (!dep.dependsOn.includes(p.pid)) continue;
      if (!succeeded) {
        this.pm.transition(dep.pid, "FAILED", { reason: "DEPENDENCY_FAILED", error: `dependency ${p.pid} did not complete` });
        continue;
      }
      const ready = dep.dependsOn.every((d) => {
        const dp = this.pm.get(d);
        return dp !== undefined && exitedSuccessfully(dp);
      });
      if (ready) this.pm.transition(dep.pid, "READY", { reason: "DEPENDENCIES_MET" });
    }
    void this.afterExit(this.pm.require(p.pid)).catch((err) => console.error("[kernel] cleanup error", err));
    this.checkJob(p.jobId);
  }

  private checkJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "RUNNING") return;
    const procs = this.pm.list({ jobId });
    const settled = (s: ProcessStatus) => s === "TERMINATED" || s === "FAILED";
    if (!procs.every((p) => settled(p.status))) return;
    job.status = procs.every((p) => exitedSuccessfully(p)) ? "COMPLETED" : "FAILED";
    this.repos.jobs.setStatus(jobId, job.status);
    const waiters = this.jobWaiters.get(jobId) ?? [];
    this.jobWaiters.delete(jobId);
    for (const w of waiters) w({ ...job });
  }

  // ------------------------------------------------- kill, signals, timeouts

  /** Kill a process and all its descendants. */
  kill(pid: string, reason = KILLED): string[] {
    const root = this.pm.get(pid);
    if (!root) throw new Error(`no such process: ${pid}`);
    const victims: string[] = [];
    const collect = (p: string) => {
      victims.push(p);
      for (const c of this.pm.list({ jobId: root.jobId })) if (c.parentPid === p) collect(c.pid);
    };
    collect(pid);
    const killed: string[] = [];
    // Kill children first so a parent never outlives its children in the log.
    for (const v of victims.reverse()) {
      const p = this.pm.require(v);
      if (p.status === "TERMINATED" || p.status === "FAILED") continue;
      this.endRun(v);
      this.pm.update(v, { error: KILLED });
      this.bus.emit("PROCESS_EXIT", p.jobId, v, { killed: true, reason });
      this.pm.transition(v, "TERMINATED", { reason });
      killed.push(v);
    }
    return killed;
  }

  private checkTimeouts(): void {
    const now = this.now();
    for (const p of this.pm.list()) {
      if (p.status !== "RUNNING" && p.status !== "WAITING" && p.status !== "READY") continue;
      if (p.startedAt === undefined || now - p.startedAt <= p.timeoutMs) continue;
      this.endRun(p.pid);
      this.pm.transition(p.pid, "FAILED", { reason: "TIMEOUT", error: `exceeded ${p.timeoutMs}ms wall-clock limit` });
    }
  }

  /** Force a timeout check now. Exposed for tests. */
  runWatchdog(): void {
    this.checkTimeouts();
  }

  /** Access run bookkeeping for a pid. Used by the syscall layer. */
  protected runState(pid: string): RunState | undefined {
    return this.runs.get(pid);
  }
}
