import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "@kernelagent/api";
import { MockLLM, RoutingClient, providerForKey, type ModelClient } from "@kernelagent/llm";
import { makeKernel } from "./helpers.ts";

type FastifyInstance = Awaited<ReturnType<typeof buildServer>>;

/** A MockLLM that poses as a real provider and records the keys and models it was called with. */
function fakeProvider(provider: string, model: string, ids: string[]) {
  const calls: { model?: string; apiKey?: string }[] = [];
  const inner = new MockLLM();
  const client: ModelClient = {
    provider,
    model,
    acceptsUserKeys: true,
    requiresUserKey: true,
    complete: (req, opts) => {
      calls.push({ ...(opts?.model ? { model: opts.model } : {}), ...(opts?.apiKey ? { apiKey: opts.apiKey } : {}) });
      return inner.complete(req, opts);
    },
    listModels: async () => ids.map((id) => ({ id, name: id })),
  };
  return { client, calls };
}

const ANTHROPIC_KEY = "sk-ant-api03-test-key-1234";
const OPENAI_KEY = "sk-proj-test-key-5678";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("RoutingClient", () => {
  const make = () => {
    const a = fakeProvider("anthropic", "claude-opus-5", ["claude-opus-5", "claude-sonnet-5"]);
    const o = fakeProvider("openai", "gpt-5", ["gpt-5", "gpt-5-mini"]);
    return { a, o, router: new RoutingClient([a.client, o.client]) };
  };

  it("reads the provider from a key", () => {
    expect(providerForKey(ANTHROPIC_KEY)).toBe("anthropic");
    expect(providerForKey(OPENAI_KEY)).toBe("openai");
  });

  it("routes by model id and defaults to the first client", () => {
    const { router } = make();
    expect(router.model).toBe("claude-opus-5");
    expect(router.providerFor("claude-sonnet-5")).toBe("anthropic");
    expect(router.providerFor("gpt-5-mini")).toBe("openai");
    expect(router.providerFor("o3")).toBe("openai");
    expect(router.providerFor("something-else")).toBe("anthropic");
    expect(router.requiresUserKey).toBe(true);
  });

  it("lists models per key, per provider, or all, tagged with the provider", async () => {
    const { router } = make();
    expect((await router.listModels({ apiKey: OPENAI_KEY })).map((m) => m.id)).toEqual(["gpt-5", "gpt-5-mini"]);
    expect((await router.listModels({ provider: "anthropic" })).every((m) => m.provider === "anthropic")).toBe(true);
    expect(await router.listModels()).toHaveLength(4);
    await expect(router.listModels({ apiKey: ANTHROPIC_KEY, provider: "openai" })).rejects.toThrow(/an Anthropic key/);
  });

  it("refuses a key from the wrong provider", async () => {
    const { router } = make();
    const req = { system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: [] };
    await expect(router.complete(req, { model: "gpt-5", apiKey: ANTHROPIC_KEY })).rejects.toThrow(/not an OpenAI key/);
  });

  it("runs a GPT job on the caller's OpenAI key, logs the provider, and never records the key", async () => {
    const { router, o, a } = make();
    const { kernel } = makeKernel({ llm: router });
    kernel.start();
    app = await buildServer(kernel);

    const models = (await app.inject({ method: "GET", url: "/models?provider=openai" })).json();
    expect(models.models.map((m: { id: string }) => m.id)).toEqual(["gpt-5", "gpt-5-mini"]);
    expect(models.providers).toEqual([
      { id: "anthropic", requiresUserKey: true },
      { id: "openai", requiresUserKey: true },
    ]);

    const wrong = await app.inject({
      method: "POST",
      url: "/jobs",
      headers: { "x-provider-key": ANTHROPIC_KEY },
      payload: { model: "gpt-5-mini", process: { role: "r", goal: "g" } },
    });
    expect(wrong.statusCode).toBe(400);

    const res = await app.inject({
      method: "POST",
      url: "/jobs",
      headers: { "x-provider-key": OPENAI_KEY },
      payload: { model: "gpt-5-mini", process: { role: "r", goal: "g" } },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json() as { jobId: string };
    await kernel.waitForJob(jobId);

    expect(a.calls).toHaveLength(0);
    expect(o.calls.length).toBeGreaterThan(0);
    expect(o.calls.every((c) => c.apiKey === OPENAI_KEY && c.model === "gpt-5-mini")).toBe(true);
    const events = kernel.bus.getEvents({ jobId, limit: 1000 });
    const llmCalls = events.filter((e) => e.type === "LLM_CALL");
    for (const e of llmCalls) expect((e.payload as { provider: string }).provider).toBe("openai");
    expect(JSON.stringify([kernel.bus.getEvents({ limit: 100_000 }), kernel.listJobs()])).not.toContain(OPENAI_KEY);
    await kernel.stop();
  });
});

describe("API model env", () => {
  it("never runs on the server's key unless ALLOW_SERVER_KEY=true", async () => {
    const { apiModelEnv, createModelClient } = await import("@kernelagent/llm");
    const env = { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-server-key" };
    const locked = await createModelClient(apiModelEnv(env));
    expect(locked.provider).toBe("multi");
    expect(locked.requiresUserKey).toBe(true);
    await expect(locked.complete({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] })).rejects.toThrow(/bring your own key/);

    const open = await createModelClient(apiModelEnv({ ...env, ALLOW_SERVER_KEY: "true" }));
    expect(open.requiresUserKey).toBe(false);

    const mock = await createModelClient(apiModelEnv({}));
    expect(mock.provider).toBe("mock");
  });
});
