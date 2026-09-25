// Resource Manager. The scarce resources of an agent kernel are tokens, dollars,
// wall-clock time, and provider rate limits. There is no real CPU to schedule.
import { costUsd } from "./config.ts";
import type { ProcessManager } from "./process-manager.ts";

/** Classic token bucket. Refills continuously at capacity per windowMs. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    public readonly capacity: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.last;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.capacity) / this.windowMs);
      this.last = t;
    }
  }

  available(): number {
    this.refill();
    return this.tokens;
  }

  tryTake(n: number): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /** Debit without checking. Used to reconcile estimates with actual usage. May go negative. */
  debit(n: number): void {
    this.refill();
    this.tokens -= n;
  }

  /** Milliseconds until n tokens are available. */
  msUntil(n: number): number {
    const avail = this.available();
    if (avail >= n) return 0;
    return Math.ceil(((n - avail) * this.windowMs) / this.capacity);
  }

  /** 0 = idle, 1 = empty. */
  saturation(): number {
    return Math.min(1, Math.max(0, 1 - this.available() / this.capacity));
  }
}

export interface RateLimits {
  requestsPerMinute: number;
  tokensPerMinute: number;
}

/**
 * Per-provider RPM + TPM limiter. The scheduler consults canDispatch() before dispatch and
 * reserves one request per dispatched process, so a single tick cannot over-admit.
 * The reservation is consumed by that process's next model call, or released when it stops.
 */
export class RateLimiter {
  readonly requests: TokenBucket;
  readonly tokens: TokenBucket;
  private reserved = new Set<string>();

  constructor(
    limits: RateLimits,
    private now: () => number = Date.now,
  ) {
    this.requests = new TokenBucket(limits.requestsPerMinute, 60_000, now);
    this.tokens = new TokenBucket(limits.tokensPerMinute, 60_000, now);
  }

  canDispatch(): boolean {
    return this.requests.available() - this.reserved.size >= 1 && this.tokens.available() > 0;
  }

  reserve(pid: string): void {
    this.reserved.add(pid);
  }

  release(pid: string): void {
    this.reserved.delete(pid);
  }

  reservations(): number {
    return this.reserved.size;
  }

  /** Wait until one request and the estimated tokens fit, then take them. */
  async acquire(estimatedTokens: number, signal?: AbortSignal, pid?: string): Promise<void> {
    const est = Math.min(estimatedTokens, this.tokens.capacity);
    if (pid) this.reserved.delete(pid);
    for (;;) {
      signal?.throwIfAborted();
      const wait = Math.max(this.requests.msUntil(1), this.tokens.msUntil(est));
      if (wait === 0 && this.requests.tryTake(1)) {
        this.tokens.debit(est);
        return;
      }
      // Poll rather than sleep the full wait, so an injected clock or a refill is noticed.
      await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 5), 250)));
    }
  }

  /** Reconcile an estimate with the real token count once the call returns. */
  reconcile(estimatedTokens: number, actualTokens: number): void {
    const est = Math.min(estimatedTokens, this.tokens.capacity);
    this.tokens.debit(actualTokens - est);
  }

  saturation(): { requests: number; tokens: number } {
    return { requests: this.requests.saturation(), tokens: this.tokens.saturation() };
  }
}

export type BudgetViolation = "TOKEN_BUDGET_EXCEEDED" | "JOB_TOKEN_BUDGET_EXCEEDED";

export class ResourceManager {
  private limiters = new Map<string, RateLimiter>();

  constructor(
    private pm: ProcessManager,
    private limits: RateLimits,
    private jobBudget: (jobId: string) => number | undefined,
    private now: () => number = Date.now,
  ) {}

  limiter(provider: string): RateLimiter {
    let l = this.limiters.get(provider);
    if (!l) {
      l = new RateLimiter(this.limits, this.now);
      this.limiters.set(provider, l);
    }
    return l;
  }

  jobTokensUsed(jobId: string): number {
    return this.pm.list({ jobId }).reduce((s, p) => s + p.tokensUsed, 0);
  }

  /** Pre-call check: is there any budget left? */
  checkBudget(pid: string): BudgetViolation | undefined {
    const p = this.pm.require(pid);
    if (p.tokensUsed >= p.tokenBudget) return "TOKEN_BUDGET_EXCEEDED";
    const jb = this.jobBudget(p.jobId);
    if (jb !== undefined && this.jobTokensUsed(p.jobId) >= jb) return "JOB_TOKEN_BUDGET_EXCEEDED";
    return undefined;
  }

  /** Deduct usage from an LLM call. Returns a violation if a budget is now exceeded. */
  charge(pid: string, model: string, inputTokens: number, outputTokens: number): BudgetViolation | undefined {
    const p = this.pm.require(pid);
    const tokensUsed = p.tokensUsed + inputTokens + outputTokens;
    const cost = p.costUsd + costUsd(model, inputTokens, outputTokens);
    this.pm.update(pid, { tokensUsed, costUsd: cost });
    if (tokensUsed > p.tokenBudget) return "TOKEN_BUDGET_EXCEEDED";
    const jb = this.jobBudget(p.jobId);
    if (jb !== undefined && this.jobTokensUsed(p.jobId) > jb) return "JOB_TOKEN_BUDGET_EXCEEDED";
    return undefined;
  }

  /** Wall-clock deadline for a process, or undefined if it never ran. */
  deadline(pid: string): number | undefined {
    const p = this.pm.get(pid);
    if (!p?.startedAt) return undefined;
    return p.startedAt + p.timeoutMs;
  }
}
