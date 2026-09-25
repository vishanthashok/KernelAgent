"use client";
import { useEffect, useState } from "react";
import { api, type ModelInfo, type ModelsResponse } from "./api";
import { getUserKey, onUserKeyChange } from "./userKey";

export interface ModelsState {
  data?: ModelsResponse;
  /** Why listing failed, for example a key the provider rejected. */
  error?: string;
  /** The key this browser sends, if any. */
  userKey?: string;
}

/** Shown when the API cannot list models (for example an API deploy older than GET /models). */
const ANTHROPIC_FALLBACK: ModelInfo[] = [
  { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
];

/** Models the API can run for this browser's key. Refetches when the provider or the key changes. */
export function useModels(provider: string | undefined, defaultModel?: string): ModelsState {
  const [state, setState] = useState<ModelsState>({});
  const [key, setKey] = useState<string | undefined>();

  useEffect(() => {
    setKey(getUserKey());
    return onUserKeyChange(() => setKey(getUserKey()));
  }, []);

  useEffect(() => {
    if (!provider) return;
    let live = true;
    api
      .models()
      .then((data) => live && setState({ data, ...(key ? { userKey: key } : {}) }))
      .catch((err: Error) => {
        if (!live) return;
        setState((s) => ({
          data:
            s.data ??
            (provider === "anthropic"
              ? { provider, default: defaultModel ?? "claude-opus-5", acceptsUserKeys: true, models: ANTHROPIC_FALLBACK }
              : undefined),
          error: err.message,
          ...(key ? { userKey: key } : {}),
        }) as ModelsState);
      });
    return () => {
      live = false;
    };
  }, [provider, key]);

  return state;
}
