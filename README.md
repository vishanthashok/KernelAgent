# KernelAgent

A process scheduler and sandboxed runtime for autonomous AI agents, modeled on an operating system kernel.

Each agent runs as a process. A scheduler dispatches processes from a ready queue. A process touches the world only through a fixed set of syscalls, each checked against its capabilities, inside its own sandbox. Every state change, model call, and syscall goes into an append-only event log, and a web console renders it all like `top`.

![KernelAgent console demo](docs/demo.gif)

> Demo GIF placeholder. Record one with [docs/demo-script.md](docs/demo-script.md).

It runs end to end with no API keys: a scripted `MockLLM` and a `LocalSandbox` are the defaults. Claude and E2B are opt-in with environment variables.

## Status

- All four build phases are done: kernel, syscalls and sandbox, console, reliability.
- `pnpm test` runs 95 tests with no API keys. 2 live-provider tests skip unless keys are set.
- The Claude (`AnthropicClient`) and E2B (`E2BSandbox`) paths typecheck but have not been run against the real services.
- The demo GIF below is a placeholder.

For agents and contributors: start with [CONTEXT.md](CONTEXT.md) (what was built, what is left). Then [docs/decisions.md](docs/decisions.md), [docs/architecture.md](docs/architecture.md), and [docs/syscall-api.md](docs/syscall-api.md).

## Why

Agent frameworks give a model tools and a loop. When you run many agents at once, you need what an OS gives programs:

- **Isolation.** One agent's files and commands stay out of another's.
- **Least authority.** An agent gets the permissions its task needs. A sub-agent never gets more than its parent.
- **Scheduling.** Concurrency is bounded by rate limits and budgets, and no agent starves.
- **Accounting.** Tokens, dollars, and time per agent and per job, with hard limits.
- **Recovery.** Kill, timeout, and retry from a checkpoint.
- **An audit trail.** A complete, replayable record of every decision and effect.

KernelAgent is that kernel. The value is the process model, the scheduler, capability-guarded syscalls, sandbox isolation, and the event log. It does not wrap an agent framework.

## Architecture

```
 POST /jobs ─▶ apps/api (Fastify) ──────────────────────────── WS /events/stream ─▶ apps/console
                  │
                  ▼
   packages/kernel:  ProcessManager ─ Scheduler ─ ResourceManager ─ CapabilityManager
                     SyscallDispatcher ─ EventBus ─▶ SQLite (append-only) ─ OpenTelemetry
                  │ ProcessRunner              │ SandboxAdapter       │ Channel
                  ▼                            ▼                      ▼
   packages/runtime (execution loop)   packages/sandbox       packages/ipc (mailboxes)
                  │ ModelClient         Local | E2B
                  ▼
   packages/llm:  MockLLM | AnthropicClient
```

The full diagram, the job lifecycle, and "Where the OS analogy stops" are in [docs/architecture.md](docs/architecture.md).

```
apps/api            Fastify control API + WebSocket stream
apps/console        Next.js monitor
packages/kernel     process manager, scheduler, capabilities, syscalls, resources, event bus, replay
packages/runtime    worker and execution loop
packages/llm        ModelClient, MockLLM, AnthropicClient
packages/sandbox    SandboxAdapter, LocalSandbox, E2BSandbox
packages/ipc        mailboxes and delivery
packages/db         SQLite schema and repositories
packages/telemetry  OpenTelemetry setup and kernel metrics
examples/           two example workloads
tests/              vitest suite
```

## Process model

A process is kernel state: pid, role, goal, status, priority, token budget and usage, cost, capabilities, dependencies, retry count, sandbox, and last checkpoint. The model is a stateless function the process calls each turn.

```
NEW ──▶ READY ──▶ RUNNING ──▶ TERMINATED
          ▲         │  │
          │         │  └──▶ WAITING ──▶ READY     (RECEIVE, SLEEP, approval)
          │         ▼
          └──── FAILED                            (retry while retryCount < maxRetries)
```

The `ProcessManager` is the only code that changes status. Every transition emits `STATE_CHANGE`, and illegal transitions throw. A process with unmet dependencies stays `NEW` until they all exit.

A job is one process or a DAG of processes linked by `dependsOn`:

