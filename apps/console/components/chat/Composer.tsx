"use client";
import { useEffect, useRef, useState } from "react";
import type { ModelsResponse, Stats } from "@/lib/api";
import type { ChatOptions } from "@/lib/chats";
import { PERMISSIONS } from "@/lib/permissions";

export function Composer({
  options,
  onOptions,
  onSend,
  onStop,
  running,
  stats,
  models,
}: {
  options: ChatOptions;
  onOptions: (o: ChatOptions) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  running: boolean;
  stats?: Stats | undefined;
  models?: ModelsResponse | undefined;
}) {
  const [text, setText] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t || running) return;
    onSend(t);
    setText("");
  };

  const perms = Object.values(options.perms).filter(Boolean).length;
  const list = models?.models ?? [];
  const stale = !!options.model && list.length > 0 && !list.some((m) => m.id === options.model);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      {advanced && (
        <div className="card mb-2 p-5" style={{ background: "#11161d" }}>
          <div className="mb-4 flex items-center">
            <div className="label-caps">Advanced</div>
            <span className="ml-auto font-mono text-[11px] text-term-dim">
              {stats ? `${stats.provider} / ${stats.model} · sandbox ${stats.sandbox ?? "none"}` : ""}
            </span>
          </div>
          <div className="mb-4 flex flex-wrap gap-5">
            <label className="flex items-center gap-3">
              <span className="label-caps">Model</span>
              <ModelSelect options={options} onOptions={onOptions} models={models} className="border border-white/15 bg-black/30 px-3 py-1.5 text-sm" />
            </label>
            <label className="flex items-center gap-3">
              <span className="label-caps">Role</span>
              <input
                value={options.role}
                onChange={(e) => onOptions({ ...options, role: e.target.value })}
                className="w-36 border border-white/15 bg-black/30 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="flex items-center gap-3">
              <span className="label-caps">Token budget</span>
              <input
                type="number"
                min={1000}
                step={1000}
                value={options.tokenBudget}
                onChange={(e) => onOptions({ ...options, tokenBudget: Math.max(1000, Number(e.target.value) || 1000) })}
                className="w-32 border border-white/15 bg-black/30 px-3 py-1.5 font-mono text-sm"
              />
            </label>
          </div>
          <div className="label-caps mb-2">Permissions</div>
          <div className="flex flex-wrap gap-2">
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm hover:border-white/25">
                <input
                  type="checkbox"
                  checked={options.perms[p.key]}
                  onChange={(e) => onOptions({ ...options, perms: { ...options.perms, [p.key]: e.target.checked } })}
                />
                {p.label}
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-full border border-amber-300/30 px-3 py-1.5 text-sm text-amber-200">
              <input
                type="checkbox"
                checked={options.approval}
                disabled={!options.perms.exec}
                onChange={(e) => onOptions({ ...options, approval: e.target.checked })}
              />
              Ask me before running commands
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-sm">
              <input type="checkbox" checked={options.history} onChange={(e) => onOptions({ ...options, history: e.target.checked })} />
              Include conversation history
            </label>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-white/15 bg-[#141a22] px-4 pt-3 pb-2.5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] focus-within:border-white/30">
        <textarea
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Ask your agents to do something…"
          className="block max-h-60 w-full resize-none rounded-none border-0 bg-transparent py-1 text-[15px] leading-relaxed placeholder:text-term-dim focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => setAdvanced(!advanced)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${advanced ? "bg-white/15 text-term-fg" : "text-term-dim hover:bg-white/10 hover:text-term-fg"}`}
          >
            Advanced
          </button>
          <ModelSelect
            options={options}
            onOptions={onOptions}
            models={models}
            className="max-w-[12rem] cursor-pointer truncate rounded-full border-0 bg-transparent px-2 py-1 text-xs text-term-dim hover:bg-white/10 hover:text-term-fg"
          />
          <span className="hidden font-mono text-[11px] text-term-dim sm:inline">
            {options.role} · {perms}/4 perms · {Math.round(options.tokenBudget / 1000)}k tokens{options.approval ? " · approval on" : ""}
          </span>
          {running ? (
            <button onClick={onStop} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white text-black hover:bg-white/80" title="Stop">
              <span className="h-3 w-3 rounded-[2px] bg-black" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!text.trim()}
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-opacity hover:bg-white/80 disabled:opacity-30"
              title="Send"
            >
              ↑
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-term-dim">
        {stale
          ? `${options.model} is not available on this API. Messages use ${models?.default} until you pick another model.`
          : stats?.provider === "mock"
          ? "Mock model: free-text prompts only echo back. Set LLM_PROVIDER=anthropic on the API for real agents."
          : "Each message runs as a sandboxed agent job. Agents can make mistakes."}
      </p>
    </div>
  );
}

/** Model picker. "Default" defers to the API's configured model. */
function ModelSelect({
  options,
  onOptions,
  models,
  className,
}: {
  options: ChatOptions;
  onOptions: (o: ChatOptions) => void;
  models?: ModelsResponse | undefined;
  className: string;
}) {
  const list = models?.models ?? [];
  const current = options.model ?? "";
  const nameOf = (id: string) => list.find((m) => m.id === id)?.name ?? id;
  return (
    <select
      value={current}
      disabled={list.length === 0}
      onChange={(e) => {
        const { model: _drop, ...rest } = options;
        onOptions(e.target.value ? { ...rest, model: e.target.value } : rest);
      }}
      title="Model"
      className={className}
    >
      <option value="">{models ? `Default · ${nameOf(models.default)}` : "Default model"}</option>
      {current && !list.some((m) => m.id === current) && <option value={current}>{current} (unavailable)</option>}
      {list.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
          {m.name !== m.id ? ` · ${m.id}` : ""}
        </option>
      ))}
    </select>
  );
}
