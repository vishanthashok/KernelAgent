// Thin client for the KernelAgent control API.
import { getUserKey } from "./userKey";
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const TOKEN = process.env.NEXT_PUBLIC_KERNEL_DEV_TOKEN;

export const wsUrl = (sinceSeq: number) =>
  `${API_URL.replace(/^http/, "ws")}/events/stream?sinceSeq=${sinceSeq}${TOKEN ? `&token=${encodeURIComponent(TOKEN)}` : ""}`;

/** Download link for a file an agent left in /output. */
export const artifactUrl = (id: number) => `${API_URL}/artifacts/${id}${TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : ""}`;

const TIMEOUT_MS = 15_000;

const userKeyHeader = () => {
  const k = getUserKey();
  return k ? { "x-provider-key": k } : undefined;
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
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
        ...(userKeyHeader() ?? {}),
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
}

export interface ModelsResponse {
  provider: string;
  /** The model a job runs on when it does not pick one. */
  default: string;
  /** The API runs jobs on a key the user brings. */
  acceptsUserKeys?: boolean;
  /** The API has no key of its own: every job needs the user's key. */
  requiresUserKey?: boolean;
  models: ModelInfo[];
}

export interface SubmitResult {
  jobId: string;
  pids: Record<string, string>;
}

export const api = {
  stats: () => call<Stats>("/stats"),
  models: () => call<ModelsResponse>("/models"),
  submitJob: (spec: unknown) => call<SubmitResult>("/jobs", { method: "POST", body: JSON.stringify(spec) }),
  kill: (pid: string) => call<{ killed: string[] }>(`/processes/${pid}/kill`, { method: "POST" }),
  signal: (pid: string, signal: string) =>
    call<{ ok: boolean; message: string }>(`/processes/${pid}/signal`, { method: "POST", body: JSON.stringify({ signal }) }),
};
