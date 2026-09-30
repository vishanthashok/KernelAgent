// SandboxAdapter: the only way the kernel touches an execution environment.
// The kernel depends on this interface. Provider SDKs stay inside their adapters.

export * from "./types.ts";
import type { SandboxAdapter } from "./types.ts";

export { LocalSandbox } from "./local.ts";

/**
 * Select a provider from env. SANDBOX_PROVIDER=local|e2b (default local).
 * Falls back to LocalSandbox when E2B has no key.
 */
export async function createSandbox(env: NodeJS.ProcessEnv = process.env, localOpts: { allowExec?: boolean } = {}): Promise<SandboxAdapter> {
  const provider = (env.SANDBOX_PROVIDER ?? "local").toLowerCase();
  if (provider === "e2b") {
    if (!env.E2B_API_KEY) {
      console.warn("[sandbox] SANDBOX_PROVIDER=e2b but E2B_API_KEY is not set. Falling back to LocalSandbox.");
    } else {
      const { E2BSandbox } = await import("./e2b.ts");
      return new E2BSandbox({ apiKey: env.E2B_API_KEY });
    }
  } else if (provider !== "local") {
    console.warn(`[sandbox] unknown SANDBOX_PROVIDER=${provider}. Using LocalSandbox.`);
  }
  const { LocalSandbox } = await import("./local.ts");
  return new LocalSandbox(localOpts);
}
