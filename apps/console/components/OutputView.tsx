"use client";
import { useState } from "react";
import type { KernelEvent } from "@kernelagent/kernel/types";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import type { Artifact, JobInfo } from "@/lib/useKernel";
import { artifactUrl } from "@/lib/api";
import { describe } from "@/lib/format";
import { StateChip } from "./StateChip";

const done = (p: ReplayedProcess) => p.status === "TERMINATED" || p.status === "FAILED";

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="pill pill-ghost px-3 py-1 text-xs"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** The answer and files for one job: what the user actually asked for. */
export function OutputView({
  jobId,
  jobs,
  processes,
  artifacts,
  events,
  onSelect,
  onNewJob,
}: {
  jobId?: string | undefined;
  jobs: JobInfo[];
  processes: ReplayedProcess[];
  artifacts: Artifact[];
  events: KernelEvent[];
  onSelect: (pid: string) => void;
  onNewJob: () => void;
}) {
  if (!jobId) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
        <div className="label-caps">No output yet</div>
        <p className="mt-3 max-w-sm text-term-dim">Run a job. Its answer and any files the agents produce show up here.</p>
        <button onClick={onNewJob} className="pill pill-light mt-6">
          Run a job
        </button>
      </div>
    );
  }

  const job = jobs.find((j) => j.id === jobId);
  const procs = processes.filter((p) => p.jobId === jobId).sort((a, b) => Number(a.pid) - Number(b.pid));
  const files = artifacts.filter((a) => a.jobId === jobId);
  const finished = procs.length > 0 && procs.every(done);
  const failed = procs.some((p) => p.status === "FAILED" || p.error === "KILLED");
  const latest = [...events].reverse().find((e) => e.jobId === jobId && e.pid);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="label-caps">Job</div>
          <div className="mt-1 truncate text-lg font-semibold tracking-tight">{job?.name ?? jobId}</div>
        </div>
        <span
          className={`rounded-full px-3 py-1 font-mono text-xs ${
            !finished ? "bg-emerald-400/10 text-emerald-300" : failed ? "bg-red-400/10 text-red-300" : "bg-white/10 text-term-fg"
          }`}
        >
          {!finished ? "working…" : failed ? "finished with errors" : "complete"}
        </span>
      </div>

      {!finished && latest && (
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="font-mono text-term-accent">{latest.pid}</span>
          <span className="min-w-0 truncate font-mono text-term-dim">{describe(latest)}</span>
        </div>
      )}

      {files.length > 0 && (
        <div>
          <div className="label-caps mb-3">Files</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {files.map((f) => (
              <a
                key={f.id}
                href={artifactUrl(f.id)}
                download
                className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-white/30"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 font-mono text-[10px] uppercase">
                  {f.path.split(".").pop()?.slice(0, 4) ?? "file"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.path}</span>
                  <span className="block font-mono text-xs text-term-dim">
                    {size(f.size)} · from {f.pid}
                  </span>
                </span>
                <span className="pill pill-light px-3 py-1 text-xs">Download</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="label-caps mb-3">Answers</div>
        <div className="space-y-3">
          {procs.map((p) => (
            <div key={p.pid} className="rounded-2xl border border-white/10 bg-white/[0.02]">
              <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-5 py-3">
                <button onClick={() => onSelect(p.pid)} className="font-mono text-sm text-term-accent hover:underline">
                  {p.pid}
                </button>
                <span className="font-medium">{p.role}</span>
                <StateChip status={p.status} detail={p.error === "KILLED" ? "killed" : p.waitingOn?.toLowerCase()} />
                <span className="ml-auto flex gap-2">{p.result ? <CopyButton text={p.result} /> : null}</span>
              </div>
              <div className="px-5 py-4">
                {p.result ? (
                  <div className="max-h-[480px] overflow-auto whitespace-pre-wrap text-[15px] leading-relaxed">{p.result}</div>
                ) : p.status === "FAILED" ? (
                  <p className="text-sm text-red-300">{p.error ?? "Failed without an answer."}</p>
                ) : p.error === "KILLED" ? (
                  <p className="text-sm text-term-dim">Killed before it answered.</p>
                ) : p.waitingOn === "APPROVAL" ? (
                  <p className="text-sm text-amber-200">
                    Waiting for your approval to run a command.{" "}
                    <button onClick={() => onSelect(p.pid)} className="underline">
                      Review it
                    </button>
                  </p>
                ) : (
                  <p className="text-sm text-term-dim">Working on it…</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
