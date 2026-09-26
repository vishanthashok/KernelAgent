"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ModelsResponse, Stats } from "@/lib/api";
import type { ChatOptions, Effort } from "@/lib/chats";
import { PERMISSIONS } from "@/lib/permissions";
import type { ModelsState, ResolvedModel } from "@/lib/useModels";
import { KEY_PROVIDERS, maskKey, PROVIDER_LABEL } from "@/lib/userKey";

export function Composer({
  options,
  onOptions,
  onSend,
  onStop,
  running,
  stats,
  models,
  keyState,
  model,
}: {
  options: ChatOptions;
  onOptions: (o: ChatOptions) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  running: boolean;
  stats?: Stats | undefined;
  models?: ModelsResponse | undefined;
  keyState?: ModelsState | undefined;
  model?: ResolvedModel | undefined;
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
  const hasKey = Object.keys(keyState?.keys ?? {}).length > 0;
  // Nothing runs until the user adds a key: the server has none and this browser has none that work.
  const needsKey = !!models?.acceptsUserKeys && list.length === 0 && (!!models.requiresUserKey || hasKey);
  const stale = !!options.model && list.length > 0 && !list.some((m) => m.id === options.model);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      {advanced && (
        <div className="card mb-2 p-5">
          <div className="mb-4 flex items-center">
            <div className="label-caps">Advanced</div>
            <span className="ml-auto font-mono text-[11px] text-term-dim">
              {stats ? `${stats.provider} / ${model?.id ?? stats.model} · sandbox ${stats.sandbox ?? "none"}` : ""}
            </span>
          </div>
          <div className="mb-4 flex flex-wrap gap-5">
            <label className="flex items-center gap-3">
              <span className="label-caps">Model</span>
              <ModelSelect options={options} onOptions={onOptions} models={models} className="border border-ink/15 bg-sunk/30 px-3 py-1.5 text-sm" />
            </label>
            <label className="flex items-center gap-3" title="Lower effort thinks less and uses fewer tokens. Default is the model's own setting.">
              <span className="label-caps">Effort</span>
              <select
                value={options.effort ?? ""}
                onChange={(e) => {
                  const { effort: _drop, ...rest } = options;
                  onOptions(e.target.value ? { ...rest, effort: e.target.value as Effort } : rest);
                }}
                className="border border-ink/15 bg-sunk/30 px-3 py-1.5 text-sm"
              >
                <option value="">Default</option>
                <option value="low">Low · cheapest</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="flex items-center gap-3">
              <span className="label-caps">Role</span>
              <input
                value={options.role}
                onChange={(e) => onOptions({ ...options, role: e.target.value })}
                className="w-36 border border-ink/15 bg-sunk/30 px-3 py-1.5 text-sm"
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
                className="w-32 border border-ink/15 bg-sunk/30 px-3 py-1.5 font-mono text-sm"
              />
            </label>
          </div>
          {models?.acceptsUserKeys && <KeysSummary state={keyState} />}
          <div className="label-caps mb-2">Permissions</div>
          <div className="flex flex-wrap gap-2">
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="flex cursor-pointer items-center gap-2 rounded border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-sm hover:border-ink/25">
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
            <label className="flex cursor-pointer items-center gap-2 rounded border border-warn/30 px-3 py-1.5 text-sm text-warn">
              <input
                type="checkbox"
                checked={options.approval}
                disabled={!options.perms.exec}
                onChange={(e) => onOptions({ ...options, approval: e.target.checked })}
              />
              Ask me before running commands
            </label>
            <label
              className="flex cursor-pointer items-center gap-2 rounded border border-ink/10 px-3 py-1.5 text-sm"
              title="Agents share a memory for this chat. Each answer is saved to it, so follow-ups keep context without resending the whole conversation."
            >
              <input type="checkbox" checked={options.memory} onChange={(e) => onOptions({ ...options, memory: e.target.checked })} />
              Chat memory
            </label>
            <label
              className="flex cursor-pointer items-center gap-2 rounded border border-ok/30 px-3 py-1.5 text-sm text-ok"
              title="Sub-agents do narrow tasks. Running them at low effort cuts their token use."
            >
              <input type="checkbox" checked={options.cheapSubagents} onChange={(e) => onOptions({ ...options, cheapSubagents: e.target.checked })} />
              Sub-agents at low effort
            </label>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-ink/15 bg-term-panel px-4 pt-3 pb-2.5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] focus-within:border-ink/30">
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
            className={`rounded px-3 py-1 text-xs transition-colors ${advanced ? "bg-ink/15 text-term-fg" : "text-term-dim hover:bg-ink/10 hover:text-term-fg"}`}
          >
            Advanced
          </button>
          <ModelSelect
            options={options}
            onOptions={onOptions}
            models={models}
            className="max-w-[12rem] cursor-pointer truncate rounded border-0 bg-transparent px-2 py-1 text-xs text-term-dim hover:bg-ink/10 hover:text-term-fg"
          />
          <span className="hidden font-mono text-[11px] text-term-dim sm:inline">
            {options.role} · {perms}/4 perms · {Math.round(options.tokenBudget / 1000)}k tokens
            {options.effort ? ` · ${options.effort} effort` : ""}
            {options.memory ? " · memory" : ""}
            {options.approval ? " · approval on" : ""}
          </span>
          {running ? (
            <button onClick={onStop} className="ml-auto flex h-9 w-9 items-center justify-center rounded-md bg-accent text-on-accent hover:bg-accent/85" title="Stop">
              <span className="h-3 w-3 rounded-[2px] bg-on-accent" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!text.trim()}
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-md bg-accent text-on-accent transition-opacity hover:bg-accent/85 disabled:opacity-30"
              title="Send"
            >
              ↑
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-term-dim">
        {needsKey ? (
          <span className="text-warn">
            {hasKey ? "Your keys did not list any models. " : "This server runs on your own API key. "}
            <Link href="/connect" className="underline">
              {hasKey ? "Check your keys" : "Add a Claude or OpenAI key"}
            </Link>
            .
          </span>
        ) : stale
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
  const groups: [string, typeof list][] = [];
  for (const m of list) {
    const p = m.provider ?? models?.provider ?? "";
    const g = groups.find(([k]) => k === p);
    if (g) g[1].push(m);
    else groups.push([p, [m]]);
  }
  const option = (m: { id: string; name: string }) => (
    <option key={m.id} value={m.id}>
      {m.name}
      {m.name !== m.id ? ` · ${m.id}` : ""}
    </option>
  );
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
      {groups.length > 1
        ? groups.map(([provider, ms]) => (
            <optgroup key={provider} label={PROVIDER_NAME[provider] ?? provider}>
              {ms.map(option)}
            </optgroup>
          ))
        : list.map(option)}
    </select>
  );
}

const PROVIDER_NAME: Record<string, string> = { anthropic: "Claude", openai: "OpenAI" };

/** Which keys this browser holds. Keys are added and checked on /connect. */
function KeysSummary({ state }: { state?: ModelsState | undefined }) {
  const keys = state?.keys ?? {};
  return (
    <div className="mb-4 rounded-md border border-ink/10 bg-sunk/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-caps">Your API keys</span>
        <Link href="/connect" className="ml-auto text-xs text-accent underline">
          Manage keys
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px]">
        {KEY_PROVIDERS.map((p) => (
          <span key={p} className={state?.errors?.[p] ? "text-danger" : keys[p] ? "text-ok" : "text-term-dim"}>
            {PROVIDER_LABEL[p]}: {keys[p] ? `${maskKey(keys[p])}${state?.errors?.[p] ? " (rejected)" : ""}` : "none"}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-term-dim">
        Stored in this browser only. The API holds a key in memory while your job runs and never writes it to the log or database.
      </p>
    </div>
  );
}
