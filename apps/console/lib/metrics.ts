"use client";
// Dashboard metrics from GET /metrics. Shapes mirror apps/api/metrics.ts.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export const RANGES = ["15m", "1h", "6h", "24h", "7d"] as const;
export type Range = (typeof RANGES)[number];

export interface Totals {
  llmCalls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  savingsUsd: number;
  cacheHitRate: number;
  p50Ms: number;
  p95Ms: number;
  syscalls: number;
  failedSyscalls: number;
  denials: number;
  crashes: number;
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
  syscalls: Record<string, number>;
  failedSyscalls: number;
  denials: number;
  crashes: number;
  agentsFinished: number;
  agentsFailed: number;
}

export interface Metrics {
  range: Range;
  from: number;
  to: number;
  bucketMs: number;
  buckets: Bucket[];
  syscallTypes: string[];
  totals: Totals;
  previous: Totals;
  byModel: { model: string; calls: number; tokens: number; costUsd: number; cacheHitRate: number; p95Ms: number }[];
  topJobs: { jobId: string; name: string | null; status: string; costUsd: number; tokens: number; agents: number; durationMs: number }[];
  recentErrors: { ts: number; jobId: string; pid: string | null; kind: "failed" | "denied" | "crash"; what: string; error: string }[];
  now: { states: Record<string, number>; running: number; queueDepth: number; maxConcurrency: number };
}

/**
 * Fetch metrics for a range and, when live, refetch on an interval: 10s for ranges up to
 * an hour, 60s beyond. The previous data stays while a refetch runs, so charts keep their frame.
 */
export function useMetrics(range: Range, live: boolean) {
  const [data, setData] = useState<Metrics>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const seq = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const load = async () => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const m = await api.metrics(range);
        if (mine !== seq.current) return;
        setData(m);
        setError(undefined);
        setUpdatedAt(Date.now());
      } catch (err) {
        if (mine === seq.current) setError((err as Error).message);
      } finally {
        if (mine === seq.current) setLoading(false);
        if (!stopped && live) timer = setTimeout(load, range === "15m" || range === "1h" ? 10_000 : 60_000);
      }
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [range, live]);

  return { data, error, loading, updatedAt };
}

// ---------- formatting ----------

export const fmtUsd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : n < 100 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString()}`);
export const fmtCount = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : Math.round(n).toLocaleString();
export const fmtPct = (r: number) => `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`;
export const fmtMs = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
