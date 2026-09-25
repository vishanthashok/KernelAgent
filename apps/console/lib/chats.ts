// Chat conversations, stored per browser. Each user message becomes one kernel job.
import { ALL_PERMS, type PermKey } from "./permissions";

export interface ChatOptions {
  /** Model id. Unset means the API's default model. */
  model?: string;
  role: string;
  tokenBudget: number;
  perms: Record<PermKey, boolean>;
  approval: boolean;
  /** Send earlier turns with each new message so the agent keeps context. */
  history: boolean;
}

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
  history: true,
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

export function saveLastModel(model: string | undefined): void {
  try {
    if (model) localStorage.setItem(MODEL_KEY, model);
    else localStorage.removeItem(MODEL_KEY);
  } catch {
    // storage blocked: the choice lasts for this session only
  }
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function loadChats(): Chat[] {
  try {
    const raw = localStorage.getItem(KEY);
    const chats = raw ? (JSON.parse(raw) as Chat[]) : [];
    return Array.isArray(chats) ? chats : [];
  } catch {
    return [];
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

const MAX_TURNS = 8;
const MAX_CHARS = 12_000;

/**
 * Build the goal for a new turn. With history on, earlier turns go first so the agent
 * keeps the thread. Oldest turns are dropped to stay within the size limit.
 */
export function buildGoal(prompt: string, earlier: { prompt: string; answer?: string | undefined }[], history: boolean): string {
  if (!history || earlier.length === 0) return prompt;
  const lines: string[] = [];
  for (const t of earlier.slice(-MAX_TURNS)) {
    lines.push(`User: ${t.prompt}`);
    lines.push(`Assistant: ${t.answer?.trim() || "(no answer)"}`);
  }
  let transcript = lines.join("\n\n");
  if (transcript.length > MAX_CHARS) transcript = "…" + transcript.slice(-MAX_CHARS);
  return [
    "This is a follow-up in an ongoing conversation. Files from earlier turns are not in your sandbox.",
    "",
    "Conversation so far:",
    transcript,
    "",
    "New message from the user:",
    prompt,
  ].join("\n");
}
