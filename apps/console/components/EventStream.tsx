"use client";
import { useEffect, useRef, useState } from "react";
import type { KernelEvent } from "@kernelagent/kernel/types";
import { clock, describe } from "@/lib/format";

const TYPE_COLOR: Partial<Record<KernelEvent["type"], string>> = {
  SYSCALL: "text-violet-300",
  LLM_CALL: "text-cyan-300",
  STATE_CHANGE: "text-term-fg",
  BLOCKED: "text-sky-400",
  MESSAGE: "text-amber-200",
  PROCESS_CRASH: "text-red-400",
  PROCESS_EXIT: "text-emerald-300",
  CHECKPOINT: "text-lime-300",
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
      <div className="flex items-center gap-3 border-b border-term-line px-3 py-1.5 text-term-dim">
        <span className="text-term-fg">Event Stream</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter: type or pid"
          className="w-40 border border-term-line bg-term-panel px-1 text-term-fg placeholder:text-term-dim"
        />
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow
        </label>
      </div>
      <div ref={box} className="min-h-[12rem] flex-1 overflow-auto px-3 py-1 whitespace-pre">
        {tail.map((e) => (
          <div key={e.sequence} className={TYPE_COLOR[e.type] ?? "text-term-dim"}>
            <span className="text-term-dim">{clock(e.timestamp)} </span>
            {e.pid ? (
              <button className="text-term-accent hover:underline" onClick={() => onSelect(e.pid!)}>
                PID {e.pid.padEnd(4)}
              </button>
            ) : (
              <span className="text-term-dim">{"job".padEnd(8)}</span>
            )}{" "}
            {describe(e)}
          </div>
        ))}
      </div>
    </>
  );
}
