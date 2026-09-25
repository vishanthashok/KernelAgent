// Human-readable event log formatting for the CLI tools.
import type { KernelEvent } from "@kernelagent/kernel";

export function formatLog(events: KernelEvent[]): string {
  return events
    .map((e) => {
      const t = new Date(e.timestamp).toISOString().slice(11, 23);
      const pid = e.pid ? `PID ${e.pid}` : "      ";
      return `${String(e.sequence).padStart(5)} ${t} ${pid.padEnd(8)} ${e.type.padEnd(17)} ${summarize(e)}`;
    })
    .join("\n");
}

function summarize(e: KernelEvent): string {
  const p = e.payload as Record<string, any>;
  switch (e.type) {
    case "STATE_CHANGE":
      return `${p.from} -> ${p.to}${p.reason ? ` (${p.reason})` : ""}`;
    case "LLM_CALL":
      return `${p.model} in=${p.inputTokens} out=${p.outputTokens}`;
    case "SYSCALL": {
      const args = p.request?.args ?? {};
      const target = args.path ?? args.cmd ?? args.to ?? args.role ?? (args.ms !== undefined ? `${args.ms}ms` : "");
      const status = p.denied ? "DENIED" : p.ok ? "ok" : p.code;
      return `${(p.request?.type ?? "?").padEnd(10)} ${String(target).slice(0, 50).padEnd(20)} ${status}${p.error ? `: ${String(p.error).slice(0, 80)}` : ""}`;
    }
    case "CHECKPOINT":
      return `note=${JSON.stringify(p.note ?? "")} atSequence=${p.atSequence}`;
    case "ARTIFACT":
      return `${p.path} (${p.mime}, ${p.size} B)`;
    case "BLOCKED":
      return `on ${p.reason}`;
    case "MESSAGE":
      return `${p.from} -> ${p.to}: ${JSON.stringify(String(p.body)).slice(0, 70)}`;
    case "PROCESS_CREATED":
      return `${p.role}: ${p.goal}`;
    case "PROCESS_EXIT":
      return p.killed ? "killed" : `result=${JSON.stringify(String(p.result ?? "")).slice(0, 80)}`;
    default:
      return JSON.stringify(p).slice(0, 100);
  }
}
