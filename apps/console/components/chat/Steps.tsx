"use client";
// What the agent did, as a quiet timeline. Open while it works, folded to "N steps" after.
import { useState } from "react";
import type { Step } from "@/lib/steps";

export interface StepItem {
  key: string;
  text: string;
  tone: Step["tone"];
  pid?: string;
  detail?: string;
}

const TONE: Record<Step["tone"], string> = {
  thought: "text-term-fg/75",
  action: "text-term-dim",
  warn: "text-warn",
  error: "text-danger",
  file: "text-ok",
};

/** A small glyph per kind of step, read from the step's own words. */
function glyph(s: StepItem): string {
  if (s.tone === "error") return "×";
  if (s.tone === "warn") return "!";
  if (s.tone === "thought") return "·";
  const t = s.text;
  if (/^Wrote/.test(t)) return "✎";
  if (/^Read/.test(t)) return "↳";
  if (/^Ran/.test(t)) return "›";
  if (/sub-agent/.test(t)) return "⎇";
  if (/message/.test(t)) return "✉";
  return "•";
}

export function Steps({ steps, running, multiAgent }: { steps: StepItem[]; running: boolean; multiAgent: boolean }) {
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const isOpen = open ?? running;
  const [expanded, setExpanded] = useState<string | undefined>();
  if (steps.length === 0) return null;

  return (
    <div className="mb-4">
      {!running && (
        <button onClick={() => setOpen(!isOpen)} className="flex items-center gap-1.5 text-[12.5px] text-term-dim hover:text-term-fg">
          <span className="text-[10px]">{isOpen ? "▾" : "▸"}</span>
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </button>
      )}
      {isOpen && (
        <ol className={`space-y-1 ${running ? "" : "mt-2"} border-l border-term-line pl-3.5`}>
          {steps.map((s) => (
            <li key={s.key} className="text-[13px] leading-relaxed">
              <div className={`flex gap-2 ${TONE[s.tone]} ${s.tone === "thought" ? "italic" : ""}`}>
                <span className="w-3 shrink-0 text-center font-mono not-italic opacity-70">{glyph(s)}</span>
                <span className="min-w-0">
                  {multiAgent && s.pid && <span className="mr-2 rounded-[3px] bg-ink/10 px-1 font-mono text-[10.5px] not-italic text-term-fg">{s.pid}</span>}
                  <span className="whitespace-pre-wrap">{s.text}</span>
                  {s.detail && (
                    <button onClick={() => setExpanded(expanded === s.key ? undefined : s.key)} className="ml-2 text-[11.5px] not-italic underline opacity-80">
                      {expanded === s.key ? "hide output" : "output"}
                    </button>
                  )}
                </span>
              </div>
              {s.detail && expanded === s.key && (
                <pre className="mt-1.5 ml-5 max-h-64 overflow-auto rounded-[5px] border border-term-line bg-sunk/30 p-3 font-mono text-[12px] whitespace-pre-wrap text-term-dim">
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
