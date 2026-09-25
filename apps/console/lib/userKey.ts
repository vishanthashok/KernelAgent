// A user's own provider key, kept in this browser only. api.ts sends it as a header.
const KEY = "kernelagent.providerKey";
const listeners = new Set<() => void>();

export function getUserKey(): string | undefined {
  try {
    return localStorage.getItem(KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function setUserKey(value: string | undefined): void {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing to persist
  }
  for (const l of listeners) l();
}

export function onUserKeyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Show only the ends of a key. */
export const maskKey = (k: string) => (k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : "••••");
