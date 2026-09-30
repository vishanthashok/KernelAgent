"use client";
// One agent reply: what it did, its answer, the files it made, and its sub-agents. Reads the
// live event stream while the job runs, and the turn's saved snapshot once it is done, so
// a reload or another device shows the same thing.
import { useMemo, useState } from "react";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import type { KernelState } from "@/lib/useKernel";
import type { ChatTurn, TurnFile } from "@/lib/chats";
import type { ModelsResponse } from "@/lib/api";
import { modelName } from "@/lib/useModels";
import { api } from "@/lib/api";
import { pendingApproval, stepsFor } from "@/lib/steps";
import { Logo } from "../shell/Logo";
import { fileName, fileSize, kindOf } from "./ArtifactPanel";
import { Markdown } from "./Markdown";
import { Steps, type StepItem } from "./Steps";

const done = (p: ReplayedProcess) => p.status === "TERMINATED" || p.status === "FAILED";

const KIND_LABEL: Record<ReturnType<typeof kindOf>, string> = {
  markdown: "Document",
  pdf: "PDF",
  image: "Image",
  csv: "Table",
  html: "Web page",
  json: "Data",
  text: "Text",
  binary: "File",
};

export function AssistantTurn({
  turn,
  k,
  models,
  onRetry,
  onOpenFile,
}: {
  turn: ChatTurn;
  k: KernelState;
  models?: ModelsResponse | undefined;
  onRetry: () => void;
  onOpenFile: (files: TurnFile[], index: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const jobId = turn.jobId;

  const procs = useMemo(
    () => (jobId ? [...k.processes.values()].filter((p) => p.jobId === jobId).sort((a, b) => Number(a.pid) - Number(b.pid)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k.version, jobId],
  );
  const liveSteps = useMemo(
    () => (jobId ? stepsFor(k.events, jobId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k.version, jobId],
  );

  if (turn.error) {
    return (
      <Frame>
        <div className="rounded-[6px] border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Couldn&apos;t start: {turn.error}
          <button onClick={onRetry} className="ml-3 underline">
            Try again
          </button>
        </div>
      </Frame>
    );
  }

  const root = turn.rootPid ? k.processes.get(turn.rootPid) : undefined;
  const rootDone = !!root && done(root);
  // The turn is over when its main agent is. Sub-agents it left running are shown apart.
  const running = !turn.status && !rootDone;
  const subs = procs.filter((p) => p.pid !== turn.rootPid);
  const subsRunning = subs.filter((p) => !done(p)).length;
  const approvals = procs.filter((p) => p.waitingOn === "APPROVAL");

  const liveFiles: TurnFile[] = k.artifacts.filter((a) => a.jobId === jobId).map(({ id, path, mime, size }) => ({ id, path, mime, size }));
  const files = liveFiles.length ? liveFiles : (turn.files ?? []);
  const steps: StepItem[] = liveSteps.length
    ? liveSteps.map((s) => ({ key: String(s.seq), text: s.text, tone: s.tone, ...(s.pid ? { pid: s.pid } : {}), ...(s.detail ? { detail: s.detail } : {}) }))
    : (turn.steps ?? []).map((text, i) => ({ key: `s${i}`, text, tone: "action" as const }));
  const answer = root?.result ?? turn.answer;
  const failure = root?.status === "FAILED" ? (root.error ?? "unknown error") : turn.status === "failed" ? turn.failure : undefined;
  const stopped = root?.error === "KILLED" || turn.status === "stopped";
  const tokens = procs.length ? procs.reduce((n, p) => n + p.tokensUsed, 0) : (turn.tokens ?? 0);
  const cost = procs.length ? procs.reduce((n, p) => n + p.costUsd, 0) : (turn.cost ?? 0);

  return (
    <Frame>
      {!jobId ? (
        <Working text="Sending to your agents…" />
      ) : running ? (
        <Working text={steps.length ? steps[steps.length - 1]!.text : k.connected ? "Starting…" : "Reconnecting to the live stream…"} />
      ) : null}

      <Steps steps={steps} running={running} multiAgent={procs.length > 1} />

      {approvals.map((p) => (
        <div key={p.pid} className="mb-4 rounded-[6px] border border-warn/40 bg-warn/5 p-4">
          <div className="text-sm text-warn">The agent wants to run a command:</div>
          <pre className="mt-2 overflow-x-auto rounded-[5px] bg-sunk/40 p-3 font-mono text-[12.5px] whitespace-pre-wrap">{pendingApproval(k.events, p.pid) ?? "…"}</pre>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void api.signal(p.pid, "approve")} className="rounded-[5px] bg-accent px-4 py-1.5 text-sm font-medium text-on-accent">
              Allow
            </button>
            <button onClick={() => void api.signal(p.pid, "deny")} className="rounded-[5px] border border-term-line px-4 py-1.5 text-sm">
              Deny
            </button>
          </div>
        </div>
      ))}

      {answer ? (
        <div className="text-[15px] leading-[1.7]">
          <Markdown text={answer} />
        </div>
      ) : failure ? (
        <div className="text-sm text-danger">
          The agent failed: {failure}
          <button onClick={onRetry} className="ml-3 underline">
            Try again
          </button>
        </div>
      ) : stopped ? (
        <div className="text-sm text-term-dim">Stopped.</div>
      ) : turn.status === "lost" ? (
        <div className="text-sm text-term-dim">
          This answer is no longer on the server.{" "}
          <button onClick={onRetry} className="underline">
            Run it again
          </button>
        </div>
      ) : null}

      {files.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {files.map((f, i) => {
            const kind = kindOf(f);
            return (
              <button
                key={f.id}
                onClick={() => onOpenFile(files, i)}
                className="group flex items-center gap-3 rounded-[7px] border border-term-line bg-term-panel p-3 text-left transition-colors hover:border-accent/60"
              >
                <span className="flex h-10 w-9 shrink-0 items-end justify-center rounded-[4px] border border-term-line bg-term-panel-2 pb-1 font-mono text-[9px] text-term-dim uppercase">
                  {fileName(f.path).split(".").pop()?.slice(0, 4)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{fileName(f.path)}</span>
                  <span className="block text-[11.5px] text-term-dim">
                    {KIND_LABEL[kind]} · {fileSize(f.size)}
                  </span>
                </span>
                <span className="text-[12px] text-term-dim group-hover:text-accent">Open</span>
              </button>
            );
          })}
        </div>
      )}

      {subs.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowSubs(!showSubs)} className="flex items-center gap-2 text-[13px] text-term-dim hover:text-term-fg">
            <span>{showSubs ? "▾" : "▸"}</span>
            {subs.length} helper agent{subs.length === 1 ? "" : "s"}
            {subsRunning > 0 && !running && (
              <span className="flex items-center gap-1.5 text-[12px]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                {subsRunning} still finishing
              </span>
            )}
          </button>
          {showSubs && (
            <div className="mt-2 space-y-2">
              {subs.map((s) => (
                <div key={s.pid} className="rounded-[6px] border border-term-line px-4 py-3">
                  <div className="mb-1 flex items-center gap-2 text-[12px] text-term-dim">
                    <span className="font-mono">{s.pid}</span>
                    <span className="text-term-fg">{s.role}</span>
                    <span>· {s.status.toLowerCase()}</span>
                  </div>
                  {s.result ? <Markdown text={s.result} /> : <div className="text-sm text-term-dim">{done(s) ? "No answer." : "Working…"}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!running && jobId && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-term-dim">
          {answer && (
            <button
              onClick={() =>
                void navigator.clipboard.writeText(answer).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                })
              }
              className="rounded-[4px] px-1.5 py-0.5 hover:bg-ink/10 hover:text-term-fg"
            >
              {copied ? "copied" : "copy"}
            </button>
          )}
          <button onClick={onRetry} className="rounded-[4px] px-1.5 py-0.5 hover:bg-ink/10 hover:text-term-fg">
            retry
          </button>
          {turn.model && <span title={turn.model}>{modelName(turn.model, models)}</span>}
          {tokens > 0 && <span>{tokens.toLocaleString()} tokens</span>}
          {cost > 0 && <span>${cost.toFixed(4)}</span>}
        </div>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <div className="shrink-0 pt-0.5">
        <Logo size={26} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The live "what it is doing now" line. */
function Working({ text }: { text: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5 text-[13.5px]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      <span className="shimmer min-w-0 truncate">{text}</span>
    </div>
  );
}
