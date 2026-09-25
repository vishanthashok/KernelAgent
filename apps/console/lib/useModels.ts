"use client";
import { useEffect, useState } from "react";
import { api, type ModelsResponse } from "./api";

/** Models the API's provider can run. Refetches when the provider changes (for example after a redeploy). */
export function useModels(provider: string | undefined): ModelsResponse | undefined {
  const [models, setModels] = useState<ModelsResponse>();
  useEffect(() => {
    if (!provider) return;
    let live = true;
    api
      .models()
      .then((m) => live && setModels(m))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [provider]);
  return models;
}
