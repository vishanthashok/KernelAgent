"use client";
// Add and check a Claude or OpenAI API key. Keys stay in this browser (lib/userKey.ts).
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type ModelInfo, type ModelsResponse } from "@/lib/api";
import { getUserKeys, keyProvider, KEY_PROVIDERS, maskKey, onUserKeyChange, setUserKey, type KeyProvider } from "@/lib/userKey";
import { Brand } from "@/components/landing/Brand";
import { UserMenu } from "@/components/shell/UserMenu";

const INFO: Record<KeyProvider, { title: string; vendor: string; href: string; placeholder: string; note: string }> = {
  anthropic: {
    title: "Claude",
    vendor: "Anthropic",
    href: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-…",
    note: "A Claude.ai subscription does not include API access. Create a key in the Anthropic Console.",
  },
  openai: {
    title: "GPT",
    vendor: "OpenAI",
    href: "https://platform.openai.com/api-keys",
    placeholder: "sk-proj-…",
    note: "A ChatGPT Plus subscription does not include API access. Create a key on the OpenAI platform.",
  },
};

type Check = { state: "idle" | "checking" } | { state: "ok"; models: ModelInfo[]; note?: string } | { state: "error"; message: string };

export function ConnectKeys({ user }: { user?: { name?: string; email?: string; image?: string } | undefined }) {
  const [keys, setKeys] = useState<Partial<Record<KeyProvider, string>>>({});
  const [server, setServer] = useState<ModelsResponse>();
  const [serverError, setServerError] = useState<string>();

  useEffect(() => {
    setKeys(getUserKeys());
    return onUserKeyChange(() => setKeys(getUserKeys()));
  }, []);

  useEffect(() => {
    api.models().then(setServer, (err: Error) => setServerError(err.message));
  }, []);

  const served = server?.providers?.map((p) => p.id) ?? (server ? [server.provider] : undefined);
  const ready = Object.keys(keys).length > 0 || (server && !server.requiresUserKey);

  return (
    <main className="min-h-dvh">
      <header className="flex items-center gap-3 border-b border-term-line bg-term-panel px-4 py-3 md:px-8">
        <Brand />
        <span className="ml-auto" />
        <UserMenu user={user} />
      </header>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="label-caps">Step 2 of 2</div>
        <h1 className="mt-1 text-2xl font-semibold">Connect your models</h1>
        <p className="mt-2 max-w-2xl text-sm text-term-dim">
          {user?.name ? `Welcome, ${user.name.split(" ")[0]}. ` : ""}
          KernelAgent runs agents on your own API key, so you control spend and see exactly what your model does. Add a Claude key, an OpenAI key, or
          both, then run the same task on each and compare the steps, tokens, and cost.
        </p>

        {serverError && (
          <div className="mt-6 rounded border border-danger/40 p-3 text-sm text-danger">
            Can&apos;t reach the KernelAgent API: {serverError}
          </div>
        )}
        {server?.provider === "mock" && (
          <div className="mt-6 rounded border border-warn/40 p-3 text-sm text-warn">
            This API runs the mock model, so keys are saved but not used. Set LLM_PROVIDER=multi on the API to run real agents.
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {KEY_PROVIDERS.map((p) => (
            <KeyCard key={p} provider={p} saved={keys[p]} available={!served || served.includes(p) || served.includes("mock")} />
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/chat" className={`pill pill-light px-5 py-2 text-sm ${ready ? "" : "pointer-events-none opacity-40"}`} aria-disabled={!ready}>
            Open the chat →
          </Link>
          <span className="text-xs text-term-dim">You can change keys later from the chat&apos;s Advanced panel.</span>
        </div>

        <section className="card mt-10 p-5">
          <div className="label-caps">Where your key goes</div>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-term-dim">
            <li>It is saved in this browser&apos;s local storage. It is never saved to your account.</li>
            <li>Each job sends it to the API in a request header. The API holds it in memory until the job ends, then drops it.</li>
            <li>It never reaches the job spec, the database, or the event log that streams to the console. A test checks this.</li>
            <li>Remove it here any time. Revoke it at your provider to be sure.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}

function KeyCard({ provider, saved, available }: { provider: KeyProvider; saved?: string | undefined; available: boolean }) {
  const info = INFO[provider];
  const [draft, setDraft] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    if (keyProvider(key) !== provider) {
      setCheck({ state: "error", message: `That looks like ${keyProvider(key) === "anthropic" ? "an Anthropic" : "an OpenAI"} key. Paste it in the other card.` });
      return;
    }
    setCheck({ state: "checking" });
    try {
      const res = await api.checkKey(provider, key);
      setUserKey(provider, key);
      setDraft("");
      setCheck({ state: "ok", models: res.models, ...(res.acceptsUserKeys ? {} : { note: "Saved. This API does not use keys yet." }) });
    } catch (err) {
      setCheck({ state: "error", message: (err as Error).message });
    }
  };

  return (
    <div className={`card flex flex-col p-5 ${available ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold">{info.title}</span>
        <span className="text-xs text-term-dim">{info.vendor}</span>
        <span className={`ml-auto whitespace-nowrap font-mono text-[11px] ${saved ? "text-ok" : "text-term-dim"}`}>{saved ? `● ${maskKey(saved)}` : "not connected"}</span>
      </div>
      <p className="mt-2 text-xs text-term-dim">
        {info.note}{" "}
        <a href={info.href} target="_blank" rel="noreferrer" className="text-term-accent underline">
          Get a key
        </a>
      </p>
      {available ? (
        <>
          <div className="mt-4 flex gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
              placeholder={saved ? "Paste a new key to replace it" : info.placeholder}
              aria-label={`${info.vendor} API key`}
              className="min-w-0 flex-1 border px-3 py-1.5 font-mono text-sm"
            />
            <button onClick={() => void save()} disabled={!draft.trim() || check.state === "checking"} className="pill pill-light text-sm disabled:opacity-40">
              {check.state === "checking" ? "Checking…" : "Connect"}
            </button>
          </div>
          <div className="mt-2 min-h-5 text-xs">
            {check.state === "ok" && (
              <span className="text-ok">
                {check.note ?? `Connected. ${check.models.length} models available${check.models.length ? `, e.g. ${check.models.slice(0, 3).map((m) => m.name).join(", ")}` : ""}.`}
              </span>
            )}
            {check.state === "error" && <span className="text-danger">{check.message}</span>}
          </div>
          {saved && (
            <button
              onClick={() => {
                setUserKey(provider, undefined);
                setCheck({ state: "idle" });
              }}
              className="mt-auto self-start text-xs text-term-dim underline hover:text-danger"
            >
              Remove key
            </button>
          )}
        </>
      ) : (
        <p className="mt-4 text-xs text-warn">This API does not run {info.vendor} models. Set LLM_PROVIDER=multi on the API to enable them.</p>
      )}
    </div>
  );
}
