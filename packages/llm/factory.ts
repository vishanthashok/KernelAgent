import { MockLLM, type MockLLMOptions } from "./mock.ts";
import type { ModelClient } from "./index.ts";

/**
 * Select a provider from env. LLM_PROVIDER=mock|anthropic (default mock).
 * Falls back to the mock when the real provider has no key, so a fresh clone always runs.
 * REQUIRE_USER_KEY=true runs Anthropic on keys users bring, never the server's own.
 */
export async function createModelClient(
  env: NodeJS.ProcessEnv = process.env,
  mockOptions: MockLLMOptions = {},
): Promise<ModelClient> {
  const provider = (env.LLM_PROVIDER ?? "mock").toLowerCase();
  if (provider === "anthropic") {
    const userKeysOnly = env.REQUIRE_USER_KEY === "true";
    if (userKeysOnly) {
      const { AnthropicClient } = await import("./anthropic.ts");
      return new AnthropicClient({ model: env.ANTHROPIC_MODEL });
    }
    if (!env.ANTHROPIC_API_KEY) {
      console.warn("[llm] LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. Falling back to MockLLM.");
      return new MockLLM(mockOptions);
    }
    const { AnthropicClient } = await import("./anthropic.ts");
    return new AnthropicClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });
  }
  if (provider !== "mock") console.warn(`[llm] unknown LLM_PROVIDER=${provider}. Using MockLLM.`);
  return new MockLLM(mockOptions);
}
