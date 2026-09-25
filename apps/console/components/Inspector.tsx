"use client";
import { useState } from "react";
import type { KernelEvent } from "@kernelagent/kernel/types";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import { api } from "@/lib/api";
import { clock, cpuStar, describe, STATE_COLOR } from "@/lib/format";

function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="flex justify-between text-term-dim">
        <span>{label}</span>
        <span>{text}</span>
      </div>
      <div className="h-1.5 bg-term-line">
        <div className={`h-full ${pct > 90 ? "bg-red-400" : pct > 70 ? "bg-amber-300" : "bg-term-accent"}`} style={{ width: `${pct}%` }} />
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
      <td className="pr-4 align-top text-term-dim">{k}</td>
      <td className="break-all">{v}</td>
    </tr>
  );

  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col overflow-auto border-l border-term-line bg-term-bg p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-baseline gap-3">
          <span className="text-lg text-term-accent">PID {p.pid}</span>
          <span>{p.role}</span>
          <span className={STATE_COLOR[p.status]}>
            {p.status}
            {p.waitingOn ? ` (${p.waitingOn})` : ""}
          </span>
          <button onClick={onClose} className="ml-auto text-term-dim hover:text-term-fg">
            [close]
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <button disabled={!live} onClick={() => act("kill", () => api.kill(p.pid))} className="border border-red-400/60 px-2 text-red-300 disabled:opacity-30">
            kill
          </button>
          <button disabled={p.status !== "FAILED"} onClick={() => act("retry", () => api.signal(p.pid, "retry"))} className="border border-term-line px-2 disabled:opacity-30">
            retry
          </button>
          <button disabled={p.status !== "WAITING"} onClick={() => act("resume", () => api.signal(p.pid, "resume"))} className="border border-term-line px-2 disabled:opacity-30">
            resume
          </button>
          {p.waitingOn === "APPROVAL" && (
            <>
              <button onClick={() => act("approve", () => api.signal(p.pid, "approve"))} className="border border-emerald-400/60 px-2 text-emerald-300">
                approve
              </button>
              <button onClick={() => act("deny", () => api.signal(p.pid, "deny"))} className="border border-amber-300/60 px-2 text-amber-200">
                deny
              </button>
            </>
          )}
          {msg && <span className="text-term-dim">{msg}</span>}
        </div>

        <Meter label="tokens" value={p.tokensUsed} max={p.tokenBudget} text={`${p.tokensUsed} / ${p.tokenBudget}`} />
        <Meter label="CPU* (runtime utilization, not real CPU)" value={cpu ?? 0} max={100} text={cpu === undefined ? "-" : `${cpu}%`} />

        <table className="mb-3">
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
                      <span key={i} className="mr-2 inline-block border border-term-line px-1">
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

        <div className="mb-1 text-term-dim">EVENT LOG ({mine.length})</div>
        <div className="flex-1 overflow-auto border border-term-line bg-term-panel p-2 whitespace-pre">
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
