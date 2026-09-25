// Turn a job's raw events into short, human-readable steps for the chat view.
import type { KernelEvent } from "@kernelagent/kernel/types";

export interface Step {
  seq: number;
  pid?: string;
  text: string;
  tone: "thought" | "action" | "warn" | "error" | "file";
  detail?: string;
}

type P = Record<string, any>;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function syscallStep(p: P): Omit<Step, "seq" | "pid"> | undefined {
  const t = p.request?.type as string | undefined;
  const a = (p.request?.args ?? {}) as P;
  if (!t || t === "EXIT") return undefined;
  if (p.denied) {
    return { text: p.approval === "denied" ? `${t} denied by you` : `Blocked: ${t} needs a permission this agent does not have`, tone: "warn" };
  }
  if (!p.ok) return { text: `${t} failed: ${clip(String(p.error ?? p.code ?? "error"), 160)}`, tone: "error" };
  const r = (p.result ?? {}) as P;
  switch (t) {
    case "FS_WRITE":
      return { text: `Wrote ${a.path}`, tone: "action" };
    case "FS_READ":
      return { text: `Read ${a.path}`, tone: "action" };
    case "EXEC": {
      const detail = [r.stdout, r.stderr ? `stderr:\n${r.stderr}` : ""].filter(Boolean).join("\n").trim();
      return { text: `Ran \`${clip(String(a.cmd), 120)}\` · exit ${r.exitCode}`, tone: r.exitCode === 0 ? "action" : "warn", ...(detail ? { detail } : {}) };
    }
    case "SPAWN":
      return { text: `Started sub-agent "${a.role}" (${r.pid})`, tone: "action" };
    case "SEND":
      return { text: `Sent a message to ${a.to}`, tone: "action" };
    case "RECEIVE":
      return { text: `Received a message from ${r.from}`, tone: "action", ...(r.message ? { detail: String(r.message) } : {}) };
    case "SLEEP":
      return { text: `Waited ${a.ms} ms`, tone: "action" };
    case "CHECKPOINT":
      return { text: "Saved a checkpoint", tone: "action" };
    default:
      return { text: t, tone: "action" };
  }
}

export function stepsFor(events: KernelEvent[], jobId: string): Step[] {
  const out: Step[] = [];
  for (const e of events) {
    if (e.jobId !== jobId) continue;
    const p = e.payload as P;
    const base = { seq: e.sequence, ...(e.pid ? { pid: e.pid } : {}) };
    if (e.type === "LLM_CALL") {
      const text = ((p.response?.content ?? []) as P[])
        .filter((b) => b.type === "text")
        .map((b) => String(b.text))
        .join("\n")
        .trim();
      const onlyText = ((p.response?.content ?? []) as P[]).every((b) => b.type !== "tool_use");
      // A turn with only text is the final answer, shown separately.
      if (text && !onlyText) out.push({ ...base, text: clip(text, 600), tone: "thought" });
    } else if (e.type === "SYSCALL") {
      const s = syscallStep(p);
      if (s) out.push({ ...base, ...s });
    } else if (e.type === "BLOCKED" && p.reason === "APPROVAL") {
      out.push({ ...base, text: "Waiting for your approval", tone: "warn" });
    } else if (e.type === "ARTIFACT") {
      out.push({ ...base, text: `Saved file ${p.path}`, tone: "file" });
    } else if (e.type === "PROCESS_CRASH") {
      out.push({ ...base, text: `Crashed: ${clip(String(p.error ?? p.reason), 200)}`, tone: "error" });
    } else if (e.type === "STATE_CHANGE" && p.to === "FAILED") {
      out.push({ ...base, text: `Failed: ${clip(String(p.error ?? p.reason ?? ""), 200)}`, tone: "error" });
    } else if (e.type === "STATE_CHANGE" && p.from === "FAILED" && p.to === "READY") {
      out.push({ ...base, text: `Retrying (${p.reason})`, tone: "warn" });
    }
  }
  return out;
}

/** The command an agent is waiting to run, if it is blocked on approval. */
export function pendingApproval(events: KernelEvent[], pid: string): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.pid !== pid) continue;
    if (e.type === "BLOCKED" && (e.payload as P).reason === "APPROVAL") {
      const req = (e.payload as P).request as P | undefined;
      return req?.type === "EXEC" ? String(req.args?.cmd) : JSON.stringify(req);
    }
    if (e.type === "SYSCALL") return undefined;
  }
  return undefined;
}
