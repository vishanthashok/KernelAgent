"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { STATE_FILL } from "@/lib/format";
import { fmtCount, fmtMs, fmtPct, fmtUsd, RANGES, useMetrics, type Bucket, type Metrics, type Range, type Totals } from "@/lib/metrics";
import { ChartCard, timeLabel, type Series } from "./TimeChart";

// A syscall type keeps its slot whatever else is on screen. Slots follow the validated order.
const SYSCALL_SLOT: Record<string, number> = { EXEC: 1, FS_WRITE: 2, FS_READ: 3, EXIT: 4, SPAWN: 5, SEND: 6, RECEIVE: 7, SLEEP: 8 };
const OTHER_COLOR = "rgba(255,255,255,0.35)";

/** Colors for the shown syscall types: fixed slots first, then the lowest free slot for the rest. */
function syscallColors(types: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<number>();
  for (const t of types) if (SYSCALL_SLOT[t]) used.add(SYSCALL_SLOT[t]!);
  for (const t of types) {
    if (t === "Other") out[t] = OTHER_COLOR;
    else if (SYSCALL_SLOT[t]) out[t] = `var(--series-${SYSCALL_SLOT[t]})`;
    else {
      const free = [1, 2, 3, 4, 5, 6, 7, 8].find((s) => !used.has(s)) ?? 1;
      used.add(free);
      out[t] = `var(--series-${free})`;
    }
  }
  return out;
}

const STATES = ["RUNNING", "READY", "WAITING", "NEW", "TERMINATED", "FAILED"] as const;

function delta(cur: number, prev: number): { text: string; dir: "up" | "down" | "flat" } {
  if (prev === 0 && cur === 0) return { text: "no change", dir: "flat" };
  if (prev === 0) return { text: "new in this range", dir: "up" };
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return { text: "flat", dir: "flat" };
  return { text: `${Math.abs(pct) >= 100 ? Math.round(pct) : pct.toFixed(1)}%`, dir: pct > 0 ? "up" : "down" };
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1e-9, ...values);
  const w = 120;
  const h = 28;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      <polyline fill="none" stroke="var(--series-1)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

function StatTile({
  label,
  value,
  cur,
  prev,
  spark,
  goodWhenUp,
}: {
  label: string;
  value: string;
  cur: number;
  prev: number;
  spark: number[];
  /** Whether a rise is good news. Stated in words, never by color alone. */
  goodWhenUp: boolean;
}) {
  const d = delta(cur, prev);
  const arrow = d.dir === "up" ? "▲" : d.dir === "down" ? "▼" : "–";
  const good = d.dir === "flat" ? undefined : (d.dir === "up") === goodWhenUp;
  return (
    <div className="card flex min-w-0 flex-col px-4 pt-3.5 pb-2">
      <div className="label-caps truncate">{label}</div>
      <div className="mt-1.5 truncate text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-term-dim" title="Compared with the previous window of the same length">
        <span className="text-term-fg/80">
          {arrow} {d.text}
        </span>
        {good !== undefined && <span> · {good ? "better" : "worse"}</span>}
      </div>
      <div className="mt-1.5">
        <Sparkline values={spark} />
      </div>
    </div>
  );
}

