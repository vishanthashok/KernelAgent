// RoutingClient: one ModelClient over several providers. Picks the provider by model id, so a
// job's `model` decides whether Claude or GPT runs it. Holds no SDK itself.
import type { CompleteOptions, CompletionRequest, CompletionResponse, ModelClient, ModelInfo } from "./index.ts";

/** Which provider issued a key. Anthropic keys start with sk-ant-. Everything else is taken as OpenAI. */
export function providerForKey(key: string): string {
  return key.startsWith("sk-ant-") ? "anthropic" : "openai";
}

const NAME: Record<string, string> = { anthropic: "an Anthropic", openai: "an OpenAI" };
const aKey = (provider: string) => `${NAME[provider] ?? `a ${provider}`} key`;

const MODEL_PROVIDER: [RegExp, string][] = [
  [/^claude-/, "anthropic"],
  [/^(gpt-|chatgpt-|o\d)/, "openai"],
];

export class RoutingClient implements ModelClient {
  readonly provider = "multi";
  readonly model: string;
  readonly acceptsUserKeys = true;
  readonly requiresUserKey: boolean;
  private clients: Map<string, ModelClient>;
  private primary: ModelClient;

  /** The first client is the default: its default model runs jobs that pick none. */
  constructor(clients: ModelClient[]) {
    if (clients.length === 0) throw new Error("RoutingClient needs at least one client");
    this.clients = new Map(clients.map((c) => [c.provider, c]));
    this.primary = clients[0]!;
    this.model = this.primary.model;
    this.requiresUserKey = clients.every((c) => c.requiresUserKey);
  }

  providerFor(model: string): string {
    for (const [re, provider] of MODEL_PROVIDER) if (re.test(model) && this.clients.has(provider)) return provider;
    return this.primary.provider;
  }

  providers(): { id: string; requiresUserKey: boolean }[] {
    return [...this.clients.values()].map((c) => ({ id: c.provider, requiresUserKey: c.requiresUserKey }));
  }

  private client(provider: string): ModelClient {
    const c = this.clients.get(provider);
    if (!c) throw new Error(`this server does not run ${provider} models`);
    return c;
  }

  complete(req: CompletionRequest, opts: CompleteOptions = {}): Promise<CompletionResponse> {
    const model = opts.model || this.model;
    const provider = this.providerFor(model);
    if (opts.apiKey && providerForKey(opts.apiKey) !== provider) {
      return Promise.reject(new Error(`this job's key is not ${aKey(provider)}, so it cannot run ${model}`));
    }
    return this.client(provider).complete(req, { ...opts, model });
  }

  /**
   * With a key, the models that key can use (its provider is read from the key). With a
   * provider, that provider's models. With neither, every provider's models.
   */
  async listModels(opts: { apiKey?: string; provider?: string } = {}): Promise<ModelInfo[]> {
    const provider = opts.apiKey ? providerForKey(opts.apiKey) : opts.provider;
    if (opts.apiKey && opts.provider && opts.provider !== provider) {
      throw new Error(`that looks like ${aKey(provider!)}, not ${aKey(opts.provider)}`);
    }
    const tag = (p: string, ms: ModelInfo[]) => ms.map((m) => ({ ...m, provider: m.provider ?? p }));
    if (provider) {
      const c = this.client(provider);
      return tag(provider, await c.listModels(opts.apiKey ? { apiKey: opts.apiKey } : {}));
    }
    const lists = await Promise.all([...this.clients.values()].map(async (c) => tag(c.provider, await c.listModels())));
    return lists.flat();
  }
}
