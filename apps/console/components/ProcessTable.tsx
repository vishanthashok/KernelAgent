"use client";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import { cpuStar, STATE_COLOR } from "@/lib/format";

export function ProcessTable({ processes, now, onSelect }: { processes: ReplayedProcess[]; now: number; onSelect: (pid: string) => void }) {
  const rows = [...processes].sort((a, b) => Number(a.pid) - Number(b.pid));
  return (
    <div>
      <table className="w-full border-collapse whitespace-pre text-left">
        <thead className="text-term-dim">
          <tr>
            {["PID", "PROCESS", "STATE", "TOKENS", "CPU*", "SANDBOX", "COST", "RETRY", "JOB"].map((h) => (
              <th key={h} className={`px-2 py-1 font-normal ${["TOKENS", "CPU*", "COST", "RETRY"].includes(h) ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const cpu = cpuStar(p, now);
            return (
              <tr key={p.pid} onClick={() => onSelect(p.pid)} className="cursor-pointer border-t border-term-line/50 hover:bg-term-panel">
                <td className="px-2 py-0.5 text-term-accent">{p.pid}</td>
                <td className="px-2">
                  {p.parentPid ? "└ " : ""}
                  {p.role}
                </td>
                <td className={`px-2 ${STATE_COLOR[p.status]}`}>
                  {p.status}
                  {p.waitingOn ? <span className="text-term-dim"> {p.waitingOn.toLowerCase()}</span> : null}
                  {p.error === "KILLED" ? <span className="text-term-dim"> killed</span> : null}
                </td>
                <td className="px-2 text-right">{p.tokensUsed}</td>
                <td className="px-2 text-right">{cpu === undefined ? "-" : `${cpu}%`}</td>
                <td className="px-2 text-term-dim">{p.sandboxId ?? "-"}</td>
                <td className="px-2 text-right text-term-dim">${p.costUsd.toFixed(4)}</td>
                <td className="px-2 text-right text-term-dim">
                  {p.retryCount}/{p.maxRetries}
                </td>
                <td className="px-2 text-term-dim">{p.jobId}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-2 py-6 text-term-dim">
                no processes. submit a job: curl -XPOST localhost:4000/jobs -H 'content-type: application/json' -d @examples/hello-dag.json
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-3 text-term-dim">
        * CPU is not real CPU. It is runtime utilization: the share of a process&apos;s life since first dispatch spent RUNNING.
      </p>
    </div>
  );
}
