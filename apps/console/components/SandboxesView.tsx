"use client";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import { StateChip } from "./StateChip";

export function SandboxesView({ processes, provider, onSelect }: { processes: ReplayedProcess[]; provider: string | null; onSelect: (pid: string) => void }) {
  const rows = processes.filter((p) => p.sandboxId).sort((a, b) => Number(b.pid) - Number(a.pid));
  const live = (p: ReplayedProcess) => p.status !== "TERMINATED" && p.status !== "FAILED";
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-white/[0.06] px-3 py-1 font-mono text-xs">provider: {provider ?? "none"}</span>
        {provider === "local" && (
          <span className="text-sm text-amber-200">LocalSandbox is a temp folder on the host. Development only, not a security boundary.</span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-term-dim">No sandboxes yet. Agents with file or command permissions get one when they start.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <button
              key={p.pid}
              onClick={() => onSelect(p.pid)}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 text-left transition-colors hover:border-white/20"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${live(p) ? "bg-emerald-400" : "bg-zinc-600"}`} />
                <span className="font-mono text-xs text-term-dim">{live(p) ? "active" : "destroyed"}</span>
              </div>
              <div className="mt-3 truncate font-mono text-sm">{p.sandboxId}</div>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span className="font-mono text-term-accent">{p.pid}</span>
                <span className="font-medium">{p.role}</span>
                <span className="ml-auto">
                  <StateChip status={p.status} />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
