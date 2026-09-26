// Aggregates the event log into dashboard metrics: time buckets, window totals with the
// previous window for comparison, and breakdowns. Pure over MetricsRepo rows.
import type { MetricsRepo } from "@kernelagent/db";

export const RANGES = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
} as const;
export type RangeKey = keyof typeof RANGES;
export const isRange = (r: string): r is RangeKey => r in RANGES;

export const BUCKETS = 60;
/** Syscall types shown by name. The rest fold into "Other". */
const TOP_SYSCALLS = 5;

export interface Totals {
  llmCalls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  savingsUsd: number;
  /** Share of input tokens served from the prompt cache, 0 to 1. */
  cacheHitRate: number;
  p50Ms: number;
  p95Ms: number;
  syscalls: number;
  failedSyscalls: number;
  denials: number;
  crashes: number;
  /** Failed and denied syscalls over all syscalls, 0 to 1. */
  errorRate: number;
  agentsFinished: number;
  agentsFailed: number;
}

export interface Bucket {
  t: number;
  llmCalls: number;
  uncachedInput: number;
  cachedInput: number;
  outputTokens: number;
  costUsd: number;
  savingsUsd: number;
  p50Ms: number;
  p95Ms: number;
  /** Counts by syscall type, keyed by the names in Metrics.syscallTypes. */
  syscalls: Record<string, number>;
  failedSyscalls: number;
  denials: number;
  crashes: number;
  agentsFinished: number;
  agentsFailed: number;
}