```json
{
  "name": "hello-dag",
  "processes": [
    { "id": "plan", "role": "planner", "goal": "Split the task", "priority": 10 },
    { "id": "left", "role": "researcher", "goal": "Part one", "dependsOn": ["plan"] },
    { "id": "right", "role": "researcher", "goal": "Part two", "dependsOn": ["plan"] },
    { "id": "review", "role": "reviewer", "goal": "Combine", "dependsOn": ["left", "right"] }
  ]
}
```

## Scheduler

One algorithm: a priority queue with aging.

```
effectivePriority = priority + agingFactor × seconds spent READY
```

The scheduler dispatches the best `READY` process whose dependencies exited, while two limits hold:

- `MAX_CONCURRENCY` running processes (default 4).
- The provider's rate limiter: token buckets for requests per minute and tokens per minute. Each dispatch reserves one request, so one tick cannot over-admit.

When a limit is hit, the process stays `READY` for the next tick. The scheduler runs on job submit, on every state change, after syscalls, and on a 100 ms tick.

Scheduling is cooperative. A model call cannot be paused, so the scheduler regains control only when a process makes a syscall, finishes a turn, blocks, or exits. At a turn boundary, a process yields its slot if others are waiting. A blocked process never holds a slot.

## Syscall interface

The model sees one tool per permitted syscall. The kernel validates each call with zod, checks the capability, checks budget and deadline, waits for approval if required, executes it, and logs one `SYSCALL` event.

| Syscall | Capability | Effect | Retry safety |
|---|---|---|---|
| `FS_READ` | `FS_READ` | Read a file from the sandbox | Safe |
| `FS_WRITE` | `FS_WRITE` | Write a file in the sandbox | Effectful |
| `EXEC` | `EXEC` | Run a shell command in the sandbox | Unsafe to replay |
| `SPAWN` | `SPAWN` | Create a child with attenuated capabilities | Effectful |
| `SEND` | `SEND` | Deliver a message to a pid's mailbox | Effectful |
| `RECEIVE` | `RECEIVE` | Take a message, blocking if empty | Effectful |
| `SLEEP` | none | Yield for N ms | Safe |
| `CHECKPOINT` | none | Snapshot the process context | Safe |
| `EXIT` | none | Terminate with a result | Terminal |

Capabilities can be scoped: a path prefix for `FS_*`, a host allowlist for `NET`, a pid list for `SEND`. On `SPAWN`, the child's capabilities must be a subset of the parent's. A request for anything wider is rejected and logged as denied.

```json
{ "type": "FS_WRITE", "scope": "/work" }
{ "type": "EXEC", "requiresApproval": true }
```

The full ABI, including payloads, errors, and signals, is in [docs/syscall-api.md](docs/syscall-api.md).

## Sandbox model

The kernel talks to one interface, `SandboxAdapter`: `create`, `readFile`, `writeFile`, `exec`, `destroy`. A sandbox is created at a process's first dispatch, only if it holds `FS_READ`, `FS_WRITE`, or `EXEC`. It survives retries and is destroyed when the process ends for good.

- **LocalSandbox** (default): a temp directory per process. Paths cannot escape it, and commands run with it as the working directory. **Development only. Not a security boundary.** `EXEC` runs a real shell as your user.
- **E2BSandbox**: a microVM per process through `@e2b/code-interpreter`. Set `SANDBOX_PROVIDER=e2b` and `E2B_API_KEY`.

## IPC

Each process has a FIFO mailbox stored in SQLite. `SEND` queues a message for a pid in the same job and emits `MESSAGE`. `RECEIVE` on an empty mailbox moves the process to `WAITING` and emits `BLOCKED`. The next `SEND` to it wakes it to `READY`, and `RECEIVE` returns the message when it is dispatched again.

## Failure recovery

- **Kill.** `POST /processes/:pid/kill` terminates the process and its descendants, aborts their runs, destroys their sandboxes, and logs `PROCESS_EXIT {killed: true}`. Dependents of a killed process fail.
- **Timeout.** A process past its wall-clock limit (default 5 min per attempt) fails with `TIMEOUT`.
- **Retry.** A failed process with `retryCount < maxRetries` (default 2) goes back to `READY`. It resumes from its last checkpoint if it has one, otherwise it starts clean. Budget failures are not retried.
- **Retry safety.** Syscalls before the last checkpoint are not replayed. Syscalls after it may run again. This is at-least-once, not exactly-once. The model is told to checkpoint after risky effects.
- **Human approval.** A capability marked `requiresApproval` parks the process in `WAITING` until `POST /processes/:pid/signal` sends `approve` or `deny`. The console inspector has the buttons.
- **Budgets.** Token budgets per process and per job. Going over fails the process with `TOKEN_BUDGET_EXCEEDED`.

