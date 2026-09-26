// Public landing page: what KernelAgent is, how it works, and how to start with your own key.
import Link from "next/link";
import { Brand, REPO_URL } from "./Brand";
import { UserMenu } from "@/components/shell/UserMenu";

type User = { name?: string; email?: string; image?: string };

const STEPS = [
  { n: "01", title: "Job", body: "You describe a task. It becomes a job: one or more agent processes, with dependencies between them." },
  { n: "02", title: "Scheduler", body: "A priority queue with aging runs ready processes under a concurrency cap and a token rate limit." },
  { n: "03", title: "Syscalls", body: "Agents act only through syscalls: read, write, exec, spawn, send. Each one is checked against the process's capabilities." },
  { n: "04", title: "Sandbox", body: "Code and files run in an isolated sandbox per process. Risky commands can wait for your approval." },
  { n: "05", title: "Event log", body: "Every state change, model call, and syscall is appended to a log. Replay it to rebuild any moment." },
];

const SURFACES = [
  { title: "Chat", body: "Ask for something. Watch each step the agent takes, the files it writes, and what it cost." },
  { title: "Process console", body: "A live table like top, a task graph, IPC messages, sandboxes, and traces you can rewind." },
  { title: "Metrics", body: "Tokens, cost, cache savings, and errors over time, split by model. Compare Claude and GPT on the same work." },
];

const PROCS = [
  { pid: "p-1", role: "planner", state: "TERMINATED", tone: "text-ok", tokens: "4.1k" },
  { pid: "p-2", role: "researcher", state: "RUNNING", tone: "text-term-accent", tokens: "12.8k" },
  { pid: "p-3", role: "coder", state: "BLOCKED", tone: "text-warn", tokens: "9.3k" },
  { pid: "p-4", role: "reviewer", state: "READY", tone: "text-term-dim", tokens: "0" },
];

