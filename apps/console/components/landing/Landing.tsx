// Public landing page. Plain, specific, and built from the real product: a real screenshot,
// a real job file, the real syscall table, and a real event log from the coding example.
import Image from "next/image";
import Link from "next/link";
import { AccountPanel } from "./AccountPanel";
import { Brand, REPO_URL } from "./Brand";
import { UserMenu } from "@/components/shell/UserMenu";

type User = { name?: string; email?: string; image?: string };

// examples/hello-dag.json
const JOB = `{
  "name": "hello-dag",
  "processes": [
    { "id": "plan", "role": "planner",
      "goal": "Break the task into two parts", "priority": 10 },
    { "id": "left", "role": "researcher",
      "goal": "Research part one", "dependsOn": ["plan"] },
    { "id": "right", "role": "researcher",
      "goal": "Research part two", "dependsOn": ["plan"] },
    { "id": "review", "role": "reviewer",
      "goal": "Combine and review", "dependsOn": ["left", "right"] }
  ]
}`;

// From README's syscall table and packages/kernel/syscall.ts.
const SYSCALLS: [string, string, string][] = [
  ["FS_READ", "FS_READ", "Read a file in the sandbox"],
  ["FS_WRITE", "FS_WRITE", "Write a file in the sandbox"],
  ["EXEC", "EXEC", "Run a shell command in the sandbox"],
  ["SPAWN", "SPAWN", "Start a child, never with more rights than the parent"],
  ["SEND", "SEND", "Put a message in another process's mailbox"],
  ["RECEIVE", "RECEIVE", "Take a message, or block until one arrives"],
  ["REMEMBER", "MEMORY", "Save a note to the chat's shared memory"],
  ["RECALL", "MEMORY", "Search that memory"],
  ["SLEEP", "none", "Yield for a while"],
  ["CHECKPOINT", "none", "Snapshot the process so a retry can resume"],
  ["EXIT", "none", "Finish with a result"],
];

// `pnpm example:coding`, trimmed. Timestamps and the model are from a mock run.
const LOG: [string, string, string, string][] = [
  ["3", "101", "STATE_CHANGE", "NEW -> READY (SUBMITTED)"],
  ["5", "101", "STATE_CHANGE", "READY -> RUNNING (DISPATCH)"],
  ["6", "101", "LLM_CALL", "mock-llm in=819 out=98"],
  ["7", "101", "SYSCALL", "FS_WRITE  /primes.py                 ok"],
  ["9", "101", "SYSCALL", "EXEC      python3 primes.py > output/ ok"],
  ["11", "101", "CHECKPOINT", 'note="primes.py written and executed"'],
  ["14", "101", "SYSCALL", "FS_READ   /output/primes.txt        ok"],
  ["17", "101", "PROCESS_EXIT", 'result="2 3 5 7 11 13 17 19 23 29 31 37 41 43 47"'],
  ["18", "101", "STATE_CHANGE", "RUNNING -> TERMINATED (EXIT)"],
  ["19", "101", "ARTIFACT", "primes.py (223 B)"],
];

// What people use it for. Each example is something you could paste into the chat.
const USES = [
  {
    title: "Research and compare",
    body: "Helper agents look at each side, then one writes the verdict.",
    example: "Compare Supabase and Firebase for a small app, with a table.",
  },
  {
    title: "Write documents",
    body: "Plans, reports, and tables come back as files you open right next to the chat.",
    example: "Write a 2-week SQL study plan to plan.md.",
  },
  {
    title: "Break down a project",
    body: "A planner splits the work, helpers take the parts, and you see every step.",
    example: "Plan my portfolio site as tasks with time estimates.",
  },
  {
    title: "Keep your context",
    body: "Each chat remembers what you told it, on any device you sign in from.",
    example: "Remember I'm applying for backend roles.",
  },
];

const START = [
  { title: "Create an account", body: "Email and password, right at the top of this page." },
  { title: "Add your API key", body: "From Anthropic or OpenAI. It stays in your browser." },
  { title: "Describe a task", body: "Watch the agents work, then open what they made." },
];

const LIMITS = [
  "Agents on this site cannot run shell commands. The built-in sandbox is a temp folder, not a security boundary, so commands stay off unless the server uses the E2B sandbox.",
  "If the server restarts, running agents fail instead of resuming from their last checkpoint.",
  "There is a NET permission but no syscall that uses it yet, so agents cannot fetch web pages.",
  "Connecting tools like GitHub or Google Drive through MCP is planned, not built.",
];

