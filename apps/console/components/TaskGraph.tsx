"use client";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import { STATE_FILL } from "@/lib/format";

const W = 156;
const H = 46;
const GX = 70;
const GY = 18;

/** Layered DAG: a node's column is 1 + the deepest of its dependencies and its parent. */
function layout(procs: ReplayedProcess[]) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const depth = new Map<string, number>();
  const visit = (pid: string, seen = new Set<string>()): number => {
    if (depth.has(pid)) return depth.get(pid)!;
    if (seen.has(pid)) return 0;
    seen.add(pid);
    const p = byPid.get(pid);
    if (!p) return 0;
    const ups = [...p.dependsOn, ...(p.parentPid && byPid.has(p.parentPid) ? [p.parentPid] : [])].filter((d) => byPid.has(d));
    const d = ups.length ? Math.max(...ups.map((u) => visit(u, seen) + 1)) : 0;
    depth.set(pid, d);
    return d;
  };
  procs.forEach((p) => visit(p.pid));
  const cols = new Map<number, ReplayedProcess[]>();
  for (const p of [...procs].sort((a, b) => Number(a.pid) - Number(b.pid))) {
    const d = depth.get(p.pid)!;
    cols.set(d, [...(cols.get(d) ?? []), p]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  const tallest = Math.max(1, ...[...cols.values()].map((c) => c.length));
  for (const [d, col] of cols) {
    const offset = ((tallest - col.length) * (H + GY)) / 2;
    col.forEach((p, i) => pos.set(p.pid, { x: 10 + d * (W + GX), y: 10 + offset + i * (H + GY) }));
  }
  const width = 20 + Math.max(1, cols.size) * (W + GX) - GX;
  const height = 20 + tallest * (H + GY) - GY;
  return { pos, width, height };
}

export function TaskGraph({ processes, jobId, onSelect }: { processes: ReplayedProcess[]; jobId?: string; onSelect: (pid: string) => void }) {
  if (!jobId || processes.length === 0) return <p className="text-term-dim">no job selected</p>;
  const { pos, width, height } = layout(processes);
  const edges: { from: string; to: string; spawn: boolean }[] = [];
  for (const p of processes) {
    for (const d of p.dependsOn) if (pos.has(d)) edges.push({ from: d, to: p.pid, spawn: false });
    if (p.parentPid && pos.has(p.parentPid)) edges.push({ from: p.parentPid, to: p.pid, spawn: true });
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-term-dim">
        <span>job {jobId}</span>
        <span>── depends on</span>
        <span>┄┄ spawned</span>
        {Object.entries(STATE_FILL).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5" style={{ background: c }} />
            {s}
          </span>
        ))}
      </div>
      <div className="overflow-auto">
        <svg width={width} height={height} className="font-mono">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="#6b777c" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const a = pos.get(e.from)!;
            const b = pos.get(e.to)!;
            const x1 = a.x + W;
            const y1 = a.y + H / 2;
            const x2 = b.x;
            const y2 = b.y + H / 2;
            const mx = (x1 + x2) / 2;
            return (
              <path
                key={i}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                fill="none"
                stroke="#6b777c"
                strokeDasharray={e.spawn ? "4 3" : undefined}
                markerEnd="url(#arrow)"
              />
            );
          })}
          {processes.map((p) => {
            const { x, y } = pos.get(p.pid)!;
            return (
              <g key={p.pid} transform={`translate(${x},${y})`} className="cursor-pointer" onClick={() => onSelect(p.pid)}>
                <rect width={W} height={H} rx={3} fill={STATE_FILL[p.status]} stroke={p.status === "RUNNING" ? "#7fd1b9" : "#22282b"} strokeWidth={p.status === "RUNNING" ? 2 : 1} />
                <text x={8} y={17} fill="#e6edef" fontSize={12}>
                  {p.pid} {p.role.slice(0, 14)}
                </text>
                <text x={8} y={34} fill="#c9d1d3" fontSize={11} opacity={0.85}>
                  {p.status}
                  {p.waitingOn ? ` ${p.waitingOn.toLowerCase()}` : ""} · {p.tokensUsed} tok
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
