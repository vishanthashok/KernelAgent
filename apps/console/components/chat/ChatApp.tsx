"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { buildGoal, DEFAULT_OPTIONS, loadChats, newId, saveChats, titleFor, type Chat, type ChatOptions, type ChatTurn } from "@/lib/chats";
import { buildCapabilities } from "@/lib/permissions";
import { useKernel } from "@/lib/useKernel";
import { AssistantTurn } from "./AssistantTurn";
import { ChatSidebar } from "./ChatSidebar";
import { Composer } from "./Composer";

const SUGGESTIONS = [
  "Write a Python script that prints the first 20 prime numbers, run it, and save the script to /output/primes.py",
  "Research cooperative vs preemptive scheduling and write a short report to /output/report.md",
  "Make a CSV of the 10 largest US states by area and save it to /output/states.csv",
];

export function ChatApp() {
  const k = useKernel();
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [draftOptions, setDraftOptions] = useState<ChatOptions>(DEFAULT_OPTIONS);
  const [sidebar, setSidebar] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
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

  const setOptions = (o: ChatOptions) => {
    if (active) updateChat(active.id, (c) => ({ ...c, options: o }));
    else setDraftOptions(o);
  };

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
    const earlier = chat.turns
      .filter((t) => !t.error)
      .map((t) => ({ prompt: t.prompt, answer: t.rootPid ? k.processes.get(t.rootPid)?.result : undefined }));
    const turn: ChatTurn = { id: newId(), prompt, createdAt: Date.now() };
    stick.current = true;
    updateChat(chatId, (c) => ({ ...c, updatedAt: Date.now(), turns: [...c.turns, turn] }));
    const opts = chat.options;
    try {
      const res = await api.submitJob({
        name: titleFor(prompt),
        process: {
          role: opts.role.trim() || "assistant",
          goal: buildGoal(prompt, earlier, opts.history),
          capabilities: buildCapabilities(opts.perms, opts.approval),
          tokenBudget: opts.tokenBudget,
        },
      });
      updateTurn(chatId, turn.id, { jobId: res.jobId, rootPid: Object.values(res.pids)[0]! });
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
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(undefined);
  };

  return (
    <div className="flex h-dvh overflow-hidden">
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
        open={sidebar}
        onClose={() => setSidebar(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-4 py-3 md:px-6">
          <button onClick={() => setSidebar(true)} className="rounded-lg px-2 py-1 text-lg text-term-dim hover:bg-white/10 md:hidden" aria-label="Open chats">
            ☰
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-term-dim">{active?.title ?? "New chat"}</div>
          <Link href="/console" className="font-mono text-[11px] tracking-[0.2em] text-term-dim uppercase hover:text-term-fg">
            Console →
          </Link>
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
              <div className="label-caps mb-4">Agent kernel</div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">What should your agents do?</h1>
              <p className="mt-4 max-w-lg text-term-dim">
                Each message runs as a sandboxed agent with its own budget and permissions. Files it saves to /output/ come back as downloads.
              </p>
              <div className="mt-8 grid w-full gap-2 md:grid-cols-3">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left text-sm text-term-dim transition-colors hover:border-white/25 hover:text-term-fg"
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
                    <div className="max-w-[85%] rounded-3xl bg-white/10 px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">{t.prompt}</div>
                  </div>
                  <AssistantTurn turn={t} k={k} onRetry={() => void send(t.prompt)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <Composer options={options} onOptions={setOptions} onSend={(t) => void send(t)} onStop={stop} running={running} stats={k.stats} />
      </main>
    </div>
  );
}
