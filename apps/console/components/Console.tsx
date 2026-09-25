"use client";
import { useMemo, useState } from "react";
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

const TABS = ["Processes", "Task Graph", "IPC", "Sandboxes", "Traces"] as const;
type Tab = (typeof TABS)[number];

export function Console() {
  const k = useKernel();
  const now = useNow(1000);
  const [tab, setTab] = useState<Tab>("Processes");
  const [jobId, setJobId] = useState<string>("all");
  const [inspect, setInspect] = useState<string>();
  const [newJob, setNewJob] = useState(false);

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
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-term-line px-4 py-2">
        <span className="font-bold tracking-[0.2em] text-term-accent">KERNELAGENT</span>
        <span>uptime {s ? hhmmss(now - s.bootedAt) : "--:--:--"}</span>
        {s && (
          <span className="text-term-dim">
            llm {s.provider}/{s.model} · sandbox {s.sandbox ?? "none"} · run {s.running}/{s.maxConcurrency} · queue {s.queueDepth} · ratelimit req{" "}
            {pct(s.rateLimiter.requests)} tok {pct(s.rateLimiter.tokens)}
          </span>
        )}
        <span className={`ml-auto ${k.connected ? "text-emerald-400" : "text-red-400"}`}>
          {k.connected ? "● live" : "○ disconnected"} · seq {k.lastSequence}
        </span>
      </header>

      <nav className="flex flex-wrap items-center gap-1 border-b border-term-line px-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 ${tab === t ? "border-b-2 border-term-accent text-term-fg" : "text-term-dim hover:text-term-fg"}`}
          >
            {t}
          </button>
        ))}
        <button
          onClick={() => setNewJob(true)}
          className="ml-auto border border-term-accent px-2 py-0.5 text-term-accent hover:bg-term-accent/10"
        >
          + New Job
        </button>
        <label className="flex items-center gap-2 py-1 pl-3 text-term-dim">
          job
          <select
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="max-w-[16rem] border border-term-line bg-term-panel px-1 py-0.5 text-term-fg"
          >
            <option value="all">all jobs</option>
            {[...k.jobs].reverse().map((j) => (
              <option key={j.id} value={j.id}>
                {j.id}
                {j.name ? ` ${j.name}` : ""}
              </option>
            ))}
          </select>
        </label>
      </nav>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="min-h-0 flex-1 overflow-auto p-3">
          {tab === "Processes" && <ProcessTable processes={procs} now={now} onSelect={setInspect} />}
          {tab === "Task Graph" && <TaskGraph processes={[...k.processes.values()].filter((p) => p.jobId === graphJob)} jobId={graphJob} onSelect={setInspect} />}
          {tab === "IPC" && <IpcView messages={k.messages.filter((m) => jobId === "all" || m.jobId === jobId)} processes={procs} onSelect={setInspect} />}
          {tab === "Sandboxes" && <SandboxesView processes={procs} provider={s?.sandbox ?? null} onSelect={setInspect} />}
          {tab === "Traces" && <TracesView events={k.events} jobs={k.jobs} initialJob={graphJob} onSelect={setInspect} />}
        </section>
        <aside
          className={`flex min-h-0 flex-col border-t border-term-line lg:border-t-0 lg:border-l ${tab === "Traces" ? "lg:w-[26%]" : "lg:w-[42%]"}`}
        >
          <EventStream events={events} onSelect={setInspect} />
        </aside>
      </main>

      {newJob && (
        <NewJob
          {...(s?.provider ? { provider: s.provider } : {})}
          onClose={() => setNewJob(false)}
          onSubmitted={(res) => {
            setNewJob(false);
            setJobId(res.jobId);
            setTab("Processes");
            const first = Object.values(res.pids)[0];
            if (first) setInspect(first);
          }}
        />
      )}

      {inspect && k.processes.get(inspect) && (
        <Inspector process={k.processes.get(inspect)!} events={k.events} now={now} onClose={() => setInspect(undefined)} onSelect={setInspect} />
      )}
    </div>
  );
}
