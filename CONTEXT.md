# CONTEXT.md: agent handoff

Read this first if you are picking up KernelAgent. It says what was built, how the code is laid out, what you must not break, and what is left.

## What this is

KernelAgent runs AI agents as OS-style processes. A job becomes processes with dependencies. A scheduler dispatches them from a ready queue. Each process acts only through syscalls checked against its capabilities, inside a sandbox. Every state change, model call, and syscall is written to an append-only event log. A Next.js console shows it like `top`.

It was built from a brief with four phases. The brief's spine: process model, scheduler, syscall interface, sandbox isolation, event log. Stack: TypeScript strict, pnpm workspaces, tsx, vitest, Fastify, Next.js + Tailwind, SQLite (better-sqlite3), zod, `@anthropic-ai/sdk`, `@e2b/code-interpreter`, OpenTelemetry.

## Current state

Branch: `claude/optimistic-newton-ikkywj`. All four phases are done and pushed.

| Commit | Content |
|---|---|
| Phase 1 | Process model, state machine, scheduler, DAG gating, event log, SQLite, MockLLM, minimal API, CLI |
| Phase 2 | Syscall dispatcher, capabilities and attenuation, LocalSandbox, E2BSandbox, IPC, execution loop, AnthropicClient |
| API/telemetry | Full API, WS stream with sinceSeq backfill, OpenTelemetry spans and metrics, replay reducer |
| Phase 3 | Console (processes, task graph, IPC, sandboxes, traces with rewind, inspector), example workloads |
| Phase 4 | Kill/timeout/retry/approval tests, integration tests, README, architecture and ABI docs, demo script |

Verify it yourself:

```bash
pnpm install
pnpm typecheck            # root tsc + console tsc
pnpm test                 # 95 pass, 2 skipped (live providers, need keys)
pnpm example:coding       # in-process run, prints the event log
pnpm example:research
pnpm demo                 # API :4000 + console :3000, submits 3 jobs
```

## Map of the code

Kernel (`packages/kernel`):
- `kernel.ts`: composition root. Job submit, run lifecycle (`startRun`, `RunHandle` generations), `callModel`, `block`/`wake`/`yield`, `exit`, `kill`, `signal`, `checkpoint`, retry policy, timeout watchdog, job completion, spans.
- `process-manager.ts`: process table and state machine (`TRANSITIONS`). The only code that changes `status`.
- `scheduler.ts`: priority queue with aging, concurrency cap, admission check.
- `syscall.ts`: zod schemas, `SYSCALLS` registry, `syscallTools()`, `SyscallDispatcher` pipeline.
- `capabilities.ts`: `CapabilityManager.check` and `attenuate`, scope rules.
- `resource-manager.ts`: `TokenBucket`, `RateLimiter` (with per-pid reservations), budgets, cost.
- `event-bus.ts`: append to SQLite, then fan out to subscribers.
- `replay.ts`: dependency-free reducer that rebuilds process state from events. The console imports it.
- `job-spec.ts`, `types.ts`, `config.ts` (limits, price table, DB path).

Runtime (`packages/runtime`): `worker.ts` (the `ProcessRunner`), `execution-loop.ts` (model call, tool_use to syscall, turn-boundary yield), `context.ts` (system prompt, checkpoint snapshot and restore).

Adapters:
- `packages/llm`: `index.ts` (ModelClient interface, block types), `mock.ts`, `anthropic.ts`, `factory.ts`.
- `packages/sandbox`: `types.ts`, `local.ts`, `e2b.ts`, `index.ts` (`createSandbox`).
- `packages/ipc`: `mailbox.ts`, `channel.ts`.
- `packages/db`: `schema.sql`, `repositories.ts`.
- `packages/telemetry/index.ts`: SDK init, `withSpan`, `startSpan`, `registerKernelMetrics`.

Apps:
- `apps/api/server.ts`: all routes and `WS /events/stream`. `apps/api/main.ts`: boot, loads example mock scripts.
- `apps/console`: `lib/useKernel.ts` (WS client, folds events), `lib/api.ts` (REST calls incl. `submitJob`), `lib/format.ts`, `components/*` (one per tab plus `Inspector.tsx` and `NewJob.tsx`, the prompt box that submits jobs).

Other:
- `examples/coding-task`, `examples/research-pipeline` (job.json + mock-script.ts), `examples/approval-gate.json`, `examples/hello-dag.json`, `examples/run.ts`, `examples/scripts.ts`.
- `scripts/run-job.ts`, `scripts/format-log.ts`, `scripts/demo.sh`.
- `tests/`: one file per area. `helpers.ts` has `makeKernel()` and `syscallEvents()`.
- `docs/`: `architecture.md`, `syscall-api.md`, `decisions.md`, `demo-script.md`.

## Invariants: do not break these

