import { isAbsolute, resolve } from "node:path";

// Kernel configuration. All values can be overridden by env vars or constructor options.

export interface ModelPrice {
  inputPerMTok: number; // USD per million input tokens
  outputPerMTok: number; // USD per million output tokens
}

// Per-model price table used for cost accounting. Unknown models fall back to "default".
export const PRICE_TABLE: Record<string, ModelPrice> = {
  "mock-llm": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-fable-5-1": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  default: { inputPerMTok: 3, outputPerMTok: 15 },
};

/** Prompt-cache price multipliers on the input rate: reads are 0.1x, 5-minute writes 1.25x. */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

export function priceFor(model: string): ModelPrice {
  // Dated snapshots (claude-haiku-4-5-20251001) price like their base id.
  return PRICE_TABLE[model] ?? PRICE_TABLE[model.replace(/-\d{8}$/, "")] ?? PRICE_TABLE.default!;
}

export interface CacheUsage {
  /** Input tokens served from the prompt cache. */
  read?: number;
  /** Input tokens written to the prompt cache. */
  write?: number;
}

/**
 * Cost of one model call. inputTokens is the total input, cached or not; cache says how
 * much of it was read from or written to the prompt cache.
 */
export function costUsd(model: string, inputTokens: number, outputTokens: number, cache: CacheUsage = {}): number {
  const p = priceFor(model);
  const read = cache.read ?? 0;
  const write = cache.write ?? 0;
  const uncached = Math.max(0, inputTokens - read - write);
  const input = (uncached + read * CACHE_READ_MULTIPLIER + write * CACHE_WRITE_MULTIPLIER) * p.inputPerMTok;
  return (input + outputTokens * p.outputPerMTok) / 1_000_000;
}

const num = (v: string | undefined, d: number): number => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export interface KernelConfig {
  maxConcurrency: number;
  agingFactor: number; // priority points gained per second spent READY
  tickMs: number;
  rateLimits: { requestsPerMinute: number; tokensPerMinute: number };
  dbPath: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): KernelConfig {
  return {
    maxConcurrency: num(env.MAX_CONCURRENCY, 4),
    agingFactor: num(env.AGING_FACTOR, 1),
    tickMs: num(env.SCHEDULER_TICK_MS, 100),
    rateLimits: {
      requestsPerMinute: num(env.RATE_LIMIT_RPM, 50),
      tokensPerMinute: num(env.RATE_LIMIT_TPM, 200_000),
    },
    dbPath: resolveDbPath(env),
  };
}

/**
 * Relative paths resolve against the directory the user ran the command from. pnpm sets
 * INIT_CWD to it, even when a script runs inside a workspace package directory.
 */
function resolveDbPath(env: NodeJS.ProcessEnv): string {
  const p = env.KERNEL_DB_PATH ?? "data/kernelagent.db";
  if (p === ":memory:" || isAbsolute(p)) return p;
  return resolve(env.INIT_CWD ?? process.cwd(), p);
}
