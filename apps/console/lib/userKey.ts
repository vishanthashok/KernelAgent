// The user's own provider keys, one per provider, kept in this browser only. api.ts sends the
// key that matches the model a call is for, as a header.
export type KeyProvider = "anthropic" | "openai";
export const KEY_PROVIDERS: KeyProvider[] = ["anthropic", "openai"];

const PREFIX = "kernelagent.providerKey";
/** Where a single Anthropic key lived before keys were per provider. */
const LEGACY = PREFIX;
const listeners = new Set<() => void>();

function migrate(): void {
  try {
    const old = localStorage.getItem(LEGACY);
    if (!old) return;
    const to = `${PREFIX}.${keyProvider(old)}`;
    if (!localStorage.getItem(to)) localStorage.setItem(to, old);
    localStorage.removeItem(LEGACY);
  } catch {
    // storage blocked
  }
}

export function getUserKey(provider: KeyProvider): string | undefined {
  migrate();
  try {
    return localStorage.getItem(`${PREFIX}.${provider}`) || undefined;
  } catch {
    return undefined;
  }
}

/** Every saved key, by provider. */
export function getUserKeys(): Partial<Record<KeyProvider, string>> {
  const out: Partial<Record<KeyProvider, string>> = {};
  for (const p of KEY_PROVIDERS) {
    const k = getUserKey(p);
    if (k) out[p] = k;
  }
  return out;
}

export function setUserKey(provider: KeyProvider, value: string | undefined): void {
  try {
    if (value) localStorage.setItem(`${PREFIX}.${provider}`, value);
    else localStorage.removeItem(`${PREFIX}.${provider}`);
  } catch {
    // storage blocked: nothing to persist
  }
  for (const l of listeners) l();
}

export function onUserKeyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Which provider issued a key. Anthropic keys start with sk-ant-. Matches the API's rule. */
export const keyProvider = (key: string): KeyProvider => (key.startsWith("sk-ant-") ? "anthropic" : "openai");

/** Which provider runs a model id. Unknown ids go to Anthropic, the API's default. */
export const modelProvider = (model: string | undefined): KeyProvider =>
  model && /^(gpt-|chatgpt-|o\d)/.test(model) ? "openai" : "anthropic";

export const PROVIDER_LABEL: Record<KeyProvider, string> = { anthropic: "Anthropic · Claude", openai: "OpenAI · GPT" };

/** Show only the ends of a key. */
export const maskKey = (k: string) => (k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : "••••");
