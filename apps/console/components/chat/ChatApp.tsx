"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  DEFAULT_OPTIONS,
  clearLocalChats,
  loadChats,
  normalizeChats,
  loadLastModel,
  newId,
  saveChats,
  saveLastModel,
  titleFor,
  type Chat,
  type ChatOptions,
  type ChatTurn,
  type TurnFile,
} from "@/lib/chats";
import { buildCapabilities } from "@/lib/permissions";
import { stepsFor } from "@/lib/steps";
import { useKernel } from "@/lib/useKernel";
import { needsUserKey, resolveModel, useModels } from "@/lib/useModels";
import { userToken } from "@/lib/userToken";
import { ArtifactPanel } from "./ArtifactPanel";
import { AssistantTurn } from "./AssistantTurn";
import { ChatSidebar } from "./ChatSidebar";
import { Composer } from "./Composer";
import { ApiBanner } from "../ApiBanner";
import { StatsPanel } from "./StatsPanel";
import { AppShell } from "../shell/AppShell";

const STATS_KEY = "kernelagent.statsPanel";

// Starters built on what people use this for. Most write a file you can open beside the chat.
const SUGGESTIONS: { title: string; hint: string; prompt: string }[] = [
  {
    title: "Compare two options",
    hint: "Two helper agents argue each side",
    prompt:
      "I'm choosing between Supabase and Firebase for a small app with user accounts. Spawn two sub-agents: one argues for Supabase, one for Firebase. Collect both, then write a verdict with a comparison table to /output/verdict.md.",
  },
  {
    title: "Write a document",
    hint: "Opens beside the chat when done",
    prompt: "Write a one-page study plan for learning SQL in 2 weeks, 1 hour a day, to /output/sql-plan.md, then give me a 3-line summary.",
  },
  {
    title: "Plan a project",
    hint: "A plan plus a task table",
    prompt:
      "Plan a weekend project to build a personal portfolio site. Save the plan to /output/plan.md and the tasks with time estimates as a table to /output/tasks.csv.",
  },
  {
    title: "Remember me",
    hint: "Later messages keep this context",
    prompt: "Remember this about me: I'm a student building a portfolio, I'm applying for backend and AI roles, and my strongest skill is TypeScript.",
  },
];

const finished = (s: string | undefined) => s === "TERMINATED" || s === "FAILED";

