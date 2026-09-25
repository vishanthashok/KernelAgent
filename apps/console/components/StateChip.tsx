import type { ProcessStatus } from "@kernelagent/kernel/types";

const STYLE: Record<ProcessStatus, { dot: string; chip: string }> = {
  NEW: { dot: "bg-zinc-400", chip: "bg-zinc-400/10 text-zinc-300" },
  READY: { dot: "bg-amber-300", chip: "bg-amber-300/10 text-amber-200" },
  RUNNING: { dot: "bg-emerald-400 animate-pulse", chip: "bg-emerald-400/10 text-emerald-300" },
  WAITING: { dot: "bg-sky-400", chip: "bg-sky-400/10 text-sky-300" },
  TERMINATED: { dot: "bg-zinc-500", chip: "bg-white/5 text-zinc-300" },
  FAILED: { dot: "bg-red-400", chip: "bg-red-400/10 text-red-300" },
};

export function StateChip({ status, detail }: { status: ProcessStatus; detail?: string | undefined }) {
  const s = STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] tracking-wide ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status.toLowerCase()}
      {detail ? <span className="opacity-60">· {detail}</span> : null}
    </span>
  );
}
