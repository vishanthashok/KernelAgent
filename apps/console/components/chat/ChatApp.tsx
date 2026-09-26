"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  DEFAULT_OPTIONS,
  loadChats,
  loadLastModel,
  newId,
  saveChats,
  saveLastModel,
  titleFor,
  type Chat,
  type ChatOptions,
  type ChatTurn,
} from "@/lib/chats";
import { buildCapabilities } from "@/lib/permissions";
import { useKernel } from "@/lib/useKernel";
import { resolveModel, useModels } from "@/lib/useModels";
import { AssistantTurn } from "./AssistantTurn";
import { ChatSidebar } from "./ChatSidebar";
import { Composer } from "./Composer";
import { ApiBanner } from "../ApiBanner";
import { StatsPanel } from "./StatsPanel";
import { AppShell } from "../shell/AppShell";

const STATS_KEY = "kernelagent.statsPanel";

const SUGGESTIONS = [
  "Write a Python script that prints the first 20 prime numbers, run it, and save the script to /output/primes.py",
  "Research cooperative vs preemptive scheduling and write a short report to /output/report.md",
  "Make a CSV of the 10 largest US states by area and save it to /output/states.csv",
];

export function ChatApp() {
  const k = useKernel();
  const modelState = useModels(k.stats?.provider, k.stats?.model);
  const models = modelState.data;
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [draftOptions, setDraftOptions] = useState<ChatOptions>(DEFAULT_OPTIONS);
  const [sidebar, setSidebar] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    // Open by default on wide screens, then remember the choice.
    let pref: string | null = null;
    try {
      pref = localStorage.getItem(STATS_KEY);
    } catch {}
    setStatsOpen(pref ? pref === "open" : window.matchMedia("(min-width: 1280px)").matches);
    const last = loadLastModel();
    if (last) setDraftOptions((o) => ({ ...o, model: last }));
    const c = loadChats();
    setChats(c);
    const latest = [...c].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (latest) setActiveId(latest.id);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveChats(chats);
  }, [chats, loaded]);

  const active = chats.find((c) => c.id === activeId);
  const options = active?.options ?? draftOptions;

  // Keep the thread pinned to the bottom unless the user scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [k.version, active?.turns.length, activeId]);

  const updateChat = (id: string, fn: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const updateTurn = (chatId: string, turnId: string, patch: Partial<ChatTurn>) =>
    updateChat(chatId, (c) => ({ ...c, turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)) }));

  const toggleStats = (open: boolean) => {
    setStatsOpen(open);
    try {
      localStorage.setItem(STATS_KEY, open ? "open" : "closed");
    } catch {}
  };

  const setOptions = (o: ChatOptions) => {
    if (o.model !== options.model) {
      saveLastModel(o.model);
      // New chats start on the model you picked last, wherever you picked it.
      setDraftOptions((d) => {
        const { model: _drop, ...rest } = d;
        return o.model ? { ...rest, model: o.model } : rest;
      });
    }
    if (active) updateChat(active.id, (c) => ({ ...c, options: o }));
    else setDraftOptions(o);
  };

  const currentModel = resolveModel(options.model, models, k.stats?.model);

  const lastTurn = active?.turns[active.turns.length - 1];
  const lastRoot = lastTurn?.rootPid ? k.processes.get(lastTurn.rootPid) : undefined;
  const running =
    !!lastTurn && !lastTurn.error && (!lastRoot || (lastRoot.status !== "TERMINATED" && lastRoot.status !== "FAILED"));

  const send = async (prompt: string) => {
    let chat = active;
    if (!chat) {
      chat = { id: newId(), title: titleFor(prompt), createdAt: Date.now(), updatedAt: Date.now(), turns: [], options };
      const created = chat;
      setChats((cs) => [...cs, created]);
      setActiveId(created.id);
    }
    const chatId = chat.id;
    const turn: ChatTurn = { id: newId(), prompt, createdAt: Date.now() };
    stick.current = true;
    updateChat(chatId, (c) => ({ ...c, updatedAt: Date.now(), turns: [...c.turns, turn] }));
    const opts = chat.options;
    // Send a picked model only if this API offers it. Otherwise the API's default runs.
    const model = opts.model && models?.models.some((m) => m.id === opts.model) ? opts.model : undefined;
    try {
      const res = await api.submitJob({
        name: titleFor(prompt),
        ...(model ? { model } : {}),
        // Context comes from the chat's memory on the API, not a resent transcript.
        ...(opts.memory ? { memoryScope: chatId } : {}),
        ...(opts.effort ? { effort: opts.effort } : {}),
        subagentEffort: opts.cheapSubagents ? "low" : (opts.effort ?? "high"),
        process: {
          role: opts.role.trim() || "assistant",
          goal: prompt,
          capabilities: [...buildCapabilities(opts.perms, opts.approval), ...(opts.memory ? [{ type: "MEMORY" }] : [])],
          tokenBudget: opts.tokenBudget,
        },
      }, model ?? models?.default ?? k.stats?.model);
      updateTurn(chatId, turn.id, { jobId: res.jobId, rootPid: Object.values(res.pids)[0]!, model: model ?? models?.default ?? k.stats?.model });
    } catch (err) {
      updateTurn(chatId, turn.id, { error: (err as Error).message });
    }
  };

  const stop = () => {
    if (lastTurn?.rootPid) void api.kill(lastTurn.rootPid).catch(() => undefined);
  };

  const newChat = () => {
    setActiveId(undefined);
    setSidebar(false);
  };

  const remove = (id: string) => {
    // The chat's memory on the API goes with it.
    void api.clearMemory(id).catch(() => undefined);
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(undefined);
  };

  return (
    <AppShell active="chat" status={k.connected}>
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ChatSidebar
        chats={chats}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setSidebar(false);
          stick.current = true;
        }}
        onNew={newChat}
        onDelete={remove}
        connected={k.connected}
        stats={k.stats}
        model={currentModel}
        open={sidebar}
        onClose={() => setSidebar(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-term-line bg-term-panel px-4 md:px-5">
          <button onClick={() => setSidebar(true)} className="rounded-lg px-2 py-1 text-lg text-term-dim hover:bg-ink/10 md:hidden" aria-label="Open chats">
            ☰
          </button>
          <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">{active?.title ?? "New chat"}</div>
          <button
            onClick={() => toggleStats(!statsOpen)}
            className={`pill py-1 text-xs ${statsOpen ? "pill-light" : "pill-ghost"}`}
            aria-pressed={statsOpen}
          >
            Stats
          </button>
        </header>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {!active || active.turns.length === 0 ? (
            <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-4 text-center">
              <div className="label-caps mb-3">Agent kernel</div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">What should your agents do?</h1>
              <p className="mt-4 max-w-lg text-term-dim">
                Each message runs as a sandboxed agent with its own budget and permissions. Files it saves to /output/ come back as downloads.
              </p>
              <div className="mt-8 grid w-full gap-2 md:grid-cols-3">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="card p-4 text-left text-sm text-term-dim transition-colors hover:border-accent hover:text-term-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
              {active.turns.map((t) => (
                <div key={t.id} className="space-y-4">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg bg-ink/10 px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">{t.prompt}</div>
                  </div>
                  <AssistantTurn turn={t} k={k} models={models} onRetry={() => void send(t.prompt)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mx-auto w-full max-w-3xl px-4">
          <ApiBanner connected={k.connected} error={k.apiError} className="mb-2" />
        </div>
        <Composer options={options} onOptions={setOptions} onSend={(t) => void send(t)} onStop={stop} running={running} stats={k.stats} models={models} keyState={modelState} model={currentModel} />
      </main>

      {statsOpen && (
        <>
          <div className="fixed inset-0 z-20 bg-sunk/60 xl:hidden" onClick={() => toggleStats(false)} />
          <aside className="fixed inset-y-0 right-0 z-30 w-[22rem] max-w-[90vw] border-l border-term-line bg-term-panel xl:static xl:z-auto">
            <StatsPanel
              k={k}
              jobIds={active?.turns.flatMap((t) => (t.jobId ? [t.jobId] : [])) ?? []}
              currentJobId={lastTurn?.jobId}
              model={currentModel}
              chatId={active?.id}
              onClose={() => toggleStats(false)}
            />
          </aside>
        </>
      )}
    </div>
    </AppShell>
  );
}