export function ChatApp() {
  const k = useKernel();
  const router = useRouter();
  const modelState = useModels(k.stats?.provider, k.stats?.model);
  const models = modelState.data;
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [draftOptions, setDraftOptions] = useState<ChatOptions>(DEFAULT_OPTIONS);
  const [sidebar, setSidebar] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** Signed in to an account: chats live on the API, not in this browser. */
  const [account, setAccount] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  /** The JSON last saved for each chat, so only changed chats are sent. */
  const savedJson = useRef(new Map<string, string>());
  const [statsOpen, setStatsOpen] = useState(false);
  /** A file open in the side panel, with the other files of its turn. */
  const [artifact, setArtifact] = useState<{ files: TurnFile[]; index: number }>();
  /** Jobs already looked up on the server, so each is checked once. */
  const lookedUp = useRef(new Set<string>());
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let pref: string | null = null;
    try {
      pref = localStorage.getItem(STATS_KEY);
    } catch {}
    setStatsOpen(pref === "open");
    const last = loadLastModel();
    if (last) setDraftOptions((o) => ({ ...o, model: last }));
    const show = (c: Chat[]) => {
      setChats(c);
      const latest = [...c].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (latest) setActiveId(latest.id);
      setLoaded(true);
    };
    void (async () => {
      if (!(await userToken())) return show(loadChats());
      try {
        const remote = normalizeChats((await api.chats()).chats);
        for (const c of remote) savedJson.current.set(c.id, JSON.stringify(c));
        // Chats this browser made before signing in move into the account.
        const local = loadChats().filter((c) => !remote.some((r) => r.id === c.id));
        await Promise.all(local.map((c) => api.saveChat(c).then(() => savedJson.current.set(c.id, JSON.stringify(c)))));
        clearLocalChats();
        setAccount(true);
        show([...remote, ...local]);
      } catch (err) {
        setSyncError(`Could not load your saved chats: ${(err as Error).message}`);
        show(loadChats());
      }
    })();
  }, []);

  // Save changes: to the account when signed in, else to this browser.
  useEffect(() => {
    if (!loaded) return;
    if (!account) return saveChats(chats);
    const timer = setTimeout(() => {
      for (const c of chats) {
        const json = JSON.stringify(c);
        if (savedJson.current.get(c.id) === json) continue;
        savedJson.current.set(c.id, json);
        api.saveChat(c).then(
          () => setSyncError(undefined),
          (err: Error) => {
            savedJson.current.delete(c.id);
            setSyncError(`Could not save to your account: ${err.message}`);
          },
        );
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [chats, loaded, account]);

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

  // Save each finished turn's answer, steps, files, and cost into the chat itself, so it
  // survives reloads, other devices, and the server trimming its log.
  useEffect(() => {
    if (!loaded) return;
    for (const chat of chats) {
      for (const t of chat.turns) {
        if (t.error || !t.jobId) continue;
        const jobId = t.jobId;
        const files = k.artifacts.filter((a) => a.jobId === jobId).map(({ id, path, mime, size }) => ({ id, path, mime, size }));
        if (t.status) {
          // Files are stored just after the agent exits, so they can land after the snapshot.
          if (files.length > (t.files?.length ?? 0)) updateTurn(chat.id, t.id, { files });
          continue;
        }
        const root = t.rootPid ? k.processes.get(t.rootPid) : undefined;
        if (root && finished(root.status)) {
          const procs = [...k.processes.values()].filter((p) => p.jobId === jobId);
          updateTurn(chat.id, t.id, {
            status: root.status === "FAILED" ? "failed" : root.error === "KILLED" ? "stopped" : "done",
            ...(root.result ? { answer: root.result } : {}),
            ...(root.status === "FAILED" ? { failure: root.error ?? "unknown error" } : {}),
            steps: stepsFor(k.events, jobId).map((s) => s.text).slice(-60),
            files,
            tokens: procs.reduce((n, p) => n + p.tokensUsed, 0),
            cost: procs.reduce((n, p) => n + p.costUsd, 0),
            finishedAt: Date.now(),
          });
        } else if (!root && k.live && !lookedUp.current.has(jobId)) {
          // The stream has replayed everything and this job is not in it: ask the server once.
          lookedUp.current.add(jobId);
          api.job(jobId).then(
            (res) => {
              const r = res.processes.find((p) => p.pid === t.rootPid);
              if (!r || !finished(r.status)) return;
              updateTurn(chat.id, t.id, {
                status: r.status === "FAILED" ? "failed" : r.error === "KILLED" ? "stopped" : "done",
                ...(r.result ? { answer: r.result } : {}),
                ...(r.status === "FAILED" ? { failure: r.error ?? "unknown error" } : {}),
                tokens: res.processes.reduce((n, p) => n + p.tokensUsed, 0),
                cost: res.processes.reduce((n, p) => n + p.costUsd, 0),
                finishedAt: Date.now(),
              });
            },
            (err: Error) => {
              if (/no such job|404/i.test(err.message)) updateTurn(chat.id, t.id, { status: "lost", finishedAt: Date.now() });
            },
          );
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k.version, k.live, loaded, chats]);

  const toggleStats = (open: boolean) => {
    setStatsOpen(open);
    if (open) setArtifact(undefined);
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
  // A turn is over when its main agent is (or its snapshot says so), even if helpers still run.
  const running = !!lastTurn && !lastTurn.error && !lastTurn.status && !finished(lastRoot?.status);

  const send = async (prompt: string) => {
    // Agents run on the visitor's own key. Without one, send them to add it.
    if (needsUserKey(modelState)) return router.push("/connect");
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
      const res = await api.submitJob(
        {
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
        },
        model ?? models?.default ?? k.stats?.model,
      );
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
    setArtifact(undefined);
    setSidebar(false);
  };

  const remove = (id: string) => {
    // The chat's memory on the API goes with it.
    if (account) {
      savedJson.current.delete(id);
      void api.deleteChat(id).catch(() => undefined);
    } else void api.clearMemory(id).catch(() => undefined);
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(undefined);
  };

  const side = artifact ? "artifact" : statsOpen ? "stats" : undefined;

  return (
    <AppShell active="chat" status={k.connected}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ChatSidebar
          chats={chats}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            setArtifact(undefined);
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

        <main className="flex min-w-0 flex-1 flex-col bg-term-bg">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-term-line px-4 md:px-6">
            <button onClick={() => setSidebar(true)} className="rounded-[5px] px-2 py-1 text-lg text-term-dim hover:bg-ink/10 md:hidden" aria-label="Open chats">
              ☰
            </button>
            <div className="min-w-0 flex-1 truncate text-[14px] font-medium">{active?.title ?? "New chat"}</div>
            {running && <span className="hidden text-[12px] text-term-dim sm:inline">working</span>}
            <button
              onClick={() => toggleStats(!statsOpen)}
              className={`rounded-[5px] px-2.5 py-1 text-[12px] transition-colors ${side === "stats" ? "bg-ink/10 text-term-fg" : "text-term-dim hover:bg-ink/10 hover:text-term-fg"}`}
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
              <div className="mx-auto flex min-h-full max-w-[44rem] flex-col justify-center px-5 py-10">
                <h1 className="font-serif text-[36px] leading-[1.1] tracking-[-0.01em] md:text-[46px]">
                  What should your agents <em className="text-accent">work on?</em>
                </h1>
                <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-term-dim">
                  Describe a task. An agent plans it, can start helpers, writes files you can open right here, and remembers this chat next time.
                </p>
                <div className="mt-9 grid gap-2.5 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.title}
                      onClick={() => void send(s.prompt)}
                      className="group rounded-[8px] border border-term-line bg-term-panel p-4 text-left transition-colors hover:border-accent/60"
                    >
                      <div className="flex items-center justify-between text-[14px] font-medium">
                        {s.title}
                        <span className="text-term-dim transition-transform group-hover:translate-x-0.5 group-hover:text-accent">→</span>
                      </div>
                      <div className="mt-1 text-[12.5px] text-term-dim">{s.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-[46rem] space-y-9 px-5 py-8">
                {active.turns.map((t) => (
                  <div key={t.id} className="space-y-5">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-[12px] rounded-br-[4px] border border-term-line bg-term-panel px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
                        {t.prompt}
                      </div>
                    </div>
                    <AssistantTurn
                      turn={t}
                      k={k}
                      models={models}
                      onRetry={() => void send(t.prompt)}
                      onOpenFile={(files, index) => {
                        setArtifact({ files, index });
                        setStatsOpen(false);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mx-auto w-full max-w-[46rem] px-5">
            <ApiBanner connected={k.connected} error={k.apiError} className="mb-2" />
            {syncError && <div className="mb-2 rounded-[5px] border border-warn/40 px-3 py-2 text-xs text-warn">{syncError}</div>}
          </div>
          <Composer options={options} onOptions={setOptions} onSend={(t) => void send(t)} onStop={stop} running={running} stats={k.stats} models={models} keyState={modelState} model={currentModel} />
        </main>

        {side && (
          <>
            <div className="fixed inset-0 z-20 bg-sunk/60 lg:hidden" onClick={() => (artifact ? setArtifact(undefined) : toggleStats(false))} />
            <aside
              className={`fixed inset-y-0 right-0 z-30 border-l border-term-line bg-term-panel lg:static lg:z-auto ${
                side === "artifact" ? "w-full sm:w-[36rem] lg:w-[min(44rem,48vw)]" : "w-[22rem] max-w-[90vw]"
              }`}
            >
              {side === "artifact" && artifact ? (
                <ArtifactPanel files={artifact.files} index={artifact.index} onIndex={(index) => setArtifact({ ...artifact, index })} onClose={() => setArtifact(undefined)} />
              ) : (
                <StatsPanel
                  k={k}
                  jobIds={active?.turns.flatMap((t) => (t.jobId ? [t.jobId] : [])) ?? []}
                  currentJobId={lastTurn?.jobId}
                  model={currentModel}
                  chatId={active?.id}
                  onClose={() => toggleStats(false)}
                />
              )}
            </aside>
          </>
        )}
      </div>
    </AppShell>
  );
}
