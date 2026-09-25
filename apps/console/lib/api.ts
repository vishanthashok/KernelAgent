// Thin client for the KernelAgent control API.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const TOKEN = process.env.NEXT_PUBLIC_KERNEL_DEV_TOKEN;

export const wsUrl = (sinceSeq: number) =>
  `${API_URL.replace(/^http/, "ws")}/events/stream?sinceSeq=${sinceSeq}${TOKEN ? `&token=${encodeURIComponent(TOKEN)}` : ""}`;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string; message?: string }).error ?? (body as { message?: string }).message ?? res.statusText);
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

export interface SubmitResult {
  jobId: string;
  pids: Record<string, string>;
}

export const api = {
  stats: () => call<Stats>("/stats"),
  submitJob: (spec: unknown) => call<SubmitResult>("/jobs", { method: "POST", body: JSON.stringify(spec) }),
  kill: (pid: string) => call<{ killed: string[] }>(`/processes/${pid}/kill`, { method: "POST" }),
  signal: (pid: string, signal: string) =>
    call<{ ok: boolean; message: string }>(`/processes/${pid}/signal`, { method: "POST", body: JSON.stringify({ signal }) }),
};