1. Only `ProcessManager.transition()` changes a process's status. Every transition emits `STATE_CHANGE`.
2. The `events` table is append-only. SQLite triggers enforce it. Never add UPDATE or DELETE.
3. Every syscall emits exactly one `SYSCALL` event, including validation failures and denials.
4. Every kernel call from a runner passes its `RunHandle`. Stale runs (killed, timed out, retried) must fail `assertLive`.
5. `replayProcesses(events)` must equal the live table. `tests/replay.test.ts` checks every field. If you add a process field, update `replay.ts` and emit the data in an event.
6. Provider SDKs are imported only inside their adapter file.
7. `pnpm test` must pass with no API keys.
8. SPAWN never grants a capability wider than the parent's.
9. A blocked process never holds a concurrency slot.
10. Record any new design choice in `docs/decisions.md`.

## How to extend

Add a syscall:
1. Schema and registry entry in `packages/kernel/syscall.ts` (capability, retry safety, handler). Add it to `SyscallRequestSchema`.
2. If it needs a new capability type, add it to `types.ts`, `job-spec.ts`, and scope rules in `capabilities.ts`.
3. Document it in `docs/syscall-api.md` and the README table.
4. Add tests in `tests/syscalls.test.ts`. Update the tool-list test.

Add an example workload: a folder in `examples/` with `job.json` and `mock-script.ts`, register the scripts in `examples/scripts.ts` (roles must be unique across examples), add a script in root `package.json`.

Add an API route: `apps/api/server.ts`, test with `app.inject` in `tests/api.test.ts`, note it in `docs/decisions.md` if it is beyond the brief's route list.

## What is left, in priority order

1. **Real-provider verification.** Run `pnpm example:coding` and `pnpm example:research` with `LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=...`, and `tests/live-providers.test.ts` with `ANTHROPIC_API_KEY` and `E2B_API_KEY`. This Phase 4 item was never run because no keys were available. Expect prompt tuning in `packages/runtime/context.ts`.
2. **Demo GIF.** Record `docs/demo.gif` following `docs/demo-script.md`. The README links to it.
3. **CI.** No GitHub Actions workflow yet. Add one that runs `pnpm install`, `pnpm typecheck`, `pnpm test`, and the console build.
4. **Known gaps:**
   - `RECEIVE` capability scopes are not supported (unscoped only).
   - LocalSandbox `EXEC` is not network-restricted and is not a security boundary.
   - The default OTel console exporter is noisy in the API terminal.
   - The console has no component tests.
   - A kernel restart fails in-flight processes instead of resuming them.
5. **Roadmap** (from the README): `FETCH` syscall gated by `NET`, sandbox filesystem snapshots at checkpoints, streaming model calls, resume after restart, per-job concurrency quotas, richer approval policies.

## Chat

- `/` is the chat (`apps/console/components/chat/*`), `/console` is the monitor (`components/Console.tsx`).
- Each user message is one job with one process. With "Include conversation history" on, `lib/chats.ts` `buildGoal()` prepends the last 8 turns (12k chars max) to the goal. Each turn gets a fresh sandbox, so earlier files are not available to later turns.
- Conversations live in the browser's `localStorage` (`kernelagent.chats`), not on the server.
- `lib/steps.ts` turns a job's events into the step list shown in the thread. `lib/permissions.ts` is shared by the chat and the New Job modal.

## Output and files

- The console's **Output** tab (default tab) shows each process's EXIT result as the answer, and download cards for files.
- Agents hand back files by writing them to `/output/` in their sandbox. On exit, `Kernel.afterExit` copies them into the `artifacts` table via `SandboxAdapter.collectFiles`, emits `ARTIFACT` events, then destroys the sandbox. A job completes only after this cleanup (`pendingCleanups` in `kernel.ts`).
- API: `GET /artifacts?jobId=`, `GET /artifacts/:id` (download, `?token=` works for the dev token).

## Gotchas

- `KERNEL_DB_PATH` resolves against `INIT_CWD` (set by pnpm), so `pnpm dev:api` writes to `./data/` at the repo root, not `apps/api/data/`.
- The Next.js server renames itself `next-server`. Kill it by that name or port 3000 stays busy.
- MockLLM picks its script step by the number of assistant turns in the conversation. It is stateless, which is why checkpoint resume works with it.
- The API (mock mode) loads all example mock scripts and adds 400 ms latency per call (`MOCK_LATENCY_MS`). `pnpm demo` uses 700 ms and disables OTel.
- Tests use `:memory:` SQLite and a real LocalSandbox in the OS temp dir. `python3` must exist for the coding example.
- Pushes go straight to `main`. The owner does not want a PR.
- Deployed: API on Railway (`kernelagentapi-production.up.railway.app`, listens on Railway's `PORT`, needs `HOST=0.0.0.0` and a `/data` volume). Console on Vercel with Root Directory `apps/console` and `NEXT_PUBLIC_API_URL` set to the Railway URL.
