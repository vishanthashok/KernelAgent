import { MockLLM, type MockLLMOptions } from "./mock.ts";
import type { ModelClient } from "./index.ts";

/**
 * Select a provider from env. LLM_PROVIDER=mock|anthropic|openai|multi (default mock).
 * Falls back to the mock when the real provider has no key, so a fresh clone always runs.
 * REQUIRE_USER_KEY=true runs on keys users bring, never the server's own.
 * multi serves Claude and GPT models side by side, routed by model id. It also turns on
 * when LLM_PROVIDER=anthropic and OPENAI_API_KEY is set.
 */
export async function createModelClient(
  env: NodeJS.ProcessEnv = process.env,
  mockOptions: MockLLMOptions = {},
): Promise<ModelClient> {
  let provider = (env.LLM_PROVIDER ?? "mock").toLowerCase();
  if (provider === "anthropic" && env.OPENAI_API_KEY) provider = "multi";
  if (provider === "multi" || provider === "openai") {
    const userKeysOnly = env.REQUIRE_USER_KEY === "true";
    const anthropicKey = userKeysOnly ? undefined : env.ANTHROPIC_API_KEY;
    const openaiKey = userKeysOnly ? undefined : env.OPENAI_API_KEY;
    if (!userKeysOnly && !anthropicKey && !openaiKey) {
      console.warn(`[llm] LLM_PROVIDER=${provider} but no ANTHROPIC_API_KEY or OPENAI_API_KEY is set. Falling back to MockLLM.`);
      return new MockLLM(mockOptions);
    }
    const { OpenAIClient } = await import("./openai.ts");
    const openai = new OpenAIClient({ apiKey: openaiKey, model: env.OPENAI_MODEL });
    if (provider === "openai") return openai;
    const { AnthropicClient } = await import("./anthropic.ts");
    const anthropic = new AnthropicClient({ apiKey: anthropicKey, model: env.ANTHROPIC_MODEL });
    const { RoutingClient } = await import("./router.ts");
    // The provider with a server key goes first, so jobs without a model or key still run.
    return new RoutingClient(!anthropicKey && openaiKey ? [openai, anthropic] : [anthropic, openai]);
  }
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