export function Landing({ user, authEnabled }: { user?: User | undefined; authEnabled: boolean }) {
  const start = user || !authEnabled ? { href: "/connect", label: "Open the app" } : { href: "/login", label: "Sign in to try it" };
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-term-line bg-term-panel/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 md:px-6">
          <Brand />
          <nav className="ml-6 hidden items-center gap-5 text-sm text-term-dim md:flex">
            <a href="#how" className="hover:text-term-fg">How it works</a>
            <a href="#keys" className="hover:text-term-fg">Your API key</a>
            <a href="#next" className="hover:text-term-fg">Roadmap</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-term-fg">GitHub</a>
          </nav>
          <span className="ml-auto" />
          {user ? <UserMenu user={user} /> : null}
          <Link href={start.href} className="pill pill-light text-sm">
            {start.label}
          </Link>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[1.1fr_1fr] md:px-6 md:py-20">
          <div>
            <div className="label-caps">Open-source agent runtime</div>
            <h1 className="mt-3 text-[34px] leading-[1.15] font-semibold tracking-tight md:text-[44px]">
              Run AI agents like operating system processes.
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-term-dim">
              KernelAgent splits a task into agent processes, schedules them, and lets them act only through permission-checked syscalls in a sandbox.
              Every step is logged, so you can see exactly what your agents did, what it cost, and why.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={start.href} className="pill pill-light px-5 py-2.5 text-sm">
                {start.label} →
              </Link>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="pill pill-ghost px-5 py-2.5 text-sm">
                View the code
              </a>
            </div>
            <p className="mt-4 text-xs text-term-dim">Bring your own Claude or OpenAI API key. Nothing to install.</p>
          </div>

          {/* A still of the process table */}
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-term-line px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--status-critical)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--status-warning)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--status-good)]" />
              <span className="ml-2 font-mono text-[11px] text-term-dim">kernelagent · job research-pipeline</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[12px]">
                <thead>
                  <tr className="text-left text-term-dim">
                    <th className="px-4 py-2 font-medium">PID</th>
                    <th className="px-4 py-2 font-medium">ROLE</th>
                    <th className="px-4 py-2 font-medium">STATE</th>
                    <th className="px-4 py-2 text-right font-medium">TOKENS</th>
                  </tr>
                </thead>
                <tbody>
                  {PROCS.map((p) => (
                    <tr key={p.pid} className="border-t border-term-line">
                      <td className="px-4 py-2">{p.pid}</td>
                      <td className="px-4 py-2">{p.role}</td>
                      <td className={`px-4 py-2 ${p.tone}`}>{p.state}</td>
                      <td className="px-4 py-2 text-right">{p.tokens}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-term-line bg-term-panel-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-term-dim">
              <div><span className="text-term-accent">#482</span> SYSCALL p-2 READ_FILE notes.md · allowed</div>
              <div><span className="text-term-accent">#483</span> LLM_CALL p-2 claude-sonnet-5 · 88% cached</div>
              <div><span className="text-term-accent">#484</span> SYSCALL p-3 EXEC pytest · <span className="text-warn">waiting for approval</span></div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-y border-term-line bg-term-panel">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
            <div className="label-caps">How it works</div>
            <h2 className="mt-2 text-2xl font-semibold">An operating system for agents</h2>
            <p className="mt-2 max-w-2xl text-sm text-term-dim">
              The same ideas that keep programs from stepping on each other keep agents in check: processes, a scheduler, permissions, isolation, and an audit log.
            </p>
            <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((s) => (
                <li key={s.n} className="card p-4">
                  <div className="font-mono text-xs text-term-accent">{s.n}</div>
                  <div className="mt-1 font-semibold">{s.title}</div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-term-dim">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* What you see */}
        <section className="mx-auto max-w-6xl px-4 py-14 md:px-6">
          <div className="label-caps">What you get</div>
          <h2 className="mt-2 text-2xl font-semibold">See how your agents behave</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {SURFACES.map((s) => (
              <div key={s.title} className="card p-5">
                <div className="font-semibold">{s.title}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-term-dim">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Keys */}
        <section id="keys" className="border-y border-term-line bg-term-panel">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
            <div className="label-caps">Before you start</div>
            <h2 className="mt-2 text-2xl font-semibold">Bring your own API key</h2>
            <p className="mt-2 max-w-2xl text-sm text-term-dim">
              Agents run on your key, so you pay your provider directly and nobody else&apos;s usage lands on your bill. Add one key or both.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <KeyHow
                title="Claude"
                vendor="Anthropic"
                href="https://console.anthropic.com/settings/keys"
                steps={["Open the Anthropic Console and add billing.", "Create a key under Settings → API keys.", "Paste it on the Connect page after you sign in."]}
              />
              <KeyHow
                title="ChatGPT models"
                vendor="OpenAI"
                href="https://platform.openai.com/api-keys"
                steps={["Open the OpenAI platform and add billing.", "Create a secret key under API keys.", "Paste it on the Connect page after you sign in."]}
              />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded border border-term-line p-4 text-[13px] leading-relaxed text-term-dim">
                <div className="font-semibold text-term-fg">Why not sign in with Claude.ai or ChatGPT?</div>
                Consumer subscriptions do not include API access, and neither company lets other apps run models on your chat account. An API key is the supported way.
              </div>
              <div className="rounded border border-term-line p-4 text-[13px] leading-relaxed text-term-dim">
                <div className="font-semibold text-term-fg">Where your key goes</div>
                It stays in your browser. Each job sends it to the API, which holds it in memory until the job ends. It never reaches the database or the event log.
              </div>
            </div>
          </div>
        </section>

        {/* Roadmap */}
        <section id="next" className="mx-auto max-w-6xl px-4 py-14 md:px-6">
          <div className="label-caps">Coming next</div>
          <h2 className="mt-2 text-2xl font-semibold">Connectors</h2>
          <p className="mt-2 max-w-2xl text-sm text-term-dim">
            Connect GitHub, Google Drive, or Slack through MCP and let agents use them, under the same capability checks, approvals, and audit log as every
            other syscall. Watch how Claude and GPT agents handle real tools side by side.
          </p>
          <div className="mt-8 flex flex-wrap gap-2 font-mono text-[11px] text-term-dim">
            {["TypeScript", "Next.js", "Fastify", "SQLite", "Anthropic SDK", "OpenAI SDK", "E2B sandboxes", "OpenTelemetry", "Auth.js"].map((t) => (
              <span key={t} className="rounded border border-term-line bg-term-panel px-2 py-1">
                {t}
              </span>
            ))}
          </div>
        </section>

        <section className="border-t border-term-line bg-term-panel">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-10 md:px-6">
            <div>
              <div className="text-lg font-semibold">Try it with your own agents</div>
              <div className="text-sm text-term-dim">Sign in, add a key, and give your agents a task.</div>
            </div>
            <Link href={start.href} className="pill pill-light ml-auto px-5 py-2.5 text-sm">
              {start.label} →
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-6 text-xs text-term-dim md:px-6">
        <span>KernelAgent · open source</span>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="ml-auto hover:text-term-fg">
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}

function KeyHow({ title, vendor, href, steps }: { title: string; vendor: string; href: string; steps: string[] }) {
  return (
    <div className="card p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-xs text-term-dim">{vendor}</span>
        <a href={href} target="_blank" rel="noreferrer" className="ml-auto text-xs text-term-accent underline">
          Get a key
        </a>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] text-term-dim">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