function StateBar({ now }: { now: Metrics["now"] }) {
  const total = STATES.reduce((n, s) => n + (now.states[s] ?? 0), 0);
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="text-[15px] font-semibold tracking-tight">Processes right now</h3>
        <span className="font-mono text-xs text-term-dim tabular-nums">
          {now.running}/{now.maxConcurrency} slots · queue {now.queueDepth} · {total} total
        </span>
      </div>
      {total === 0 ? (
        <div className="h-3 rounded-full bg-white/5" />
      ) : (
        <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
          {STATES.map((s) =>
            now.states[s] ? (
              <div key={s} title={`${s.toLowerCase()}: ${now.states[s]}`} style={{ flexGrow: now.states[s], background: STATE_FILL[s] }} />
            ) : null,
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {STATES.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-term-dim">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: STATE_FILL[s] }} />
            {s.toLowerCase()}
            <span className="font-mono text-term-fg tabular-nums">{now.states[s] ?? 0}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-normal ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

function TableCard({ title, subtitle, children, empty }: { title: string; subtitle?: string; children: React.ReactNode; empty: boolean }) {
  return (
    <section className="card flex min-w-0 flex-col">
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-term-dim">{subtitle}</p>}
      </div>
      {empty ? <div className="px-5 pb-6 text-xs text-term-dim">Nothing in this range.</div> : <div className="overflow-x-auto pb-2">{children}</div>}
    </section>
  );
}

const col = (bs: Bucket[], f: (b: Bucket) => number) => bs.map(f);

export function Dashboard() {
  const [range, setRange] = useState<Range>("1h");
  const [live, setLive] = useState(true);

  // Range lives in the URL so a view can be shared.
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("range");
    if (r && (RANGES as readonly string[]).includes(r)) setRange(r as Range);
  }, []);
  const pick = (r: Range) => {
    setRange(r);
    const u = new URL(window.location.href);
    u.searchParams.set("range", r);
    window.history.replaceState(null, "", u);
  };

  const { data: m, error, loading, updatedAt } = useMetrics(range, live);
  const b = m?.buckets ?? [];
  const times = b.map((x) => x.t);
  const T: Totals | undefined = m?.totals;
  const P: Totals | undefined = m?.previous;
  const dim = loading && !!m;

  const sysColors = syscallColors(m?.syscallTypes ?? []);
  const syscallSeries: Series[] = (m?.syscallTypes ?? []).map((t) => ({
    key: t,
    label: t,
    color: sysColors[t]!,
    values: col(b, (x) => x.syscalls[t] ?? 0),
  }));

  return (
    <div className="mx-auto max-w-[1520px] px-4 pb-16 md:px-8">
      <nav className="sticky top-4 z-20 mt-4 flex items-center gap-4 rounded-2xl bg-white/90 px-4 py-3 text-neutral-600 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-5">
          <Link href="/" className="font-mono text-[11px] tracking-[0.22em] text-neutral-500 uppercase hover:text-neutral-900">
            Chat
          </Link>
          <Link href="/console" className="font-mono text-[11px] tracking-[0.22em] text-neutral-500 uppercase hover:text-neutral-900">
            Console
          </Link>
          <span className="font-mono text-[11px] tracking-[0.22em] text-neutral-950 uppercase">Dashboard</span>
        </div>
        <span className="hidden shrink-0 font-mono text-sm font-semibold tracking-[0.35em] text-neutral-950 sm:block">KERNELAGENT</span>
        <div className="flex flex-1 items-center justify-end gap-2 font-mono text-[11px] tracking-[0.2em] uppercase">
          <span className={`h-2 w-2 rounded-full ${error ? "bg-red-500" : "bg-emerald-500"}`} />
          <span className="hidden sm:inline">{error ? "offline" : live ? "live" : "paused"}</span>
        </div>
      </nav>

      <header className="mt-12 mb-6 md:mt-16">
        <div className="label-caps mb-3">Agent kernel · metrics</div>
        <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">Dashboard</h1>
        <p className="mt-3 max-w-2xl text-term-dim">Spend, tokens, latency, and failures across every agent, from the kernel&apos;s event log.</p>
      </header>

      {/* Filters: one row, above everything they scope. */}
      <div className="sticky top-[76px] z-10 -mx-1 mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-[#0b0e12]/80 px-1 py-2 backdrop-blur">
        <div className="flex rounded-full border border-white/15 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => pick(r)}
              className={`rounded-full px-3.5 py-1 font-mono text-xs transition-colors ${range === r ? "bg-white text-black" : "text-term-dim hover:bg-white/10 hover:text-term-fg"}`}
            >
              {r}
            </button>
          ))}
        </div>
        <button onClick={() => setLive(!live)} className={`pill px-3.5 py-1 text-xs ${live ? "pill-light" : "pill-ghost"}`}>
          {live ? "● Live" : "Paused"}
        </button>
        <span className="ml-auto font-mono text-[11px] text-term-dim">
          {error ? <span className="text-red-300">{error}</span> : updatedAt ? `updated ${new Date(updatedAt).toLocaleTimeString([], { hour12: false })}` : "loading…"}
          {m && ` · ${timeLabel(m.from, m.to - m.from)} → ${timeLabel(m.to, m.to - m.from)} · ${fmtMs(m.bucketMs)} buckets`}
        </span>
      </div>

      {!m ? (
        <div className="card p-10 text-center text-term-dim">{error ? "Can't load metrics." : "Loading metrics…"}</div>
      ) : (
        <div className={`space-y-4 transition-opacity ${dim ? "opacity-80" : ""}`}>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <StatTile label="Cost" value={fmtUsd(T!.costUsd)} cur={T!.costUsd} prev={P!.costUsd} spark={col(b, (x) => x.costUsd)} goodWhenUp={false} />
            <StatTile
              label="Tokens"
              value={fmtCount(T!.inputTokens + T!.outputTokens)}
              cur={T!.inputTokens + T!.outputTokens}
              prev={P!.inputTokens + P!.outputTokens}
              spark={col(b, (x) => x.uncachedInput + x.cachedInput + x.outputTokens)}
              goodWhenUp={false}
            />
            <StatTile label="LLM calls" value={fmtCount(T!.llmCalls)} cur={T!.llmCalls} prev={P!.llmCalls} spark={col(b, (x) => x.llmCalls)} goodWhenUp={false} />
            <StatTile
              label="Cache hit"
              value={fmtPct(T!.cacheHitRate)}
              cur={T!.cacheHitRate}
              prev={P!.cacheHitRate}
              spark={col(b, (x) => (x.cachedInput + x.uncachedInput ? x.cachedInput / (x.cachedInput + x.uncachedInput) : 0))}
              goodWhenUp
            />
            <StatTile label="Saved by cache" value={fmtUsd(T!.savingsUsd)} cur={T!.savingsUsd} prev={P!.savingsUsd} spark={col(b, (x) => x.savingsUsd)} goodWhenUp />
            <StatTile label="p95 latency" value={T!.llmCalls ? fmtMs(T!.p95Ms) : "–"} cur={T!.p95Ms} prev={P!.p95Ms} spark={col(b, (x) => x.p95Ms)} goodWhenUp={false} />
            <StatTile
              label="Error rate"
              value={T!.syscalls ? fmtPct(T!.errorRate) : "–"}
              cur={T!.errorRate}
              prev={P!.errorRate}
              spark={col(b, (x) => x.failedSyscalls + x.denials)}
              goodWhenUp={false}
            />
            <StatTile label="Agents failed" value={fmtCount(T!.agentsFailed)} cur={T!.agentsFailed} prev={P!.agentsFailed} spark={col(b, (x) => x.agentsFailed)} goodWhenUp={false} />
          </section>

          <StateBar now={m.now} />

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Tokens"
              subtitle="Input read from the prompt cache costs a tenth of uncached input."
              times={times}
              bucketMs={m.bucketMs}
              kind="stacked"
              format={fmtCount}
              dim={dim}
              series={[
                { key: "uncached", label: "Uncached input", color: "var(--series-1)", values: col(b, (x) => x.uncachedInput) },
                { key: "cached", label: "Cached input", color: "var(--series-2)", values: col(b, (x) => x.cachedInput) },
                { key: "output", label: "Output", color: "var(--series-3)", values: col(b, (x) => x.outputTokens) },
              ]}
            />
            <ChartCard
              title="Cost per interval"
              subtitle={`Total ${fmtUsd(T!.costUsd)}, of which prompt caching saved ${fmtUsd(T!.savingsUsd)}.`}
              times={times}
              bucketMs={m.bucketMs}
              kind="stacked"
              format={fmtUsd}
              dim={dim}
              series={[{ key: "cost", label: "Cost", color: "var(--series-1)", values: col(b, (x) => x.costUsd) }]}
            />
            <ChartCard
              title="Model latency"
              subtitle="Time per model call, including rate-limit waits."
              times={times}
              bucketMs={m.bucketMs}
              kind="lines"
              format={fmtMs}
              dim={dim}
              series={[
                { key: "p50", label: "p50", color: "var(--series-1)", values: col(b, (x) => (x.llmCalls ? x.p50Ms : NaN)) },
                { key: "p95", label: "p95", color: "var(--series-2)", values: col(b, (x) => (x.llmCalls ? x.p95Ms : NaN)) },
              ]}
            />
            <ChartCard
              title="Syscalls by type"
              subtitle="Every tool call an agent made, after capability checks."
              times={times}
              bucketMs={m.bucketMs}
              kind="stacked"
              format={fmtCount}
              dim={dim}
              series={syscallSeries}
            />
            <ChartCard
              title="Errors"
              subtitle="Failed syscalls, capability denials, and process crashes."
              times={times}
              bucketMs={m.bucketMs}
              kind="stacked"
              format={fmtCount}
              dim={dim}
              series={[
                { key: "failed", label: "Failed syscalls", color: "var(--status-serious)", values: col(b, (x) => x.failedSyscalls) },
                { key: "denied", label: "Denied", color: "var(--status-warning)", values: col(b, (x) => x.denials) },
                { key: "crash", label: "Crashes", color: "var(--status-critical)", values: col(b, (x) => x.crashes) },
              ]}
            />
            <ChartCard
              title="Agent outcomes"
              subtitle="Agents that finished or failed. A retried agent can fail more than once."
              times={times}
              bucketMs={m.bucketMs}
              kind="stacked"
              format={fmtCount}
              dim={dim}
              series={[
                { key: "done", label: "Finished", color: "var(--status-good)", values: col(b, (x) => x.agentsFinished) },
                { key: "failed", label: "Failed", color: "var(--status-critical)", values: col(b, (x) => x.agentsFailed) },
              ]}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <TableCard title="By model" subtitle="Spend and cache use per model in this range." empty={m.byModel.length === 0}>
              <table className="w-full text-xs tabular-nums">
                <thead className="text-term-dim">
                  <tr>
                    <Th>Model</Th>
                    <Th right>Calls</Th>
                    <Th right>Tokens</Th>
                    <Th right>Cost</Th>
                    <Th right>Cache hit</Th>
                    <Th right>p95</Th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {m.byModel.map((r) => (
                    <tr key={r.model} className="border-t border-white/5">
                      <td className="px-3 py-2 text-term-fg">{r.model}</td>
                      <td className="px-3 py-2 text-right">{fmtCount(r.calls)}</td>
                      <td className="px-3 py-2 text-right">{fmtCount(r.tokens)}</td>
                      <td className="px-3 py-2 text-right">{fmtUsd(r.costUsd)}</td>
                      <td className="px-3 py-2 text-right">{fmtPct(r.cacheHitRate)}</td>
                      <td className="px-3 py-2 text-right">{fmtMs(r.p95Ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>

            <TableCard title="Most expensive jobs" subtitle="Open one in the console to replay it." empty={m.topJobs.length === 0}>
              <table className="w-full text-xs tabular-nums">
                <thead className="text-term-dim">
                  <tr>
                    <Th>Job</Th>
                    <Th>Status</Th>
                    <Th right>Agents</Th>
                    <Th right>Tokens</Th>
                    <Th right>Cost</Th>
                    <Th right>Duration</Th>
                  </tr>
                </thead>
                <tbody>
                  {m.topJobs.map((j) => (
                    <tr key={j.jobId} className="border-t border-white/5">
                      <td className="max-w-[260px] px-3 py-2">
                        <Link href={`/console?job=${encodeURIComponent(j.jobId)}`} className="block truncate hover:underline">
                          {j.name || j.jobId}
                        </Link>
                        <span className="font-mono text-[10px] text-term-dim">{j.jobId}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: j.status === "COMPLETED" ? "var(--status-good)" : j.status === "FAILED" ? "var(--status-critical)" : "var(--status-warning)" }}
                          />
                          {j.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{j.agents}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtCount(j.tokens)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtUsd(j.costUsd)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtMs(j.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          </div>

          <TableCard title="Recent errors" subtitle="The latest 25 failed or denied syscalls and crashes." empty={m.recentErrors.length === 0}>
            <table className="w-full text-xs">
              <thead className="text-term-dim">
                <tr>
                  <Th>Time</Th>
                  <Th>Kind</Th>
                  <Th>Where</Th>
                  <Th>Message</Th>
                </tr>
              </thead>
              <tbody>
                {m.recentErrors.map((e, i) => (
                  <tr key={`${e.ts}-${i}`} className="border-t border-white/5 align-top">
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-term-dim tabular-nums">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: e.kind === "crash" ? "var(--status-critical)" : e.kind === "denied" ? "var(--status-warning)" : "var(--status-serious)" }}
                        />
                        {e.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      <Link href={`/console?job=${encodeURIComponent(e.jobId)}`} className="hover:underline">
                        {e.what}
                        {e.pid ? ` · pid ${e.pid}` : ""}
                      </Link>
                    </td>
                    <td className="px-3 py-2 break-words text-term-dim">{e.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </div>
      )}
    </div>
  );
}
