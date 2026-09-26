// Thin client for the KernelAgent control API.
import { getUserKey, modelProvider, type KeyProvider } from "./userKey";
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const TOKEN = process.env.NEXT_PUBLIC_KERNEL_DEV_TOKEN;

export const wsUrl = (sinceSeq: number) =>
  `${API_URL.replace(/^http/, "ws")}/events/stream?sinceSeq=${sinceSeq}${TOKEN ? `&token=${encodeURIComponent(TOKEN)}` : ""}`;

/** Download link for a file an agent left in /output. */
export const artifactUrl = (id: number) => `${API_URL}/artifacts/${id}${TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : ""}`;

const TIMEOUT_MS = 15_000;

/** The user's key for a provider, as the header the API reads. */
const keyHeader = (provider: KeyProvider | undefined): Record<string, string> => {
  const k = provider ? getUserKey(provider) : undefined;
  return k ? { "x-provider-key": k } : {};
};

async function call<T>(path: string, init: RequestInit = {}, keyFor?: KeyProvider): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: abort.signal,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
        ...keyHeader(keyFor),
        ...init.headers,
      },
    });
  } catch {
    throw new Error(
      abort.signal.aborted
        ? `The API at ${API_URL} did not answer within ${TIMEOUT_MS / 1000}s.`
        : `Can't reach the API at ${API_URL}. Check that it is running and that NEXT_PUBLIC_API_URL points to it.`,
    );
  } finally {
    clearTimeout(timer);
  }
  let body: { error?: string; message?: string } | undefined;
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Not JSON: usually a proxy error page (for example Railway's 502 when the app is down).
    throw new Error(`The API at ${API_URL} returned ${res.status} ${res.statusText || ""}`.trim() + " instead of a JSON response.");
  }
  if (!res.ok) throw new Error(body?.error ?? body?.message ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export interface Stats {
  bootedAt: number;
  uptimeMs: number;
  provider: string;
  model: string;
  sandbox: string | null;
  maxConcurrency: number;
  running: number;
  queueDepth: number;
  rateLimiter: { requests: number; tokens: number; reservations: number };
  lastSequence: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** Set by a server that runs more than one provider. */
  provider?: string;
}

export interface ModelsResponse {
  provider: string;
  /** The model a job runs on when it does not pick one. */
  default: string;
  /** The API runs jobs on a key the user brings. */
  acceptsUserKeys?: boolean;
  /** The API has no key of its own: every job needs the user's key. */
  requiresUserKey?: boolean;
  /** Each provider the API runs, and whether it needs the user's key. */
  providers?: { id: string; requiresUserKey: boolean }[];
  models: ModelInfo[];
}

export interface SubmitResult {
  jobId: string;
  pids: Record<string, string>;
}

export interface MemoryEntry {
  id: number;
  scope: string;
  jobId: string;
  pid?: string;
  kind: "note" | "turn";
  content: string;
  createdAt: number;
}

export const api = {
  metrics: (range: string) => call<import("./metrics").Metrics>(`/metrics?range=${encodeURIComponent(range)}`),
  memory: (scope: string) => call<{ scope: string; count: number; entries: MemoryEntry[] }>(`/memory?scope=${encodeURIComponent(scope)}`),
  deleteMemory: (id: number) => call<{ deleted: number }>(`/memory/${id}`, { method: "DELETE" }),
  clearMemory: (scope: string) => call<{ cleared: number }>(`/memory?scope=${encodeURIComponent(scope)}`, { method: "DELETE" }),
  stats: () => call<Stats>("/stats"),
  /** Without a provider: what the server offers on its own keys. With one: what this browser's key for it can run. */
  models: (provider?: KeyProvider) => call<ModelsResponse>(provider ? `/models?provider=${provider}` : "/models", {}, provider),
  /** Check a key before saving it. */
  checkKey: (provider: KeyProvider, key: string) =>
    call<ModelsResponse>(`/models?provider=${provider}`, { headers: { "x-provider-key": key } }),
  /** Sends the key for the provider that runs `model` (the job's model, or the server default). */
  submitJob: (spec: unknown, model: string | undefined) =>
    call<SubmitResult>("/jobs", { method: "POST", body: JSON.stringify(spec) }, modelProvider(model)),
  kill: (pid: string) => call<{ killed: string[] }>(`/processes/${pid}/kill`, { method: "POST" }),
  signal: (pid: string, signal: string) =>
    call<{ ok: boolean; message: string }>(`/processes/${pid}/signal`, { method: "POST", body: JSON.stringify({ signal }) }),
};