## Observability

- **Event log.** SQLite, append-only (triggers block UPDATE and DELETE), with a monotonic sequence. Each `LLM_CALL` stores the full request and response. `packages/kernel/replay.ts` rebuilds every process from the log, and a test checks it against the live table field by field.
- **Chat.** The console opens on a chat view like Claude or ChatGPT (`/`). Each message runs as an agent job. The thread shows the agent's steps live, the answer as Markdown, download cards for `/output/` files, and inline Approve / Deny when a command needs approval. **Advanced** under the composer sets role, token budget, permissions, the approval gate, and whether earlier turns are sent as context.
- **Console.** The monitor lives at `/console`: Output, Processes, Task Graph, IPC, Sandboxes, and Traces tabs, a live event stream, and a process inspector. The `+ New Job` button opens a prompt box: type a goal, pick permissions, and run it as an agent, or launch one of the examples. Traces rewinds a job to any sequence and shows what the model saw and said.
- **OpenTelemetry.** Spans for each job, process run, LLM call, syscall, and scheduler dispatch. LLM and syscall spans nest under their process run, which nests under its job. Metrics cover processes by state, tokens, cost, queue depth, and rate-limiter saturation. The console exporter is the default. Set `OTEL_EXPORTER_OTLP_ENDPOINT` for OTLP, or `OTEL_SDK_DISABLED=true` to turn it off.
- **CPU\*** in the console is runtime utilization, the share of a process's life spent `RUNNING`. It is not real CPU.

## Quick start

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm test                 # full suite, no keys needed
pnpm example:coding       # run an example in-process and print its event log
pnpm demo                 # API on :4000, console on :3000, submits the examples
```

Run the pieces yourself:

```bash
pnpm dev:api              # http://localhost:4000
pnpm dev:console          # http://localhost:3000

curl -XPOST localhost:4000/jobs -H 'content-type: application/json' -d @examples/research-pipeline/job.json
curl localhost:4000/processes
curl -XPOST localhost:4000/processes/101/kill
curl -XPOST localhost:4000/processes/101/signal -H 'content-type: application/json' -d '{"signal":"approve"}'
```

### Dashboard

`/dashboard` is a metrics view over the event log, for the last 15 minutes up to 7 days. It shows:
- Cost, tokens, calls, cache hit rate, savings, p95 latency, error rate, and failed agents, each against the previous window.
- Charts for token mix, cost, latency, syscalls by type, errors, and agent outcomes. Every chart has a table view.
- Spend by model, the most expensive jobs, and recent errors.

### Saving tokens

- Prompt caching on every Anthropic call. An agent's later turns read the earlier prefix at a tenth of the input price. The stats panel shows the cache hit rate and the dollars saved.
- Effort control per job. Spawned sub-agents run at low effort unless you turn that off in the chat's Advanced panel.
- Tool output the model sees is capped at 16k chars. The event log keeps the full output.
- Chat memory replaces resending the transcript. Each answer is saved to the chat's memory, and agents add notes with `REMEMBER` and search with `RECALL`. Every agent in the chat, sub-agents included, shares it.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `mock` | `mock` or `anthropic` |
| `ANTHROPIC_API_KEY` | | Required for `anthropic`. Without it the mock is used. |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Default model id. A job can pick another with `"model"` in its spec, or from the chat's model picker. |
| `REQUIRE_USER_KEY` | | `true` makes every job bring its own Anthropic key (the `x-provider-key` header, set from the chat's Advanced panel). The server's key is never used. |
| `SANDBOX_PROVIDER` | `local` | `local` or `e2b` |
| `E2B_API_KEY` | | Required for `e2b`. Without it `local` is used. |
| `MAX_CONCURRENCY` | `4` | Running process cap |
| `AGING_FACTOR` | `1` | Priority points per second spent READY |
| `RATE_LIMIT_RPM` / `RATE_LIMIT_TPM` | `50` / `200000` | Provider rate limits |
| `KERNEL_DB_PATH` | `data/kernelagent.db` | SQLite file. Relative paths resolve from where you ran the command. |
| `MOCK_LATENCY_MS` | `400` (API) | Mock delay per call, to make runs watchable |
| `KERNEL_DEV_TOKEN` | | If set, API requests need `Authorization: Bearer <token>` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | API the console connects to |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | | OTLP/HTTP endpoint. Console exporter if unset. |

## Example workload

Two workloads live in `examples/`. Each has a `job.json` and a `mock-script.ts` that makes the mock model take plausible steps. With a real provider the model decides the steps itself.

**coding-task.** One `coder` process writes `/primes.py`, runs it with `EXEC`, saves the output and the script to `/output/` (both come back as downloads), checkpoints, reads the output, and exits with it.

```
$ pnpm example:coding    # abbreviated: timestamps and some events removed
    5 PID 101  STATE_CHANGE      READY -> RUNNING (DISPATCH)
    6 PID 101  LLM_CALL          mock-llm in=655 out=98
    7 PID 101  SYSCALL           FS_WRITE   /primes.py           ok
    9 PID 101  SYSCALL           EXEC       mkdir -p output && python3 primes.py > output/primes.txt ok
   11 PID 101  CHECKPOINT        note="primes.py written and executed" atSequence=10
   14 PID 101  SYSCALL           FS_READ    /output/primes.txt   ok
   17 PID 101  PROCESS_EXIT      result="2 3 5 7 11 13 17 19 23 29 31 37 41 43 47"
   18 PID 101  STATE_CHANGE      RUNNING -> TERMINATED (EXIT)
