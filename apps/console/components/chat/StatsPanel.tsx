"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type MemoryEntry } from "@/lib/api";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import type { KernelState } from "@/lib/useKernel";
import { useNow } from "@/lib/useKernel";
import type { ResolvedModel } from "@/lib/useModels";
import { clock, describe, hhmmss, STATE_COLOR, STATE_FILL } from "@/lib/format";

const BUCKETS = 20;
const BUCKET_MS = 30_000;

interface LlmCall {
  jobId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cacheReadTokens: number;
  cacheSavingsUsd: number;
  durationMs: number;
  timestamp: number;
}

const usd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/10 px-5 py-4">
      <div className="mb-3 flex items-center">
        <span className="label-caps">{title}</span>
        {right !== undefined && <span className="ml-auto font-mono text-[11px] text-term-dim">{right}</span>}
      </div>
      {children}
    </section>
  );
}

function Gauge({ label, value, sub }: { label: string; value: number; sub: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const color = pct > 85 ? "#f87171" : pct > 60 ? "#fbbf24" : "#34d399";
  return (
    <div>
      <div className="flex items-baseline text-xs">
        <span className="text-term-dim">{label}</span>
        <span className="ml-auto font-mono">{sub}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="text-[11px] text-term-dim">{label}</div>
      <div className="mt-0.5 font-mono text-[15px]">{value}</div>
    </div>
  );
}

/** Stacked bars of input and output tokens per 30s over the last 10 minutes. */
function Throughput({ calls, end }: { calls: LlmCall[]; end: number }) {
  const start = end - BUCKETS * BUCKET_MS;
  const buckets = Array.from({ length: BUCKETS }, () => ({ in: 0, out: 0 }));
  for (const c of calls) {
    if (c.timestamp < start || c.timestamp > end) continue;
    const i = Math.min(BUCKETS - 1, Math.floor((c.timestamp - start) / BUCKET_MS));
    buckets[i]!.in += c.inputTokens;
    buckets[i]!.out += c.outputTokens;
  }
  const max = Math.max(1, ...buckets.map((b) => b.in + b.out));
  const W = 280;
  const H = 72;
  const bw = W / BUCKETS;
  const total = buckets.reduce((n, b) => n + b.in + b.out, 0);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[72px] w-full" preserveAspectRatio="none" role="img" aria-label="Tokens per 30 seconds">
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - f * H + 0.5} y2={H - f * H + 0.5} stroke="rgba(255,255,255,0.06)" />
        ))}
        {buckets.map((b, i) => {
          const hIn = (b.in / max) * (H - 2);
          const hOut = (b.out / max) * (H - 2);
          const x = i * bw + 1;
          return (
            <g key={i}>
              <rect x={x} width={bw - 2} y={H - hIn} height={hIn} rx={1.5} fill="#5b8def" opacity={0.85} />
              <rect x={x} width={bw - 2} y={H - hIn - hOut} height={hOut} rx={1.5} fill="#b9d4ff" />
            </g>
          );
        })}
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="rgba(255,255,255,0.15)" />
      </svg>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-term-dim">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[#5b8def]" /> input
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[#b9d4ff]" /> output
        </span>
        <span className="ml-auto font-mono">{compact(total)} in 10 min</span>
      </div>
    </div>
  );
}

function AgentRow({ p }: { p: ReplayedProcess }) {
  const used = p.tokenBudget > 0 ? Math.min(1, p.tokensUsed / p.tokenBudget) : 0;
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATE_FILL[p.status] }} />
        <span className="font-mono text-term-accent">{p.pid}</span>
        <span className="min-w-0 flex-1 truncate">{p.role}</span>
        <span className={`font-mono text-[10px] ${STATE_COLOR[p.status]}`}>{p.status.toLowerCase()}</span>
      </div>
      <div className="mt-1 ml-4 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-term-accent/70" style={{ width: `${used * 100}%` }} />
        </div>
        <span className="font-mono text-[10px] text-term-dim">
          {compact(p.tokensUsed)}/{compact(p.tokenBudget)}
        </span>
      </div>
    </div>
  );
}