export interface Metrics {
  range: RangeKey;
  from: number;
  to: number;
  bucketMs: number;
  buckets: Bucket[];
  /** Syscall series, most used first, "Other" last when present. */
  syscallTypes: string[];
  totals: Totals;
  previous: Totals;
  byModel: { model: string; calls: number; tokens: number; costUsd: number; cacheHitRate: number; p95Ms: number }[];
  topJobs: { jobId: string; name: string | null; status: string; costUsd: number; tokens: number; agents: number; durationMs: number }[];
  recentErrors: { ts: number; jobId: string; pid: string | null; kind: "failed" | "denied" | "crash"; what: string; error: string }[];
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

/** Which jobs a viewer may see. Undefined means all. */
export type JobFilter = ((jobId: string) => boolean) | undefined;

const only = <T extends { jobId: string }>(rows: T[], canSee: JobFilter): T[] => (canSee ? rows.filter((r) => canSee(r.jobId)) : rows);

function totalsFor(repo: MetricsRepo, from: number, to: number, canSee: JobFilter): Totals {
  return summarize(
    only(repo.llmCalls(from, to), canSee),
    only(repo.syscalls(from, to), canSee),
    only(repo.terminalStates(from, to), canSee),
    only(repo.crashes(from, to), canSee).length,
  );
}

function summarize(
  calls: ReturnType<MetricsRepo["llmCalls"]>,
  sys: ReturnType<MetricsRepo["syscalls"]>,
  states: ReturnType<MetricsRepo["terminalStates"]>,
  crashes: number,
): Totals {
  const input = calls.reduce((n, c) => n + c.input, 0);
  const cached = calls.reduce((n, c) => n + c.cacheRead, 0);
  const lat = calls.map((c) => c.durationMs).sort((a, b) => a - b);
  const failed = sys.filter((s) => !s.ok && !s.denied).length;
  const denials = sys.filter((s) => s.denied).length;
  return {
    llmCalls: calls.length,
    inputTokens: input,
    cachedTokens: cached,
    outputTokens: calls.reduce((n, c) => n + c.output, 0),
    costUsd: calls.reduce((n, c) => n + c.cost, 0),
    savingsUsd: calls.reduce((n, c) => n + c.savings, 0),
    cacheHitRate: input ? cached / input : 0,
    p50Ms: percentile(lat, 50),
    p95Ms: percentile(lat, 95),
    syscalls: sys.length,
    failedSyscalls: failed,
    denials,
    crashes,
    errorRate: sys.length ? (failed + denials) / sys.length : 0,
    agentsFinished: states.filter((s) => s.to === "TERMINATED").length,
    agentsFailed: states.filter((s) => s.to === "FAILED").length,
  };
}

export function buildMetrics(repo: MetricsRepo, range: RangeKey, now: number, canSee?: JobFilter): Metrics {
  const span = RANGES[range];
  const bucketMs = span / BUCKETS;
  // Align the window to bucket edges so buckets don't shift between refreshes.
  const to = Math.ceil(now / bucketMs) * bucketMs;
  const from = to - span;

  const calls = only(repo.llmCalls(from, to), canSee);
  const sys = only(repo.syscalls(from, to), canSee);
  const states = only(repo.terminalStates(from, to), canSee);
  const crashes = only(repo.crashes(from, to), canSee);

  const typeCounts = new Map<string, number>();
  for (const s of sys) typeCounts.set(s.type, (typeCounts.get(s.type) ?? 0) + 1);
  const ranked = [...typeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const named = new Set(ranked.slice(0, TOP_SYSCALLS));
  const syscallTypes = [...ranked.slice(0, TOP_SYSCALLS), ...(ranked.length > TOP_SYSCALLS ? ["Other"] : [])];
  const seriesOf = (type: string) => (named.has(type) ? type : "Other");

  const buckets: Bucket[] = Array.from({ length: BUCKETS }, (_, i) => ({
    t: from + i * bucketMs,
    llmCalls: 0,
    uncachedInput: 0,
    cachedInput: 0,
    outputTokens: 0,
    costUsd: 0,
    savingsUsd: 0,
    p50Ms: 0,
    p95Ms: 0,
    syscalls: Object.fromEntries(syscallTypes.map((t) => [t, 0])),
    failedSyscalls: 0,
    denials: 0,
    crashes: 0,
    agentsFinished: 0,
    agentsFailed: 0,
  }));
  const at = (ts: number) => buckets[Math.min(BUCKETS - 1, Math.max(0, Math.floor((ts - from) / bucketMs)))]!;

  const lat: number[][] = buckets.map(() => []);
  for (const c of calls) {
    const b = at(c.ts);
    b.llmCalls++;
    b.cachedInput += c.cacheRead;
    b.uncachedInput += Math.max(0, c.input - c.cacheRead);
    b.outputTokens += c.output;
    b.costUsd += c.cost;
    b.savingsUsd += c.savings;
    lat[buckets.indexOf(b)]!.push(c.durationMs);
  }
  buckets.forEach((b, i) => {
    const l = lat[i]!.sort((x, y) => x - y);
    b.p50Ms = percentile(l, 50);
    b.p95Ms = percentile(l, 95);
  });
  for (const s of sys) {
    const b = at(s.ts);
    b.syscalls[seriesOf(s.type)]!++;
    if (s.denied) b.denials++;
    else if (!s.ok) b.failedSyscalls++;
  }
  for (const c of crashes) at(c.ts).crashes++;
  for (const s of states) {
    if (s.to === "TERMINATED") at(s.ts).agentsFinished++;
    else at(s.ts).agentsFailed++;
  }

  // By model.
  const models = new Map<string, typeof calls>();
  for (const c of calls) models.set(c.model, [...(models.get(c.model) ?? []), c]);
  const byModel = [...models.entries()]
    .map(([model, cs]) => {
      const input = cs.reduce((n, c) => n + c.input, 0);
      return {
        model,
        calls: cs.length,
        tokens: cs.reduce((n, c) => n + c.input + c.output, 0),
        costUsd: cs.reduce((n, c) => n + c.cost, 0),
        cacheHitRate: input ? cs.reduce((n, c) => n + c.cacheRead, 0) / input : 0,
        p95Ms: percentile(cs.map((c) => c.durationMs).sort((a, b) => a - b), 95),
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);

  // Top jobs by cost.
  const perJob = new Map<string, { cost: number; tokens: number; pids: Set<string>; last: number }>();
  for (const c of calls) {
    const j = perJob.get(c.jobId) ?? { cost: 0, tokens: 0, pids: new Set<string>(), last: 0 };
    j.cost += c.cost;
    j.tokens += c.input + c.output;
    if (c.pid) j.pids.add(c.pid);
    j.last = Math.max(j.last, c.ts);
    perJob.set(c.jobId, j);
  }
  const top = [...perJob.entries()].sort((a, b) => b[1].cost - a[1].cost || b[1].tokens - a[1].tokens).slice(0, 10);
  const jobInfo = new Map(repo.jobs(top.map(([id]) => id)).map((j) => [j.id, j]));
  const topJobs = top.map(([jobId, j]) => {
    const info = jobInfo.get(jobId);
    return {
      jobId,
      name: info?.name ?? null,
      status: info?.status ?? "?",
      costUsd: j.cost,
      tokens: j.tokens,
      agents: j.pids.size,
      durationMs: info ? Math.max(0, j.last - info.createdAt) : 0,
    };
  });

  const recentErrors = [
    ...sys
      .filter((s) => !s.ok)
      .map((s) => ({ ts: s.ts, jobId: s.jobId, pid: s.pid, kind: (s.denied ? "denied" : "failed") as "denied" | "failed", what: s.type, error: s.error ?? s.code ?? "" })),
    ...crashes.map((c) => ({ ts: c.ts, jobId: c.jobId, pid: c.pid, kind: "crash" as const, what: "process", error: c.error ?? "" })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 25);

  return {
    range,
    from,
    to,
    bucketMs,
    buckets,
    syscallTypes,
    totals: summarize(calls, sys, states, crashes.length),
    previous: totalsFor(repo, from - span, from, canSee),
    byModel,
    topJobs,
    recentErrors,
  };
}
