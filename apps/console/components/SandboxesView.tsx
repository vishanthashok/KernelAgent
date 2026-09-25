"use client";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import { STATE_COLOR } from "@/lib/format";

export function SandboxesView({ processes, provider, onSelect }: { processes: ReplayedProcess[]; provider: string | null; onSelect: (pid: string) => void }) {
  const rows = processes.filter((p) => p.sandboxId).sort((a, b) => Number(b.pid) - Number(a.pid));
  const live = (p: ReplayedProcess) => p.status !== "TERMINATED" && p.status !== "FAILED";
  return (
    <div>
      <p className="mb-2 text-term-dim">
        provider: {provider ?? "none"}
        {provider === "local" ? "  (LocalSandbox is a temp directory on the host: development only, not a security boundary)" : ""}
      </p>
      <table className="whitespace-pre">
        <thead className="text-term-dim">
          <tr>
            {["SANDBOX", "STATUS", "OWNER", "ROLE", "PROCESS STATE"].map((h) => (
              <th key={h} className="px-2 text-left font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.pid} className="border-t border-term-line/50">
              <td className="px-2">{p.sandboxId}</td>
              <td className={`px-2 ${live(p) ? "text-emerald-400" : "text-term-dim"}`}>{live(p) ? "active" : "destroyed"}</td>
              <td className="px-2">
                <button className="text-term-accent hover:underline" onClick={() => onSelect(p.pid)}>
                  PID {p.pid}
                </button>
              </td>
              <td className="px-2">{p.role}</td>
              <td className={`px-2 ${STATE_COLOR[p.status]}`}>{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-term-dim">no sandboxes have been used yet</p>}
    </div>
  );
}
