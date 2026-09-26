"use client";
import { useEffect, useState } from "react";
import { api, type ModelInfo, type ModelsResponse } from "./api";
import { getUserKeys, onUserKeyChange, KEY_PROVIDERS, type KeyProvider } from "./userKey";
import { loadLastModel, onLastModelChange } from "./chats";

export interface ModelsState {
  data?: ModelsResponse;
  /** Why listing failed, for example a key the provider rejected. */
  error?: string;
  /** Per provider, why its key's models could not be listed. */
  errors?: Partial<Record<KeyProvider, string>>;
  /** The keys this browser holds, by provider. */
  keys?: Partial<Record<KeyProvider, string>>;
}

/** Shown when the API cannot list models (for example an API deploy older than GET /models). */
const ANTHROPIC_FALLBACK: ModelInfo[] = [
  { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
];

const isKeyProvider = (p: string): p is KeyProvider => (KEY_PROVIDERS as string[]).includes(p);

/**
 * Models this browser can run: for each provider the API serves, the models of the user's
 * key for it, or the server's own models when the server has a key. Refetches when keys change.
 */
export function useModels(provider: string | undefined, defaultModel?: string): ModelsState {
  const [state, setState] = useState<ModelsState>({});
  const [keys, setKeys] = useState<Partial<Record<KeyProvider, string>>>({});

  useEffect(() => {
    setKeys(getUserKeys());
    return onUserKeyChange(() => setKeys(getUserKeys()));
  }, []);

  useEffect(() => {
    if (!provider) return;
    let live = true;
    (async () => {
      const base = await api.models();
      const served = base.providers ?? [{ id: base.provider, requiresUserKey: !!base.requiresUserKey }];
      const errors: Partial<Record<KeyProvider, string>> = {};
      const lists = await Promise.all(
        served.map(async (p): Promise<ModelInfo[]> => {
          const tag = (ms: ModelInfo[]) => ms.map((m) => ({ ...m, provider: m.provider ?? p.id }));
          if (base.acceptsUserKeys && isKeyProvider(p.id) && keys[p.id]) {
            try {
              return tag((await api.models(p.id)).models);
            } catch (err) {
              errors[p.id] = (err as Error).message;
              return [];
            }
          }
          if (p.requiresUserKey) return [];
          return tag(base.models.filter((m) => (m.provider ?? base.provider) === p.id));
        }),
      );
      const models = lists.flat();
      // With several providers, the default is the first model a key or the server can run.
      const runnable = models.some((m) => m.id === base.default) ? base.default : (models[0]?.id ?? base.default);
      const error = Object.values(errors).join(" ") || undefined;
      if (live) setState({ data: { ...base, default: runnable, models }, ...(error ? { error, errors } : {}), keys });
    })().catch((err: Error) => {
      if (!live) return;
      setState((s) => ({
        data:
          s.data ??
          (provider === "anthropic"
            ? { provider, default: defaultModel ?? "claude-opus-5", acceptsUserKeys: true, models: ANTHROPIC_FALLBACK }
            : undefined),
        error: err.message,
        keys,
      }) as ModelsState);
    });
    return () => {
      live = false;
    };
  }, [provider, keys]);

  return state;
}

/**
 * True when nothing can run until the user adds a key: the API takes user keys and lists no
 * model for this browser (the server has no key of its own, or the user's keys failed).
 */
export function needsUserKey(state: ModelsState | undefined): boolean {
  const data = state?.data;
  const hasKey = Object.keys(state?.keys ?? {}).length > 0;
  return !!data?.acceptsUserKeys && data.models.length === 0 && (!!data.requiresUserKey || hasKey);
}

export interface ResolvedModel {
  id: string;
  name: string;
  /** True when no model was picked and the API's default runs. */
  isDefault: boolean;
}

/** The model a message will actually run on, with its display name. */
export function resolveModel(picked: string | undefined, data: ModelsResponse | undefined, fallback?: string): ResolvedModel | undefined {
  const list = data?.models ?? [];
  const nameOf = (id: string) => list.find((m) => m.id === id)?.name ?? id;
  if (picked && list.some((m) => m.id === picked)) return { id: picked, name: nameOf(picked), isDefault: false };
  const def = data?.default ?? fallback;
  return def ? { id: def, name: nameOf(def), isDefault: true } : undefined;
}

/** Display name for a model id, when the list knows it. */
export const modelName = (id: string, data: ModelsResponse | undefined) => data?.models.find((m) => m.id === id)?.name ?? id;

/** The model last picked in the chat, kept in sync across components and tabs. */
export function useLastModel(): string | undefined {
  const [model, setModel] = useState<string | undefined>();
  useEffect(() => {
    setModel(loadLastModel());
    return onLastModelChange(() => setModel(loadLastModel()));
  }, []);
  return model;
}
