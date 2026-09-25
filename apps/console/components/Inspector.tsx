"use client";
import { useState } from "react";
import type { KernelEvent } from "@kernelagent/kernel/types";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import { api } from "@/lib/api";
import { clock, cpuStar, describe } from "@/lib/format";
import { StateChip } from "./StateChip";

function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex justify-between text-sm text-term-dim">
        <span>{label}</span>
        <span>{text}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${pct > 90 ? "bg-red-400" : pct > 70 ? "bg-amber-300" : "bg-white"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Inspector({
  process: p,
  events,
  now,
  onClose,
  onSelect,
}: {
  process: ReplayedProcess;
  events: KernelEvent[];
  now: number;
  onClose: () => void;
  onSelect: (pid: string) => void;
}) {
  const [msg, setMsg] = useState<string>();
  const mine = events.filter((e) => e.pid === p.pid);
  const live = p.status !== "TERMINATED" && p.status !== "FAILED";
  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const r = (await fn()) as { message?: string; killed?: string[] };
      setMsg(`${label}: ${r.message ?? (r.killed ? `killed ${r.killed.join(", ") || "nothing"}` : "ok")}`);
    } catch (err) {
      setMsg(`${label}: ${(err as Error).message}`);
    }
  };
  const cpu = cpuStar(p, now);
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <tr>
      <td className="label-caps whitespace-nowrap py-1.5 pr-6 align-top">{k}</td>
      <td className="break-words py-1.5 text-sm">{v}</td>
    </tr>
  );

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/60 p-2 backdrop-blur-sm md:p-4" onClick={onClose}>
      <div className="card flex h-full w-full max-w-2xl flex-col overflow-auto p-6" style={{ background: "#0f1318" }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center gap-3">
          <span className="label-caps">PID {p.pid}</span>
          <span className="text-xl font-semibold tracking-tight">{p.role}</span>
          <StateChip status={p.status} detail={p.error === "KILLED" ? "killed" : p.waitingOn?.toLowerCase()} />
          <button onClick={onClose} className="pill pill-ghost ml-auto px-3 py-1 text-xs">
            Close
          </button>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <button disabled={!live} onClick={() => act("kill", () => api.kill(p.pid))} className="pill border border-red-400/50 px-3 py-1 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-30">
            kill
          </button>
          <button disabled={p.status !== "FAILED"} onClick={() => act("retry", () => api.signal(p.pid, "retry"))} className="pill pill-ghost px-3 py-1 text-xs disabled:opacity-30">
            retry
          </button>
          <button disabled={p.status !== "WAITING"} onClick={() => act("resume", () => api.signal(p.pid, "resume"))} className="pill pill-ghost px-3 py-1 text-xs disabled:opacity-30">
            resume
          </button>
          {p.waitingOn === "APPROVAL" && (
            <>
              <button onClick={() => act("approve", () => api.signal(p.pid, "approve"))} className="pill pill-light px-3 py-1 text-xs">
                approve
              </button>
              <button onClick={() => act("deny", () => api.signal(p.pid, "deny"))} className="pill border border-amber-300/50 px-3 py-1 text-xs text-amber-200 hover:bg-amber-300/10">
                deny
              </button>
            </>
          )}
          {msg && <span className="text-sm text-term-dim">{msg}</span>}
        </div>

        <Meter label="tokens" value={p.tokensUsed} max={p.tokenBudget} text={`${p.tokensUsed} / ${p.tokenBudget}`} />
        <Meter label="CPU* (runtime utilization, not real CPU)" value={cpu ?? 0} max={100} text={cpu === undefined ? "-" : `${cpu}%`} />

        <table className="mb-6">
          <tbody>
            <Row k="goal" v={p.goal} />
            <Row k="cost" v={`$${p.costUsd.toFixed(5)} (estimated from the price table)`} />
            <Row k="job" v={p.jobId} />
            <Row k="parent" v={p.parentPid ? <button className="text-term-accent" onClick={() => onSelect(p.parentPid!)}>{p.parentPid}</button> : "-"} />
            <Row k="depends on" v={p.dependsOn.length ? p.dependsOn.join(", ") : "-"} />
            <Row k="priority" v={p.priority} />
            <Row k="retries" v={`${p.retryCount} / ${p.maxRetries}`} />
            <Row k="timeout" v={`${Math.round(p.timeoutMs / 1000)}s`} />
            <Row k="sandbox" v={p.sandboxId ?? "-"} />
            <Row k="checkpoint" v={p.lastCheckpointSeq !== undefined ? `seq ${p.lastCheckpointSeq}` : "-"} />
            <Row
              k="capabilities"
              v={
                p.capabilities.length
                  ? p.capabilities.map((c, i) => (
                      <span key={i} className="mr-1.5 mb-1 inline-block rounded-full bg-white/[0.06] px-2.5 py-0.5 font-mono text-[11px]">
                        {c.type}
                        {c.scope ? `(${c.scope})` : ""}
                        {c.requiresApproval ? " ⚑approval" : ""}
                      </span>
                    ))
                  : "none"
              }
            />
            {p.result !== undefined && <Row k="result" v={<span className="whitespace-pre-wrap text-emerald-300">{p.result}</span>} />}
            {p.error && <Row k="error" v={<span className="text-red-300">{p.error}</span>} />}
          </tbody>
        </table>

        <div className="label-caps mb-2">Event log · {mine.length}</div>
        <div className="min-h-[200px] flex-1 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[12px] leading-relaxed whitespace-pre">
          {mine.map((e) => (
            <div key={e.sequence}>
              <span className="text-term-dim">
                {String(e.sequence).padStart(5)} {clock(e.timestamp)}{" "}
              </span>
              {e.type.padEnd(17)} {describe(e)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
