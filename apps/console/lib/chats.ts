// Chat conversations, stored per browser. Each user message becomes one kernel job.
import { ALL_PERMS, type PermKey } from "./permissions";

export interface ChatOptions {
  /** Model id. Unset means the API's default model. */
  model?: string;
  role: string;
  tokenBudget: number;
  perms: Record<PermKey, boolean>;
  approval: boolean;
  /**
   * Give the chat a shared memory on the API. Every agent in the chat reads and writes it,
   * and each answer is saved to it, so follow-ups keep context without resending the transcript.
   */
  memory: boolean;
  /** Reasoning effort for the main agent. Unset means the model's default. */
  effort?: Effort;
  /** Run sub-agents at low effort. */
  cheapSubagents: boolean;
}

export type Effort = "low" | "medium" | "high";

export interface ChatTurn {
  id: string;
  prompt: string;
  createdAt: number;
  jobId?: string;
  /** Model the job ran on, when one was picked. */
  model?: string;
  /** Root process of the job: its EXIT result is the answer. */
  rootPid?: string;
  /** Submission error, if the job never started. */
  error?: string;
  /**
   * Saved the moment the turn finishes, so the answer, steps, and files survive a reload,
   * another device, or the server trimming its log. Unset while the turn runs.
   */
  status?: TurnStatus;
  answer?: string;
  failure?: string;
  steps?: string[];
  files?: TurnFile[];
  tokens?: number;
  cost?: number;
  finishedAt?: number;
}

export type TurnStatus = "done" | "failed" | "stopped" | "lost";

export interface TurnFile {
  id: number;
  path: string;
  mime: string;
  size: number;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
  options: ChatOptions;
}

export const DEFAULT_OPTIONS: ChatOptions = {
  role: "assistant",
  tokenBudget: 80_000,
  perms: { ...ALL_PERMS },
  approval: false,
  memory: true,
  cheapSubagents: true,
};

const KEY = "kernelagent.chats";
const MODEL_KEY = "kernelagent.model";

/** The last model picked, so new chats start on it. */
export function loadLastModel(): string | undefined {
  try {
    return localStorage.getItem(MODEL_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

const modelListeners = new Set<() => void>();

export function saveLastModel(model: string | undefined): void {
  try {
    if (model) localStorage.setItem(MODEL_KEY, model);
    else localStorage.removeItem(MODEL_KEY);
  } catch {
    // storage blocked: the choice lasts for this session only
  }
  for (const l of modelListeners) l();
}

/** Fires when the picked model changes, in this tab or another one. */
export function onLastModelChange(fn: () => void): () => void {
  modelListeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === MODEL_KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    modelListeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Fill in options that older saved chats lack. */
export function normalizeChats(chats: Chat[]): Chat[] {
  // Chats saved before memory existed had a "history" flag instead.
  return chats.map((c) => {
    const o = (c.options ?? {}) as ChatOptions & { history?: boolean };
    const { history, ...rest } = o;
    return { ...c, options: { ...DEFAULT_OPTIONS, ...rest, memory: o.memory ?? history ?? true } };
  });
}

/** Chats saved in this browser (used when nobody is signed in to an account). */
export function loadChats(): Chat[] {
  try {
    const raw = localStorage.getItem(KEY);
    const chats = raw ? (JSON.parse(raw) as Chat[]) : [];
    return Array.isArray(chats) ? normalizeChats(chats) : [];
  } catch {
    return [];
  }
}

/** Forget this browser's chats, once they are saved to an account. */
export function clearLocalChats(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage blocked
  }
}

export function saveChats(chats: Chat[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(chats));
  } catch {
    // storage full or blocked: the chat still works for this session
  }
}

export function titleFor(prompt: string): string {
  const t = prompt.replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 48) + "…" : t;
}