/** Live numbers for the chat: kernel load, token flow, spend, and the agents of the current job. */
export function StatsPanel({
  k,
  jobIds,
  currentJobId,
  model,
  chatId,
  onClose,
}: {
  k: KernelState;
  /** Jobs that belong to the open chat. */
  jobIds: string[];
  currentJobId?: string | undefined;
  model?: ResolvedModel | undefined;
  /** The open chat, whose memory to show. */
  chatId?: string | undefined;
  onClose: () => void;
}) {
  const now = useNow(1000);
  const s = k.stats;
  const jobs = useMemo(() => new Set(jobIds), [jobIds]);

  const calls = useMemo(
    () =>
      k.events
        .filter((e) => e.type === "LLM_CALL")
        .map((e) => {
          const p = e.payload as Record<string, unknown>;
          return {
            jobId: e.jobId,
            model: String(p.model ?? "?"),
            inputTokens: Number(p.inputTokens ?? 0),
            outputTokens: Number(p.outputTokens ?? 0),
            costUsd: Number(p.costUsd ?? 0),
            cacheReadTokens: Number(p.cacheReadTokens ?? 0),
            cacheSavingsUsd: Number(p.cacheSavingsUsd ?? 0),
            durationMs: Number(p.durationMs ?? 0),
            timestamp: e.timestamp,
          } satisfies LlmCall;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k.version],
  );
  const chatCalls = calls.filter((c) => jobs.has(c.jobId));
  const chatTokens = chatCalls.reduce((n, c) => n + c.inputTokens + c.outputTokens, 0);
  const chatCost = chatCalls.reduce((n, c) => n + c.costUsd, 0);
  const chatInput = chatCalls.reduce((n, c) => n + c.inputTokens, 0);
  const chatCached = chatCalls.reduce((n, c) => n + c.cacheReadTokens, 0);
  const chatSaved = chatCalls.reduce((n, c) => n + c.cacheSavingsUsd, 0);
  const avgLatency = chatCalls.length ? chatCalls.reduce((n, c) => n + c.durationMs, 0) / chatCalls.length : 0;
  const files = k.artifacts.filter((a) => jobs.has(a.jobId)).length;
  const agents = [...k.processes.values()].filter((p) => jobs.has(p.jobId));

  const byModel = new Map<string, { tokens: number; cost: number }>();
  for (const c of chatCalls) {
    const m = byModel.get(c.model) ?? { tokens: 0, cost: 0 };
    m.tokens += c.inputTokens + c.outputTokens;
    m.cost += c.costUsd;
    byModel.set(c.model, m);
  }
  const modelRows = [...byModel.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
  const maxModel = Math.max(1, ...modelRows.map(([, m]) => m.tokens));

  const current = currentJobId ? agents.filter((p) => p.jobId === currentJobId).sort((a, b) => Number(a.pid) - Number(b.pid)) : [];
  const recent = k.events.filter((e) => jobs.has(e.jobId) && e.type !== "PROCESS_SCHEDULED").slice(-6).reverse();
  const end = Math.max(now, calls[calls.length - 1]?.timestamp ?? 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3.5">
        <span className={`h-2 w-2 rounded-full ${k.connected ? "bg-emerald-400" : "bg-red-400"}`} />
        <span className="text-sm font-medium">{k.connected ? "Live" : "Offline"}</span>
        <span className="font-mono text-[11px] text-term-dim">{s ? `up ${hhmmss(now - s.bootedAt)}` : ""}</span>
        <button onClick={onClose} className="ml-auto rounded-md px-2 py-0.5 text-term-dim hover:bg-white/10 hover:text-term-fg" aria-label="Hide stats">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Model" right={model?.isDefault ? "API default" : "picked"}>
          <div className="text-lg font-semibold tracking-tight">{model?.name ?? s?.model ?? "…"}</div>
          {model && model.name !== model.id && <div className="mt-0.5 font-mono text-[11px] text-term-dim">{model.id}</div>}
        </Section>

        <Section title="Kernel" right={s ? `${s.provider} · ${s.sandbox ?? "no sandbox"}` : "…"}>
          <div className="space-y-3">
            <Gauge label="Agent slots" value={s ? s.running / Math.max(1, s.maxConcurrency) : 0} sub={s ? `${s.running} / ${s.maxConcurrency}` : "…"} />
            <Gauge label="Rate limit, requests" value={s?.rateLimiter.requests ?? 0} sub={s ? `${Math.round(s.rateLimiter.requests * 100)}%` : "…"} />
            <Gauge label="Rate limit, tokens" value={s?.rateLimiter.tokens ?? 0} sub={s ? `${Math.round(s.rateLimiter.tokens * 100)}%` : "…"} />
          </div>
          <div className="mt-3 flex gap-4 font-mono text-[11px] text-term-dim">
            <span>queue {s?.queueDepth ?? "…"}</span>
            <span>seq {k.lastSequence}</span>
          </div>
        </Section>

        <Section title="Token flow" right="30s buckets">
          <Throughput calls={calls} end={end} />
        </Section>

        <Section title="This chat">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Tokens" value={compact(chatTokens)} />
            <Metric label="Cost" value={usd(chatCost)} />
            <Metric label="Model calls" value={chatCalls.length} />
            <Metric label="Avg latency" value={avgLatency ? `${(avgLatency / 1000).toFixed(1)}s` : "–"} />
            <Metric label="Cache hits" value={chatInput ? `${Math.round((chatCached / chatInput) * 100)}%` : "–"} />
            <Metric label="Saved by cache" value={<span className="text-emerald-300">{usd(chatSaved)}</span>} />
            <Metric label="Agents" value={agents.length} />
            <Metric label="Files" value={files} />
          </div>
        </Section>

        {modelRows.length > 0 && (
          <Section title="By model">
            <div className="space-y-2.5">
              {modelRows.map(([model, m]) => (
                <div key={model}>
                  <div className="flex text-xs">
                    <span className="min-w-0 flex-1 truncate font-mono">{model}</span>
                    <span className="font-mono text-term-dim">
                      {compact(m.tokens)} · {usd(m.cost)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[#b9d4ff]" style={{ width: `${(m.tokens / maxModel) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {chatId && <MemorySection k={k} chatId={chatId} jobs={jobs} />}

        {current.length > 0 && (
          <Section title="Current job" right={currentJobId}>
            {current.map((p) => (
              <AgentRow key={p.pid} p={p} />
            ))}
          </Section>
        )}

        <Section title="Activity">
          {recent.length === 0 ? (
            <div className="text-xs text-term-dim">Send a message to see events here.</div>
          ) : (
            <ul className="space-y-1.5">
              {recent.map((e) => (
                <li key={e.sequence} className="text-xs">
                  <span className="font-mono text-[10px] text-term-dim">{clock(e.timestamp)}</span>{" "}
                  {e.pid && <span className="font-mono text-term-accent">{e.pid}</span>}{" "}
                  <span className="text-term-dim">{describe(e)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

/** The open chat's shared memory: what every agent sees at start. */
function MemorySection({ k, chatId, jobs }: { k: KernelState; chatId: string; jobs: Set<string> }) {
  const [data, setData] = useState<{ count: number; entries: MemoryEntry[] }>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);

  // Memory changes when an agent calls REMEMBER or a top-level agent exits.
  const trigger = useMemo(
    () =>
      k.events.filter(
        (e) =>
          jobs.has(e.jobId) &&
          (e.type === "PROCESS_EXIT" || (e.type === "SYSCALL" && (e.payload as { request?: { type?: string } }).request?.type === "REMEMBER")),
      ).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k.version, jobs],
  );

  const load = () =>
    api
      .memory(chatId)
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, trigger]);

  const entries = data ? [...data.entries].reverse() : [];
  const shown = open ? entries : entries.slice(0, 4);

  return (
    <Section title="Memory" right={data ? `${data.count} ${data.count === 1 ? "entry" : "entries"}` : "…"}>
      {error ? (
        <div className="text-xs text-red-300">{error}</div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-term-dim">Empty. Answers and notes agents save land here, and every agent in this chat reads them.</div>
      ) : (
        <ul className="space-y-2">
          {shown.map((m) => (
            <li key={m.id} className="group rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
              <div className="mb-1 flex items-center gap-2">
                <span className={`font-mono text-[10px] uppercase ${m.kind === "note" ? "text-emerald-300" : "text-term-accent"}`}>{m.kind}</span>
                {m.pid && <span className="font-mono text-[10px] text-term-dim">pid {m.pid}</span>}
                <button
                  onClick={() => void api.deleteMemory(m.id).then(load)}
                  className="ml-auto text-term-dim opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-300"
                  title="Forget this"
                >
                  ✕
                </button>
              </div>
              <div className="line-clamp-4 whitespace-pre-wrap text-term-fg/90">{m.content}</div>
            </li>
          ))}
        </ul>
      )}
      {entries.length > 0 && (
        <div className="mt-3 flex items-center gap-3 text-xs">
          {entries.length > 4 && (
            <button onClick={() => setOpen(!open)} className="text-term-dim hover:text-term-fg">
              {open ? "Show less" : `Show all ${entries.length}`}
            </button>
          )}
          <button
            onClick={() => {
              if (confirm("Clear this chat's memory? Agents will lose the context of earlier messages.")) void api.clearMemory(chatId).then(load);
            }}
            className="ml-auto text-term-dim hover:text-red-300"
          >
            Clear memory
          </button>
        </div>
      )}
    </Section>
  );
}
