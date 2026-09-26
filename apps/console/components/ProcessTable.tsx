"use client";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import { cpuStar } from "@/lib/format";
import { StateChip } from "./StateChip";

const HEAD = ["PID", "Process", "State", "Tokens", "CPU*", "Sandbox", "Cost", "Retry"];
const RIGHT = new Set(["Tokens", "CPU*", "Cost", "Retry"]);

export function ProcessTable({
  processes,
  now,
  onSelect,
  onNewJob,
}: {
  processes: ReplayedProcess[];
  now: number;
  onSelect: (pid: string) => void;
  onNewJob?: () => void;
}) {
  const rows = [...processes].sort((a, b) => Number(b.pid) - Number(a.pid));
  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
        <div className="label-caps">No processes yet</div>
        <p className="mt-3 max-w-sm text-term-dim">Start a job to spawn agents. Each one shows up here with its state, tokens, and sandbox.</p>
        {onNewJob && (
          <button onClick={onNewJob} className="pill pill-light mt-6">
            Run a job
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            {HEAD.map((h) => (
              <th key={h} className={`label-caps px-3 pb-3 font-normal ${RIGHT.has(h) ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono text-[12.5px]">
          {rows.map((p) => {
            const cpu = cpuStar(p, now);
            return (
              <tr
                key={p.pid}
                onClick={() => onSelect(p.pid)}
                className="cursor-pointer border-t border-ink/[0.06] transition-colors hover:bg-ink/[0.04]"
              >
                <td className="px-3 py-3 text-term-accent">{p.pid}</td>
                <td className="px-3 py-3 font-sans text-sm">
                  <div className="font-medium">
                    {p.parentPid ? <span className="text-term-dim">↳ </span> : null}
                    {p.role}
                  </div>
                  <div className="max-w-[22rem] truncate text-xs text-term-dim">{p.goal}</div>
                </td>
                <td className="px-3 py-3">
                  <StateChip status={p.status} detail={p.error === "KILLED" ? "killed" : p.waitingOn?.toLowerCase()} />
                </td>
                <td className="px-3 py-3 text-right">{p.tokensUsed.toLocaleString()}</td>
                <td className="px-3 py-3 text-right">{cpu === undefined ? "–" : `${cpu}%`}</td>
                <td className="px-3 py-3 text-term-dim">{p.sandboxId ? p.sandboxId.slice(0, 14) : "–"}</td>
                <td className="px-3 py-3 text-right text-term-dim">${p.costUsd.toFixed(4)}</td>
                <td className="px-3 py-3 text-right text-term-dim">
                  {p.retryCount}/{p.maxRetries}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
