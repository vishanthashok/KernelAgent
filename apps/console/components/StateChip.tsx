import type { ProcessStatus } from "@kernelagent/kernel/types";

const STYLE: Record<ProcessStatus, { dot: string; chip: string }> = {
  NEW: { dot: "bg-zinc-400", chip: "bg-zinc-400/10 text-term-dim" },
  READY: { dot: "bg-amber-300", chip: "bg-warn/10 text-warn" },
  RUNNING: { dot: "bg-emerald-400 animate-pulse", chip: "bg-ok/10 text-ok" },
  WAITING: { dot: "bg-sky-400", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  TERMINATED: { dot: "bg-zinc-500", chip: "bg-ink/5 text-term-dim" },
  FAILED: { dot: "bg-red-400", chip: "bg-danger/10 text-danger" },
};

export function StateChip({ status, detail }: { status: ProcessStatus; detail?: string | undefined }) {
  const s = STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] tracking-wide ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status.toLowerCase()}
      {detail ? <span className="opacity-60">· {detail}</span> : null}
    </span>
  );
}