export function Landing({
  user,
  authEnabled,
  accounts,
  providers,
}: {
  user?: User | undefined;
  authEnabled: boolean;
  accounts: boolean;
  providers: { id: string; name: string }[];
}) {
  // Signed-out visitors with sign-in available go to the account box in the hero.
  const start = user ? { href: "/chat", label: "Open your chats" } : !authEnabled ? { href: "/connect", label: "Open the app" } : { href: "#account", label: "Create an account" };
  const signIn = !user && authEnabled;

  return (
    <div className="min-h-dvh bg-term-bg text-term-fg">
      <header className="border-b border-term-line">
        <div className="mx-auto flex max-w-[1080px] items-center gap-6 px-5 py-3.5">
          <Brand />
          <nav className="ml-auto flex items-center gap-5 text-[13px] text-term-dim">
            <a href="#how" className="hidden hover:text-term-fg sm:inline">
              How it works
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hidden hover:text-term-fg sm:inline">
              Source
            </a>
            {signIn && (
              <a href="#account" className="hover:text-term-fg">
                Sign in
              </a>
            )}
            {user && <UserMenu user={user} />}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-5">
        {/* Hero */}
        <section className="grid items-start gap-10 pt-14 pb-14 md:grid-cols-[1fr_360px] md:gap-14 md:pt-24">
          <div>
            <p className="font-mono text-[12px] text-term-dim">open source · TypeScript · runs on Claude or GPT</p>
            <h1 className="mt-5 max-w-[14ch] font-serif text-[44px] leading-[1.02] font-normal tracking-[-0.02em] md:text-[72px]">
              Agents, run like <em className="text-highlight">processes.</em>
            </h1>
            <p className="mt-7 max-w-[34rem] text-[16px] leading-[1.65] text-term-dim">
              KernelAgent is a small operating system for AI agents. You give it a task. It splits the work into processes, schedules them, lets them act only
              through checked system calls, runs their code in a sandbox, and writes every step to a log you can replay.
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-block text-[14px] text-term-dim underline decoration-term-line underline-offset-4 hover:text-term-fg"
            >
              Read the source
            </a>
          </div>
          <div className="md:pt-10">
            <AccountPanel user={user} accounts={accounts} providers={authEnabled ? providers : []} />
          </div>
        </section>

        {/* What it's for, in plain words */}
        <section className="border-t border-term-line py-12 md:py-14">
          <h2 className="font-serif text-[28px] leading-tight md:text-[34px]">Use it for</h2>
          <div className="mt-7 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
            {USES.map((u) => (
              <div key={u.title}>
                <div className="text-[15px] font-medium">{u.title}</div>
                <p className="mt-1.5 text-[14px] leading-relaxed text-term-dim">{u.body}</p>
                <p className="mt-2.5 font-mono text-[12px] leading-relaxed text-highlight">“{u.example}”</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-term-line py-12 md:py-14">
          <h2 className="font-serif text-[28px] leading-tight md:text-[34px]">How to start</h2>
          <ol className="mt-7 grid gap-6 sm:grid-cols-3">
            {START.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="font-serif text-[30px] leading-none text-highlight">{i + 1}</span>
                <div>
                  <div className="text-[15px] font-medium">{s.title}</div>
                  <p className="mt-1 text-[14px] leading-relaxed text-term-dim">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <Figure
          src="/landing/console.jpg"
          width={1440}
          height={860}
          alt="The KernelAgent console mid-run: a process table with a planner, two researchers, and a reviewer, next to the live event stream."
          caption="A research job mid-run. The planner and both researchers are done. The reviewer is still working."
          priority
        />

        {/* 01 */}
        <Section id="how" n="01" label="the job">
          <h2 className="font-serif text-[30px] leading-tight md:text-[38px]">A job is a small file.</h2>
          <p className="mt-4 max-w-[34rem] text-[15px] leading-[1.7] text-term-dim">
            Each entry is a process with a role, a goal, and what it waits on. The planner runs first. Both researchers start the moment it exits, side by
            side. The reviewer waits for both. When you type into the chat, the same thing happens with one process.
          </p>
          <Code>{JOB}</Code>
        </Section>

        {/* 02 */}
        <Section n="02" label="syscalls">
          <h2 className="font-serif text-[30px] leading-tight md:text-[38px]">Nothing happens without a syscall.</h2>
          <p className="mt-4 max-w-[34rem] text-[15px] leading-[1.7] text-term-dim">
            The model never touches a file or a shell directly. It asks the kernel, and the kernel checks the request against the permissions that process was
            given. In the run above, the reviewer tried to start a helper with more rights than it had. The call came back <span className="font-mono text-[13px] text-term-fg">DENIED</span>,
            and the log says so.
          </p>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-term-line text-left font-mono text-[11px] text-term-dim">
                  <th className="py-2 pr-6 font-normal">call</th>
                  <th className="py-2 pr-6 font-normal">needs</th>
                  <th className="py-2 font-normal">does</th>
                </tr>
              </thead>
              <tbody>
                {SYSCALLS.map(([name, cap, what]) => (
                  <tr key={name} className="border-b border-term-line/60">
                    <td className="py-2 pr-6 font-mono text-[13px]">{name}</td>
                    <td className="py-2 pr-6 font-mono text-[13px] text-term-dim">{cap}</td>
                    <td className="py-2 text-term-dim">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 03 */}
        <Section n="03" label="the log">
          <h2 className="font-serif text-[30px] leading-tight md:text-[38px]">Every step is written down.</h2>
          <p className="mt-4 max-w-[34rem] text-[15px] leading-[1.7] text-term-dim">
            State changes, model calls, and syscalls go into an append-only table. The database refuses edits and deletes. This is the actual log of an agent
            asked to write a program that prints the first fifteen primes:
          </p>
          <pre className="mt-7 overflow-x-auto rounded-[6px] border border-term-line bg-term-panel p-4 font-mono text-[12.5px] leading-[1.75]">
            {LOG.map(([seq, pid, type, detail]) => (
              <div key={seq} className="whitespace-pre">
                <span className="text-term-dim">{seq.padStart(3)} </span>
                <span className="text-term-dim">pid {pid} </span>
                <span className={type === "SYSCALL" ? "text-highlight" : ""}>{type.padEnd(13)}</span> {detail}
              </div>
            ))}
          </pre>
          <p className="mt-6 max-w-[34rem] text-[15px] leading-[1.7] text-term-dim">
            Because the log is complete, the console can rewind any job to any point and show exactly what the model saw and said at that moment.
          </p>
        </Section>

        <Figure
          src="/landing/traces.jpg"
          width={1440}
          height={860}
          alt="The Traces view: a job's event log on the left, the rebuilt kernel state at a chosen sequence number on the right."
          caption="Traces. Drag the slider back and the process table on the right is rebuilt from the log up to that event."
        />

        {/* 04 */}
        <Section n="04" label="your key">
          <h2 className="font-serif text-[30px] leading-tight md:text-[38px]">Bring your own key.</h2>
          <div className="mt-4 max-w-[34rem] space-y-4 text-[15px] leading-[1.7] text-term-dim">
            <p>
              Agents run on an API key from{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-term-fg underline decoration-term-line underline-offset-4">
                Anthropic
              </a>{" "}
              or{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-term-fg underline decoration-term-line underline-offset-4">
                OpenAI
              </a>
              . Add one or both, then give the same task to Claude and GPT and compare the steps, the tokens, and the bill.
            </p>
            <p>
              The key stays in your browser. The server holds it in memory while your job runs and never writes it down. A Claude.ai or ChatGPT subscription
              will not work here, because neither lets other apps run models on it.
            </p>
            <p>
              Your account keeps the rest: every chat, what your agents saved to memory along the way, and your job history. Sign in on another device and
              it is all there.
            </p>
          </div>
        </Section>

        {/* 05 */}
        <Section n="05" label="limits">
          <h2 className="font-serif text-[30px] leading-tight md:text-[38px]">What it does not do yet.</h2>
          <ul className="mt-5 max-w-[34rem] space-y-3 text-[15px] leading-[1.65] text-term-dim">
            {LIMITS.map((l) => (
              <li key={l} className="flex gap-3">
                <span className="mt-[0.7em] h-px w-3 shrink-0 bg-term-dim" />
                {l}
              </li>
            ))}
          </ul>
        </Section>

        <section className="border-t border-term-line py-16">
          <p className="font-serif text-[28px] leading-snug md:text-[34px]">
            {user ? "Pick up where you left off." : "Give it a task and watch it work."}{" "}
            <Link href={start.href} className="text-highlight underline decoration-1 underline-offset-[6px] hover:opacity-80">
              {start.label.toLowerCase()} →
            </Link>
          </p>
        </section>
      </main>

      <footer className="border-t border-term-line">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 font-mono text-[11.5px] text-term-dim">
          <span>kernelagent</span>
          <span>TypeScript · Fastify · SQLite · Next.js</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="ml-auto hover:text-term-fg">
            github.com/vishanthashok/KernelAgent
          </a>
        </div>
      </footer>
    </div>
  );
}

/** A numbered section: the number and a short label sit in the left margin on wide screens. */
function Section({ id, n, label, children }: { id?: string; n: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} className="grid gap-4 border-t border-term-line py-14 md:grid-cols-[180px_1fr] md:gap-10 md:py-20">
      <div className="font-mono text-[12px] text-term-dim">
        {n} <span className="text-term-line">/</span> {label}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-7 overflow-x-auto rounded-[6px] border border-term-line bg-term-panel p-4 font-mono text-[12.5px] leading-[1.7] text-term-fg">
      {children}
    </pre>
  );
}

function Figure({ src, width, height, alt, caption, priority }: { src: string; width: number; height: number; alt: string; caption: string; priority?: boolean }) {
  return (
    <figure className="mb-14 md:mb-20">
      <div className="overflow-hidden rounded-[8px] border border-term-line">
        <Image src={src} width={width} height={height} alt={alt} className="block h-auto w-full" priority={priority ?? false} sizes="(min-width: 1080px) 1040px, 100vw" />
      </div>
      <figcaption className="mt-3 font-mono text-[11.5px] leading-relaxed text-term-dim">{caption}</figcaption>
    </figure>
  );
}
