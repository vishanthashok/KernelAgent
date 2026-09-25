"use client";
import { useState } from "react";
import { api, type SubmitResult } from "@/lib/api";
import codingTask from "../../../examples/coding-task/job.json";
import researchPipeline from "../../../examples/research-pipeline/job.json";
import approvalGate from "../../../examples/approval-gate.json";

const EXAMPLES = [
  { label: "research pipeline", spec: researchPipeline, hint: "planner, 2 researchers, reviewer, fact-checker" },
  { label: "coding task", spec: codingTask, hint: "writes and runs a Python program" },
  { label: "approval gate", spec: approvalGate, hint: "waits for you to approve a command" },
];

const PERMISSIONS = [
  { key: "files", label: "read and write files", caps: [{ type: "FS_READ" }, { type: "FS_WRITE" }] },
  { key: "exec", label: "run shell commands", caps: [{ type: "EXEC" }] },
  { key: "spawn", label: "start sub-agents", caps: [{ type: "SPAWN" }] },
  { key: "ipc", label: "send and receive messages", caps: [{ type: "SEND" }, { type: "RECEIVE" }] },
] as const;

type PermKey = (typeof PERMISSIONS)[number]["key"];

export function NewJob({
  provider,
  onClose,
  onSubmitted,
}: {
  provider?: string;
  onClose: () => void;
  onSubmitted: (res: SubmitResult) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [role, setRole] = useState("assistant");
  const [budget, setBudget] = useState(60000);
  const [perms, setPerms] = useState<Record<PermKey, boolean>>({ files: true, exec: true, spawn: true, ipc: true });
  const [approval, setApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (spec: unknown) => {
    setBusy(true);
    setError(undefined);
    try {
      onSubmitted(await api.submitJob(spec));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runPrompt = () => {
    const goal = prompt.trim();
    if (!goal) return setError("type a prompt first");
    const capabilities = PERMISSIONS.filter((p) => perms[p.key]).flatMap((p) =>
      p.caps.map((c) => (c.type === "EXEC" && approval ? { ...c, requiresApproval: true } : { ...c })),
    );
    void submit({
      name: goal.length > 40 ? goal.slice(0, 40) + "…" : goal,
      process: { role: role.trim() || "assistant", goal, capabilities, tokenBudget: budget },
    });
  };

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-auto bg-black/60 p-4 pt-[10vh]" onClick={onClose}>
      <div className="w-full max-w-2xl border border-term-line bg-term-bg p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-baseline">
          <span className="text-term-accent">NEW JOB</span>
          <button onClick={onClose} className="ml-auto text-term-dim hover:text-term-fg">
            [close]
          </button>
        </div>

        {provider === "mock" && (
          <p className="mb-3 border border-amber-300/40 px-2 py-1 text-amber-200">
            Mock model: a free-text prompt only echoes back. Run an example below, or set LLM_PROVIDER=anthropic and
            ANTHROPIC_API_KEY on the API for real agents.
          </p>
        )}

        <label className="mb-1 block text-term-dim">prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runPrompt();
          }}
          rows={5}
          autoFocus
          placeholder="e.g. Write a Python script that finds the 20 most common words in a paragraph, run it, and report the result."
          className="mb-3 w-full resize-y border border-term-line bg-term-panel p-2 text-term-fg placeholder:text-term-dim"
        />

        <div className="mb-3 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-term-dim">
            role
            <input value={role} onChange={(e) => setRole(e.target.value)} className="w-32 border border-term-line bg-term-panel px-1 text-term-fg" />
          </label>
          <label className="flex items-center gap-2 text-term-dim">
            token budget
            <input
              type="number"
              min={1000}
              step={1000}
              value={budget}
              onChange={(e) => setBudget(Math.max(1000, Number(e.target.value) || 1000))}
              className="w-28 border border-term-line bg-term-panel px-1 text-term-fg"
            />
          </label>
        </div>

        <div className="mb-3">
          <div className="mb-1 text-term-dim">permissions</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="flex items-center gap-1">
                <input type="checkbox" checked={perms[p.key]} onChange={(e) => setPerms({ ...perms, [p.key]: e.target.checked })} />
                {p.label}
              </label>
            ))}
            <label className="flex items-center gap-1 text-amber-200">
              <input type="checkbox" checked={approval} disabled={!perms.exec} onChange={(e) => setApproval(e.target.checked)} />
              ask me before running commands
            </label>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={runPrompt}
            disabled={busy}
            className="border border-term-accent bg-term-accent/10 px-4 py-1 text-term-accent hover:bg-term-accent/20 disabled:opacity-40"
          >
            {busy ? "submitting…" : "run"}
          </button>
          <span className="text-term-dim">ctrl/⌘ + enter</span>
          {error && <span className="text-red-300">{error}</span>}
        </div>

        <div className="border-t border-term-line pt-3">
          <div className="mb-1 text-term-dim">or run an example</div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                disabled={busy}
                onClick={() => void submit(ex.spec)}
                title={ex.hint}
                className="border border-term-line px-2 py-0.5 hover:border-term-accent hover:text-term-accent disabled:opacity-40"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
