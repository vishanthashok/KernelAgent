// Token budget accounting. Dependency-free so replay.ts (and the console) can share it.

/** Budget weight of cached input, matching the price multipliers in config.ts. */
export const BUDGET_CACHE_READ_WEIGHT = 0.1;
export const BUDGET_CACHE_WRITE_WEIGHT = 1.25;

/**
 * Tokens charged to a budget for one model call. Cached input counts at its price weight,
 * so resending a cached history each turn costs a tenth of what it would uncached.
 */
export function budgetTokens(inputTokens: number, outputTokens: number, cache: { read?: number; write?: number } = {}): number {
  const read = cache.read ?? 0;
  const write = cache.write ?? 0;
  const uncached = Math.max(0, inputTokens - read - write);
  return Math.round(uncached + read * BUDGET_CACHE_READ_WEIGHT + write * BUDGET_CACHE_WRITE_WEIGHT + outputTokens);
}
