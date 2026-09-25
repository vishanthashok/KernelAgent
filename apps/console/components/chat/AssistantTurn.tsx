"use client";
import { useMemo, useState } from "react";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import type { KernelState } from "@/lib/useKernel";
import type { ChatTurn } from "@/lib/chats";
import { api, artifactUrl } from "@/lib/api";
import { pendingApproval, stepsFor } from "@/lib/steps";
import { Markdown } from "./Markdown";
import { Steps } from "./Steps";

const done = (p: ReplayedProcess) => p.status === "TERMINATED" || p.status === "FAILED";

function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AssistantTurn({ turn, k, onRetry }: { turn: ChatTurn; k: KernelState; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const jobId = turn.jobId;

  const procs = useMemo(
    () => (jobId ? [...k.processes.values()].filter((p) => p.jobId === jobId).sort((a, b) => Number(a.pid) - Number(b.pid)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k.version, jobId],
  );
  const steps = useMemo(
    () => (jobId ? stepsFor(k.events, jobId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k.version, jobId],
  );

  if (turn.error) {
    return (
      <div className="rounded-2xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-200">
        Could not start this job: {turn.error}
        <button onClick={onRetry} className="pill pill-ghost ml-3 px-3 py-0.5 text-xs">
          Retry
        </button>
      </div>
    );
  }

  const root = turn.rootPid ? k.processes.get(turn.rootPid) : undefined;

  // Before the job exists, or while the live stream is down, say so instead of a bare "Working".
  if (!jobId || (!root && !k.connected)) {
    return (
      <div className="flex items-center gap-2 text-sm text-term-dim">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" />
        {!jobId ? "Sending to the API…" : `Job ${jobId} started. Waiting for the live stream to reconnect…`}
      </div>
    );
  }

  const running = !root || procs.some((p) => !done(p));
  const subs = procs.filter((p) => p.pid !== turn.rootPid);
  const files = k.artifacts.filter((a) => a.jobId === jobId);
  const approvals = procs.filter((p) => p.waitingOn === "APPROVAL");
  const tokens = procs.reduce((n, p) => n + p.tokensUsed, 0);
  const cost = procs.reduce((n, p) => n + p.costUsd, 0);
  const answer = root?.result;

  return (
    <div>
      <Steps steps={steps} running={running} multiAgent={procs.length > 1} />

      {approvals.map((p) => (
        <div key={p.pid} className="mb-3 rounded-2xl border border-amber-300/30 bg-amber-300/5 p-4">
          <div className="text-sm text-amber-200">The agent wants to run a command:</div>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-[12.5px] whitespace-pre-wrap">{pendingApproval(k.events, p.pid) ?? "…"}</pre>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void api.signal(p.pid, "approve")} className="pill pill-light px-4 py-1 text-sm">
              Approve
            </button>
            <button onClick={() => void api.signal(p.pid, "deny")} className="pill pill-ghost px-4 py-1 text-sm">
              Deny
            </button>
          </div>
        </div>
      ))}

      {answer ? (
        <Markdown text={answer} />
      ) : root?.status === "FAILED" ? (
        <div className="text-sm text-red-300">
          The agent failed: {root.error ?? "unknown error"}
          <button onClick={onRetry} className="pill pill-ghost ml-3 px-3 py-0.5 text-xs">
            Retry
          </button>
        </div>
      ) : root?.error === "KILLED" ? (
        <div className="text-sm text-term-dim">Stopped.</div>
      ) : null}

      {files.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {files.map((f) => (
            <a
              key={f.id}
              href={artifactUrl(f.id)}
              download
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-white/30"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 font-mono text-[10px] uppercase">
                {f.path.split(".").pop()?.slice(0, 4) ?? "file"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{f.path.split("/").pop()}</span>
                <span className="block font-mono text-xs text-term-dim">{fileSize(f.size)}</span>
              </span>
              <span className="text-sm text-term-dim">↓</span>
            </a>
          ))}
        </div>
      )}

      {subs.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowSubs(!showSubs)} className="text-sm text-term-dim hover:text-term-fg">
            {showSubs ? "▾" : "▸"} {subs.length} sub-agent{subs.length === 1 ? "" : "s"}
          </button>
          {showSubs && (
            <div className="mt-2 space-y-2">
              {subs.map((s) => (
                <div key={s.pid} className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                  <div className="mb-1 text-xs text-term-dim">
                    <span className="font-mono text-term-accent">{s.pid}</span> {s.role} · {s.status.toLowerCase()}
                  </div>
                  {s.result ? <Markdown text={s.result} /> : <div className="text-sm text-term-dim">{done(s) ? "No answer." : "Working…"}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!running && (
        <div className="mt-3 flex items-center gap-3 font-mono text-[11px] text-term-dim">
          {answer && (
            <button
              onClick={() =>
                void navigator.clipboard.writeText(answer).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                })
              }
              className="rounded-md px-1.5 py-0.5 hover:bg-white/10 hover:text-term-fg"
            >
              {copied ? "copied" : "copy"}
            </button>
          )}
          <button onClick={onRetry} className="rounded-md px-1.5 py-0.5 hover:bg-white/10 hover:text-term-fg">
            retry
          </button>
          {turn.model && <span>{turn.model}</span>}
          <span>{tokens.toLocaleString()} tokens</span>
          <span>${cost.toFixed(4)}</span>
          {procs.length > 0 && <span>job {jobId}</span>}
        </div>
      )}
    </div>
  );
}
