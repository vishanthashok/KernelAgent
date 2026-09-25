"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useKernel, useNow } from "@/lib/useKernel";
import { hhmmss } from "@/lib/format";
import { ProcessTable } from "./ProcessTable";
import { EventStream } from "./EventStream";
import { TaskGraph } from "./TaskGraph";
import { IpcView } from "./IpcView";
import { SandboxesView } from "./SandboxesView";
import { TracesView } from "./TracesView";
import { Inspector } from "./Inspector";
import { NewJob } from "./NewJob";
import { OutputView } from "./OutputView";

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
    <div className="card px-5 py-4">
      <div className="label-caps">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
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
  const tokens = procs.reduce((n, p) => n + p.tokensUsed, 0);
  const cost = procs.reduce((n, p) => n + p.costUsd, 0);
  const live = procs.filter((p) => p.status !== "TERMINATED" && p.status !== "FAILED").length;
  const wide = tab === "Traces";

  return (
    <div className="mx-auto max-w-[1520px] px-4 pb-16 md:px-8">
      {/* Floating nav, like a pill over the page */}
      <nav className="sticky top-4 z-10 mt-4 flex items-center gap-4 rounded-2xl bg-white/90 px-4 py-3 text-neutral-600 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur md:px-6">
        <div className="hidden min-w-0 flex-1 items-center gap-6 lg:flex">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`font-mono text-[11px] uppercase tracking-[0.22em] transition-colors ${
                tab === t ? "text-neutral-950" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <Link href="/" className="shrink-0 font-mono text-sm font-semibold tracking-[0.35em] text-neutral-950" title="Back to chat">
          KERNELAGENT
        </Link>
        <div className="flex flex-1 items-center justify-end gap-4">
          <span className="hidden items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] sm:flex">
            <span className={`h-2 w-2 rounded-full ${k.connected ? "bg-emerald-500" : "bg-red-500"}`} />
            {k.connected ? "live" : "offline"}
          </span>
          <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-600 hover:text-neutral-950">
            Chat
          </Link>
          <button onClick={() => setNewJob(true)} className="pill pill-dark text-sm">
            New Job
          </button>
        </div>
      </nav>

      {/* Tabs for small screens */}
      <div className="mt-3 flex gap-2 overflow-x-auto lg:hidden">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pill shrink-0 text-xs ${tab === t ? "pill-light" : "pill-ghost"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Hero */}
      <header className="mt-14 mb-10 grid gap-8 md:mt-20 lg:grid-cols-[1.5fr_1fr] lg:items-end">
        <div>
          <div className="label-caps mb-4">Agent kernel · live console</div>
          <h1 className="text-5xl font-semibold leading-[1.02] tracking-tight md:text-6xl">
            Agents, scheduled
            <br />
            like processes.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-term-dim">
            Every agent gets a process, a budget, capabilities, and its own sandbox. Every step lands in an append-only log you can
            replay.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button onClick={() => setNewJob(true)} className="pill pill-light">
              Run a job
            </button>
            <button onClick={() => setTab("Traces")} className="pill pill-ghost">
              Replay a run
            </button>
          </div>
        </div>
        <div className="card grid grid-cols-2 gap-x-6 gap-y-4 p-5 text-sm">
          <div>
            <div className="label-caps">Model</div>
            <div className="mt-1 truncate font-medium">{s ? `${s.provider} / ${s.model}` : "…"}</div>
          </div>
          <div>
            <div className="label-caps">Sandbox</div>
            <div className="mt-1 font-medium">{s?.sandbox ?? "…"}</div>
          </div>
          <div>
            <div className="label-caps">Rate limit</div>
            <div className="mt-1 font-medium">
              {s ? `${Math.round(s.rateLimiter.requests * 100)}% req · ${Math.round(s.rateLimiter.tokens * 100)}% tok` : "…"}
            </div>
          </div>
          <div>
            <div className="label-caps">Event log</div>
            <div className="mt-1 font-medium">seq {k.lastSequence}</div>
          </div>
        </div>
      </header>

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
      <section className={`mt-4 grid gap-4 ${wide ? "" : "lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]"}`}>
        <div className="card flex min-h-[560px] min-w-0 flex-col">
          <div className="flex flex-wrap items-end gap-4 border-b border-white/10 px-6 py-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold tracking-tight">{tab}</h2>
              <p className="mt-1 text-sm text-term-dim">{TAB_BLURB[tab]}</p>
            </div>
            <label className="flex items-center gap-3">
              <span className="label-caps">Job</span>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="max-w-[18rem] border border-white/15 bg-black/30 px-3 py-1.5 text-sm"
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

      <footer className="mt-10 flex flex-wrap justify-between gap-2 text-xs text-term-dim">
        <span>KernelAgent · cooperative scheduler, capability-guarded syscalls, append-only event log</span>
        <span>CPU* is runtime utilization, not real CPU</span>
      </footer>

      {newJob && (
        <NewJob
          {...(s?.provider ? { provider: s.provider } : {})}
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
  );
}
