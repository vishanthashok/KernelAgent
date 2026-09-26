"use client";
import { useEffect, useRef, useState } from "react";
import type { KernelEvent } from "@kernelagent/kernel/types";
import { clock, describe } from "@/lib/format";

const TYPE_COLOR: Partial<Record<KernelEvent["type"], string>> = {
  SYSCALL: "text-violet-700 dark:text-violet-300",
  LLM_CALL: "text-cyan-700 dark:text-cyan-300",
  STATE_CHANGE: "text-term-fg",
  BLOCKED: "text-term-accent",
  MESSAGE: "text-warn",
  PROCESS_CRASH: "text-danger",
  PROCESS_EXIT: "text-ok",
  CHECKPOINT: "text-lime-700 dark:text-lime-300",
};

export function EventStream({ events, onSelect }: { events: KernelEvent[]; onSelect: (pid: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState("");
  const tail = events.slice(-600).filter((e) => !filter || e.type.includes(filter.toUpperCase()) || e.pid === filter);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  });

  return (
    <>
      <div className="border-b border-ink/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-semibold">Event stream</h2>
          <span className="ml-auto font-mono text-[11px] text-term-dim">{events.length.toLocaleString()} events</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by type or pid"
            className="min-w-0 flex-1 border border-ink/15 bg-sunk/30 px-3 py-1.5 text-sm placeholder:text-term-dim"
          />
          <label className="flex items-center gap-2 text-sm text-term-dim">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
          </label>
        </div>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-relaxed">
        {tail.length === 0 && <p className="px-2 py-6 text-center font-sans text-sm text-term-dim">Events appear here as agents run.</p>}
        {tail.map((e) => (
          <div key={e.sequence} className={`flex gap-3 rounded-lg px-2 py-0.5 hover:bg-ink/[0.04] ${TYPE_COLOR[e.type] ?? "text-term-dim"}`}>
            <span className="shrink-0 text-term-dim">{clock(e.timestamp)}</span>
            {e.pid ? (
              <button className="w-14 shrink-0 text-left text-term-accent hover:underline" onClick={() => onSelect(e.pid!)}>
                {e.pid}
              </button>
            ) : (
              <span className="w-14 shrink-0 text-term-dim">job</span>
            )}
            <span className="min-w-0 truncate">{describe(e)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
