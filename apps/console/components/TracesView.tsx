"use client";
import { useEffect, useMemo, useState } from "react";
import type { KernelEvent } from "@kernelagent/kernel/types";
import { replayProcesses } from "@kernelagent/kernel/replay";
import type { JobInfo } from "@/lib/useKernel";
import { clock, describe } from "@/lib/format";
import { StateChip } from "./StateChip";

type P = Record<string, any>;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="label-caps mb-2">{title}</div>
      <div className="max-h-72 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{children}</div>
    </div>
  );
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

function renderContent(c: unknown): string {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return json(c);
  return c
    .map((b: P) =>
      b.type === "text"
        ? b.text
        : b.type === "tool_use"
          ? `→ ${b.name}(${JSON.stringify(b.input)})`
          : b.type === "tool_result"
            ? `← ${b.is_error ? "ERROR " : ""}${b.content}`
            : `[${b.type}]`,
    )
    .join("\n");
}

/** The recorded LLM I/O at the cursor: exactly what the model saw and said. */
function EventDetail({ e }: { e: KernelEvent }) {
  const p = e.payload as P;
  if (e.type === "LLM_CALL") {
    const msgs = (p.request?.messages ?? []) as P[];
    return (
      <>
        <Block title={`SYSTEM PROMPT · ${p.provider}/${p.model} · in=${p.inputTokens} out=${p.outputTokens} · ${p.durationMs}ms`}>{p.request?.system}</Block>
        <Block title={`MESSAGES (${msgs.length}) · tools: ${(p.request?.tools ?? []).map((t: P) => t.name).join(", ")}`}>
          {msgs.map((m, i) => (
            <div key={i} className="mb-1">
              <span className={m.role === "user" ? "text-amber-200" : "text-cyan-300"}>{m.role}: </span>
              {renderContent(m.content)}
            </div>
          ))}
        </Block>
        <Block title="RESPONSE">
          <span className="text-cyan-300">{renderContent(p.response?.content)}</span>
        </Block>
      </>
    );
  }
  if (e.type === "SYSCALL")
    return (
      <>
        <Block title={`REQUEST · retry-safety ${p.retrySafety ?? "-"}${p.capability ? ` · via ${p.capability.type}` : ""}`}>{json(p.request)}</Block>
        <Block title={p.ok ? `RESULT · ${p.durationMs}ms` : `ERROR · ${p.code}${p.denied ? " · DENIED" : ""}`}>{p.ok ? json(p.result) : p.error}</Block>
      </>
    );
  return <Block title={e.type}>{json(p)}</Block>;
}

export function TracesView({
  events,
  jobs,
  initialJob,
  onSelect,
}: {
  events: KernelEvent[];
  jobs: JobInfo[];
  initialJob?: string;
  onSelect: (pid: string) => void;
}) {
  const [jobId, setJobId] = useState(initialJob);
  const [pid, setPid] = useState("all");
  const [cursor, setCursor] = useState<number>();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!jobId && initialJob) setJobId(initialJob);
  }, [initialJob, jobId]);

  const jobEvents = useMemo(() => events.filter((e) => e.jobId === jobId), [events, events.length, jobId]);
  const visible = useMemo(() => jobEvents.filter((e) => pid === "all" || e.pid === pid), [jobEvents, pid]);
  const idx = cursor === undefined ? visible.length - 1 : Math.min(cursor, visible.length - 1);
  const at = visible[idx];
  const state = useMemo(() => (at ? replayProcesses(jobEvents, at.sequence) : new Map()), [jobEvents, at]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setCursor((c) => {
        const next = (c ?? -1) + 1;
        if (next >= visible.length - 1) setPlaying(false);
        return Math.min(next, visible.length - 1);
      });
    }, 250);
    return () => clearInterval(t);
  }, [playing, visible.length]);

  const pids = [...new Set(jobEvents.filter((e) => e.pid).map((e) => e.pid!))].sort((a, b) => Number(a) - Number(b));
  const step = (d: number) => {
    setPlaying(false);
    setCursor(Math.max(0, Math.min(visible.length - 1, idx + d)));
  };

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
        <select value={jobId ?? ""} onChange={(e) => (setJobId(e.target.value), setCursor(undefined))} className="border border-white/15 bg-black/30 px-3 py-1.5 text-sm">
          {[...jobs].reverse().map((j) => (
            <option key={j.id} value={j.id}>
              {j.id} {j.name ?? ""}
            </option>
          ))}
        </select>
        <select value={pid} onChange={(e) => (setPid(e.target.value), setCursor(undefined))} className="border border-white/15 bg-black/30 px-3 py-1.5 text-sm">
          <option value="all">all pids</option>
          {pids.map((p) => (
            <option key={p} value={p}>
              PID {p}
            </option>
          ))}
        </select>
        <span className="label-caps ml-2">Rewind</span>
        <button onClick={() => (setPlaying(false), setCursor(0))} className="pill pill-ghost px-3 py-1 text-xs">|◀</button>
        <button onClick={() => step(-1)} className="pill pill-ghost px-3 py-1 text-xs">◀</button>
        <button
          onClick={() => {
            if (idx >= visible.length - 1) setCursor(0);
            setPlaying((p) => !p);
          }}
          className="pill pill-light w-20 justify-center px-3 py-1 text-xs"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button onClick={() => step(1)} className="pill pill-ghost px-3 py-1 text-xs">▶</button>
        <button onClick={() => (setPlaying(false), setCursor(undefined))} className="pill pill-ghost px-3 py-1 text-xs">Live ▶|</button>
        <input
          type="range"
          min={0}
          max={Math.max(0, visible.length - 1)}
          value={Math.max(0, idx)}
          onChange={(e) => (setPlaying(false), setCursor(Number(e.target.value)))}
          className="min-w-[12rem] flex-1"
        />
        <span className="font-mono text-xs text-term-dim">
          seq {at?.sequence ?? "-"} ({idx + 1}/{visible.length})
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 xl:flex-row">
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-white/10 bg-black/20 p-2 font-mono text-[12px] whitespace-pre xl:w-1/2">
          {visible.map((e, i) => (
            <div
              key={e.sequence}
              onClick={() => (setPlaying(false), setCursor(i))}
              className={`cursor-pointer rounded-md px-2 py-0.5 ${i === idx ? "bg-white/10 text-term-fg" : i > idx ? "text-term-dim/50" : "text-term-dim hover:text-term-fg"}`}
            >
              {String(e.sequence).padStart(5)} {clock(e.timestamp)} {e.pid ? `PID ${e.pid.padEnd(4)}` : "job     "} {e.type.padEnd(17)} {describe(e)}
            </div>
          ))}
        </div>
        <div className="min-w-0 xl:w-1/2">
          <div className="mb-5">
            <div className="label-caps mb-2">Kernel state at seq {at?.sequence ?? "-"}</div>
            <table className="w-full text-sm">
              <tbody>
                {[...state.values()].map((p) => (
                  <tr key={p.pid}>
                    <td className="pr-3">
                      <button className="text-term-accent hover:underline" onClick={() => onSelect(p.pid)}>
                        {p.pid}
                      </button>
                    </td>
                    <td className="pr-3">{p.role}</td>
                    <td className="py-1 pr-3"><StateChip status={p.status} /></td>
                    <td className="pr-3 text-right">{p.tokensUsed} tok</td>
                    <td className="text-term-dim">{p.result ? `→ ${String(p.result).slice(0, 40)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {at && <EventDetail e={at} />}
        </div>
      </div>
    </div>
  );
}
