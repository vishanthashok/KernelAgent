"use client";
import { useState } from "react";
import { api, type SubmitResult } from "@/lib/api";
import { ALL_PERMS, buildCapabilities, PERMISSIONS, type PermKey } from "@/lib/permissions";
import codingTask from "../../../examples/coding-task/job.json";
import researchPipeline from "../../../examples/research-pipeline/job.json";
import approvalGate from "../../../examples/approval-gate.json";

const EXAMPLES = [
  { label: "research pipeline", spec: researchPipeline, hint: "planner, 2 researchers, reviewer, fact-checker" },
  { label: "coding task", spec: codingTask, hint: "writes and runs a Python program" },
  { label: "approval gate", spec: approvalGate, hint: "waits for you to approve a command" },
];



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
  const [perms, setPerms] = useState<Record<PermKey, boolean>>(ALL_PERMS);
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
    const capabilities = buildCapabilities(perms, approval);
    void submit({
      name: goal.length > 40 ? goal.slice(0, 40) + "…" : goal,
      process: { role: role.trim() || "assistant", goal, capabilities, tokenBudget: budget },
    });
  };

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-2xl p-7" style={{ background: "#0f1318" }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 flex items-start">
          <div>
            <div className="label-caps">New job</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">What should the agent do?</h2>
          </div>
          <button onClick={onClose} className="pill pill-ghost ml-auto px-3 py-1 text-xs">
            Close
          </button>
        </div>

        {provider === "mock" && (
          <p className="mb-5 rounded-xl border border-amber-300/30 bg-amber-300/5 px-4 py-3 text-sm text-amber-200">
            Mock model: a free-text prompt only echoes back. Run an example below, or set LLM_PROVIDER=anthropic and
            ANTHROPIC_API_KEY on the API for real agents.
          </p>
        )}

        <label className="label-caps mb-2 block">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runPrompt();
          }}
          rows={5}
          autoFocus
          placeholder="e.g. Write a Python script that finds the 20 most common words in a paragraph, run it, and report the result."
          className="mb-5 w-full resize-y border border-white/15 bg-black/30 p-4 text-base leading-relaxed placeholder:text-term-dim focus:border-white/40 focus:outline-none"
        />

        <div className="mb-5 flex flex-wrap gap-6">
          <label className="flex items-center gap-3">
            <span className="label-caps">Role</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} className="w-36 border border-white/15 bg-black/30 px-3 py-1.5" />
          </label>
          <label className="flex items-center gap-3">
            <span className="label-caps">Budget</span>
            <input
              type="number"
              min={1000}
              step={1000}
              value={budget}
              onChange={(e) => setBudget(Math.max(1000, Number(e.target.value) || 1000))}
              className="w-32 border border-white/15 bg-black/30 px-3 py-1.5 font-mono"
            />
          </label>
        </div>

        <div className="mb-6">
          <div className="label-caps mb-2">Permissions</div>
          <div className="flex flex-wrap gap-2">
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm hover:border-white/25">
                <input type="checkbox" checked={perms[p.key]} onChange={(e) => setPerms({ ...perms, [p.key]: e.target.checked })} />
                {p.label}
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 rounded-full border border-amber-300/30 px-3 py-1.5 text-sm text-amber-200">
              <input type="checkbox" checked={approval} disabled={!perms.exec} onChange={(e) => setApproval(e.target.checked)} />
              ask me before running commands
            </label>
          </div>
        </div>

        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={runPrompt}
            disabled={busy}
            className="pill pill-light disabled:opacity-40"
          >
            {busy ? "Starting…" : "Run agent"}
          </button>
          <span className="font-mono text-xs text-term-dim">⌘/Ctrl + Enter</span>
          {error && <span className="text-sm text-red-300">{error}</span>}
        </div>

        <div className="border-t border-white/10 pt-5">
          <div className="label-caps mb-3">Or run an example</div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                disabled={busy}
                onClick={() => void submit(ex.spec)}
                title={ex.hint}
                className="pill pill-ghost text-sm disabled:opacity-40"
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
