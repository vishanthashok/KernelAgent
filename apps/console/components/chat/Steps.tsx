"use client";
import { useState } from "react";
import type { Step } from "@/lib/steps";

const TONE: Record<Step["tone"], string> = {
  thought: "text-term-fg/80",
  action: "text-term-dim",
  warn: "text-warn",
  error: "text-danger",
  file: "text-ok",
};

const DOT: Record<Step["tone"], string> = {
  thought: "bg-ink/40",
  action: "bg-ink/20",
  warn: "bg-amber-300",
  error: "bg-red-400",
  file: "bg-emerald-400",
};

/** Collapsible list of what the agent did. Open while running, closed once done. */
export function Steps({ steps, running, multiAgent }: { steps: Step[]; running: boolean; multiAgent: boolean }) {
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const isOpen = open ?? running;
  const [expanded, setExpanded] = useState<number | undefined>();
  if (steps.length === 0 && !running) return null;

  return (
    <div className="mb-3">
      <button onClick={() => setOpen(!isOpen)} className="flex items-center gap-2 text-sm text-term-dim hover:text-term-fg">
        {running ? <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> : <span className="text-xs">{isOpen ? "▾" : "▸"}</span>}
        <span>{running ? "Working" : `${steps.length} step${steps.length === 1 ? "" : "s"}`}</span>
        {running && steps.length > 0 && <span className="max-w-[28rem] truncate text-term-dim/70">· {steps[steps.length - 1]!.text}</span>}
      </button>
      {isOpen && steps.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-l border-ink/10 pl-4">
          {steps.map((s) => (
            <li key={s.seq} className="relative">
              <span className={`absolute top-[0.55em] -left-[1.2rem] h-1.5 w-1.5 rounded-full ${DOT[s.tone]}`} />
              <div className={`text-sm leading-relaxed ${TONE[s.tone]} ${s.tone === "thought" ? "italic" : ""}`}>
                {multiAgent && s.pid && <span className="mr-2 font-mono text-xs not-italic text-term-accent">{s.pid}</span>}
                <span className="whitespace-pre-wrap">{s.text}</span>
                {s.detail && (
                  <button onClick={() => setExpanded(expanded === s.seq ? undefined : s.seq)} className="ml-2 text-xs text-term-dim underline not-italic">
                    {expanded === s.seq ? "hide output" : "show output"}
                  </button>
                )}
              </div>
              {s.detail && expanded === s.seq && (
                <pre className="mt-1.5 max-h-64 overflow-auto rounded-lg border border-ink/10 bg-sunk/40 p-3 font-mono text-[12px] whitespace-pre-wrap text-term-dim">
                  {s.detail}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
