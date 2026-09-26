import type { KernelEvent, ProcessStatus } from "@kernelagent/kernel/types";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";

export const STATE_COLOR: Record<ProcessStatus, string> = {
  NEW: "text-term-dim",
  READY: "text-amber-700 dark:text-amber-300",
  RUNNING: "text-emerald-700 dark:text-emerald-400",
  WAITING: "text-sky-700 dark:text-sky-400",
  TERMINATED: "text-term-dim",
  FAILED: "text-red-700 dark:text-red-400",
};

export const STATE_FILL: Record<ProcessStatus, string> = {
  NEW: "#3f3f46",
  READY: "#b58b1b",
  RUNNING: "#1f9d6b",
  WAITING: "#2f7bb5",
  TERMINATED: "#2a2f33",
  FAILED: "#a33a3a",
};

/** State colors for dots and bars that follow the theme (status palette plus neutrals). */
export const STATE_DOT: Record<ProcessStatus, string> = {
  NEW: "var(--chart-axis)",
  READY: "var(--status-warning)",
  RUNNING: "var(--status-good)",
  WAITING: "var(--series-1)",
  TERMINATED: "color-mix(in oklab, var(--dim) 45%, transparent)",
  FAILED: "var(--status-critical)",
};

export const hhmmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

export const clock = (t: number) => new Date(t).toTimeString().slice(0, 8);

/**
 * CPU* is NOT real CPU. It is runtime utilization: the share of the process's lifetime
 * (since first dispatch) that it spent RUNNING rather than READY or WAITING.
 */
export function cpuStar(p: ReplayedProcess, now: number): number | undefined {
  if (p.startedAt === undefined) return undefined;
  const end = p.completedAt ?? now;
  const running = p.runtimeMs + (p.runningSince !== undefined ? now - p.runningSince : 0);
  const life = end - p.startedAt;
  return life <= 0 ? (p.status === "RUNNING" ? 100 : 0) : Math.min(100, Math.round((running / life) * 100));
}

type P = Record<string, any>;

/** One-line description of an event for the stream tail. */
export function describe(e: KernelEvent): string {
  const p = e.payload as P;
  switch (e.type) {
    case "STATE_CHANGE":
      return `${p.from} -> ${p.to}${p.reason ? `  (${p.reason})` : ""}`;
    case "SYSCALL": {
      const t = p.request?.type ?? "?";
      const via = p.capability ? ` via ${p.capability.type}${p.capability.scope ? `(${p.capability.scope})` : ""}` : "";
      const status = p.denied ? "  DENIED" : p.ok ? "" : `  ${p.code ?? "ERR"}`;
      return `syscall(${t}${via})${status}`;
    }
    case "LLM_CALL":
      return `llm(${p.model}) in=${p.inputTokens}${p.cacheReadTokens ? ` (cached ${p.cacheReadTokens})` : ""} out=${p.outputTokens} $${Number(p.costUsd ?? 0).toFixed(5)}`;
    case "PROCESS_CREATED":
      return `create ${p.role}${p.parentPid ? ` (child of ${p.parentPid})` : ""}: ${p.goal}`;
    case "PROCESS_SCHEDULED":
      return `schedule prio=${Number(p.effectivePriority).toFixed(2)} queue=${p.queueDepth}`;
    case "BLOCKED":
      return `blocked on ${p.reason}`;
    case "MESSAGE":
      return `send -> PID ${p.to}: ${String(p.body).slice(0, 60)}`;
    case "CHECKPOINT":
      return `checkpoint${p.note ? `: ${p.note}` : ""}`;
    case "PROCESS_EXIT":
      return p.killed ? "exit (killed)" : `exit: ${String(p.result ?? "").slice(0, 80)}`;
    case "PROCESS_CRASH":
      return `crash: ${p.error ?? p.reason}`;
    case "ARTIFACT":
      return `file saved: ${p.path} (${p.size} B)`;
    case "JOB_SUBMITTED":
      return `job submitted${p.spec?.name ? ` (${p.spec.name})` : ""}`;
    default:
      return JSON.stringify(p).slice(0, 80);
  }
}