```

**research-pipeline.** A planner `SEND`s one question to each of two researchers, which block on `RECEIVE` until it arrives. They `SEND` answers to a reviewer that `dependsOn` both. The reviewer first tries to `SPAWN` a fact-checker with `EXEC`, which it does not hold. The kernel denies it. It then spawns one with only `SEND` back to itself, waits for the verdict, writes `/output/report.md`, and exits.

```bash
pnpm example:research
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm example:research
```

**approval-gate** (`examples/approval-gate.json`). The coding task with `EXEC` behind human approval. The process waits in `WAITING approval` until you press approve in the console inspector or send `{"signal":"approve"}`. `pnpm demo` submits all three jobs.

## Architecture decisions

Every choice the brief left open is logged in [docs/decisions.md](docs/decisions.md). The main ones:

- No build step. Packages export TypeScript source. tsx runs it and vitest tests it.
- The kernel runs processes through a `ProcessRunner` interface, so it never imports the runtime.
- Extra state transitions: kill from any live state, `NEW -> FAILED` on a failed dependency, and timeout from `READY` or `WAITING`.
- One blocking mechanism for `RECEIVE`, `SLEEP`, and approval. A blocked process releases its slot and resumes through the scheduler.
- The console derives all state from the WS event stream with the same reducer the replay test checks.

## Limitations

- **No preemption.** A long model call holds its slot until it returns. The kernel can abort it but not pause it.
- **LocalSandbox is not isolation.** Use E2B for anything untrusted.
- **Checkpoints skip the filesystem.** A resumed process sees files as they are now.
- **At-least-once effects** after the last checkpoint.
- **One kernel process.** No distributed workers or external queue. A kernel restart marks in-flight processes `FAILED` with `KERNEL_RESTART`.
- **`NET` is a capability without a syscall.** `EXEC` in LocalSandbox is not network-restricted.
- **Cost is an estimate** from the price table in `packages/kernel/config.ts`.
- **Live provider tests** (`tests/live-providers.test.ts`) run only when `ANTHROPIC_API_KEY` or `E2B_API_KEY` is set. The Claude and E2B paths are typechecked but were not exercised in CI.
- **Auth** is an optional shared dev token.

## Roadmap

- A `FETCH` syscall gated by `NET` host allowlists.
- Sandbox filesystem snapshots at checkpoints, where the provider supports them.
- Streaming model calls, so a turn can be cancelled cleanly mid-generation.
- Resume in-flight processes from checkpoints after a kernel restart.
- Per-job concurrency quotas and fair sharing across jobs.
- Richer approval policies (per path, per command pattern).
