"use client";
import { useEffect, useMemo, useState } from "react";
import { useKernel, useNow } from "@/lib/useKernel";
import { resolveModel, useLastModel, useModels } from "@/lib/useModels";
import { hhmmss } from "@/lib/format";
import { ProcessTable } from "./ProcessTable";
import { EventStream } from "./EventStream";
import { TaskGraph } from "./TaskGraph";
import { IpcView } from "./IpcView";
import { SandboxesView } from "./SandboxesView";
import { TracesView } from "./TracesView";
import { Inspector } from "./Inspector";
import { NewJob } from "./NewJob";
import { ApiBanner } from "./ApiBanner";
import { OutputView } from "./OutputView";
import { AppShell, PageHeader } from "./shell/AppShell";

const TABS = ["Output", "Processes", "Task Graph", "IPC", "Sandboxes", "Traces"] as const;
type Tab = (typeof TABS)[number];

const TAB_BLURB: Record<Tab, string> = {
  Output: "The answer and files for the selected job, or the latest one.",
  Processes: "Every agent is a process with a state, a budget, and a sandbox.",
  "Task Graph": "Dependencies and spawned children for the selected job.",
  IPC: "Mailboxes and the messages agents send each other.",
  Sandboxes: "Isolated environments and the process that owns each one.",
  Traces: "Rewind a job event by event, with the exact model input and output.",
};

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-xs font-medium text-term-dim">{label}</div>
      <div className="mt-1.5 text-[22px] leading-none font-semibold tabular-nums">{value}</div>
      {sub !== undefined && <div className="mt-1 text-xs text-term-dim">{sub}</div>}
    </div>
  );
}

export function Console() {
  const k = useKernel();
  const now = useNow(1000);
  const [tab, setTab] = useState<Tab>("Output");
  const [jobId, setJobId] = useState<string>("all");
  const [inspect, setInspect] = useState<string>();
  const [newJob, setNewJob] = useState(false);

  // /console?job=<id> (from the dashboard) opens that job.
  useEffect(() => {
    const j = new URLSearchParams(window.location.search).get("job");
    if (j) setJobId(j);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setNewJob(false);
      setInspect(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const procs = useMemo(
    () => [...k.processes.values()].filter((p) => jobId === "all" || p.jobId === jobId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k.version, jobId],
  );
  const events = useMemo(
    () => (jobId === "all" ? k.events : k.events.filter((e) => e.jobId === jobId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k.version, jobId],
  );
  const graphJob = jobId !== "all" ? jobId : k.jobs[k.jobs.length - 1]?.id;
  const s = k.stats;
  const lastModel = useLastModel();
  const model = resolveModel(lastModel, useModels(s?.provider, s?.model).data, s?.model);
  const tokens = procs.reduce((n, p) => n + p.tokensUsed, 0);
  const cost = procs.reduce((n, p) => n + p.costUsd, 0);
  const live = procs.filter((p) => p.status !== "TERMINATED" && p.status !== "FAILED").length;
  const wide = tab === "Traces";

  return (
    <AppShell active="console" status={k.connected}>
      <PageHeader crumb="Console" title="Processes and jobs">
        <span className="hidden font-mono text-[11px] text-term-dim md:inline">
          {s ? `${s.provider} / ${model?.name ?? s.model} · sandbox ${s.sandbox ?? "none"} · seq ${k.lastSequence}` : "…"}
        </span>
        <button onClick={() => setTab("Traces")} className="pill pill-ghost py-1 text-xs">
          Replay a run
        </button>
        <button onClick={() => setNewJob(true)} className="pill pill-light py-1 text-xs">
          New job
        </button>
      </PageHeader>

      {/* Tabs, Datadog style: text with an accent underline. */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-term-line bg-term-panel px-3 md:px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
              tab === t ? "border-accent text-term-fg" : "border-transparent text-term-dim hover:text-term-fg"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1600px] space-y-3 p-3 md:p-4">
      <ApiBanner connected={k.connected} error={k.apiError} />

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Uptime" value={<span className="font-mono">{s ? hhmmss(now - s.bootedAt) : "--:--:--"}</span>} />
        <Stat label="Running" value={s ? `${s.running} / ${s.maxConcurrency}` : "…"} sub="slots in use" />
        <Stat label="Queue" value={s?.queueDepth ?? "…"} sub="ready to dispatch" />
        <Stat label="Processes" value={procs.length} sub={`${live} live`} />
        <Stat label="Tokens" value={tokens.toLocaleString()} sub={jobId === "all" ? "all jobs" : "this job"} />
        <Stat label="Cost" value={`$${cost.toFixed(4)}`} sub="estimated" />
      </section>

      {/* Workspace */}
      <section className={`grid gap-3 ${wide ? "" : "lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]"}`}>
        <div className="card flex min-h-[560px] min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-4 border-b border-term-line px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <h2 className="text-[13px] font-semibold">{tab}</h2>
              <p className="mt-0.5 text-xs text-term-dim">{TAB_BLURB[tab]}</p>
            </div>
            <label className="flex items-center gap-3">
              <span className="label-caps">Job</span>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="max-w-[18rem] border border-ink/15 bg-sunk/30 px-3 py-1.5 text-sm"
              >
                <option value="all">All jobs</option>
                {[...k.jobs].reverse().map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name ? `${j.name} · ` : ""}
                    {j.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
            {tab === "Output" && (
              <OutputView
                jobId={graphJob}
                jobs={k.jobs}
                processes={[...k.processes.values()]}
                artifacts={k.artifacts}
                events={k.events}
                onSelect={setInspect}
                onNewJob={() => setNewJob(true)}
              />
            )}
            {tab === "Processes" && <ProcessTable processes={procs} now={now} onSelect={setInspect} onNewJob={() => setNewJob(true)} />}
            {tab === "Task Graph" && (
              <TaskGraph processes={[...k.processes.values()].filter((p) => p.jobId === graphJob)} jobId={graphJob} onSelect={setInspect} />
            )}
            {tab === "IPC" && (
              <IpcView messages={k.messages.filter((m) => jobId === "all" || m.jobId === jobId)} processes={procs} onSelect={setInspect} />
            )}
            {tab === "Sandboxes" && <SandboxesView processes={procs} provider={s?.sandbox ?? null} onSelect={setInspect} />}
            {tab === "Traces" && <TracesView events={k.events} jobs={k.jobs} initialJob={graphJob} onSelect={setInspect} />}
          </div>
        </div>
        <aside className={`card flex min-w-0 flex-col ${wide ? "h-[360px]" : "h-[560px] lg:h-auto lg:max-h-[80vh]"}`}>
          <EventStream events={events} onSelect={setInspect} />
        </aside>
      </section>

      <footer className="flex flex-wrap justify-between gap-2 pt-2 text-xs text-term-dim">
        <span>KernelAgent · cooperative scheduler, capability-guarded syscalls, append-only event log</span>
        <span>CPU* is runtime utilization, not real CPU</span>
      </footer>

      {newJob && (
        <NewJob
          {...(s?.provider ? { provider: s.provider } : {})}
          model={model && !model.isDefault ? model.id : undefined}
          onClose={() => setNewJob(false)}
          onSubmitted={(res) => {
            setNewJob(false);
            setJobId(res.jobId);
            setTab("Output");
          }}
        />
      )}

      {inspect && k.processes.get(inspect) && (
        <Inspector process={k.processes.get(inspect)!} events={k.events} now={now} onClose={() => setInspect(undefined)} onSelect={setInspect} />
      )}
      </div>
      </div>
    </AppShell>
  );
}
