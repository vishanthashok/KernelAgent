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
pnpm test                 # 124 pass, 2 skipped (live providers, need keys)
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
5. **Connectors** (planned, see `docs/decisions.md`): an `MCP` syscall behind a `CONNECTOR` capability, OAuth per connector on `/connect`.
6. **OpenAI live check.** Run a job with a real OpenAI key. The adapter is only unit-tested.
7. **Roadmap** (from the README): `FETCH` syscall gated by `NET`, sandbox filesystem snapshots at checkpoints, streaming model calls, resume after restart, per-job concurrency quotas, richer approval policies.

## Landing, sign-in, and keys

- `/` is the public landing page (`components/landing/Landing.tsx`). `/login` has GitHub and Google buttons (server actions in `app/actions.ts`). `/connect` (`components/connect/ConnectKeys.tsx`) adds and checks a Claude and an OpenAI key.
- `apps/console/auth.ts` configures Auth.js (JWT, no DB). `authEnabled` is false unless `AUTH_SECRET` and a provider's id and secret are set. Without them every page is open and the auth route returns 404.
- `proxy.ts` gates `/chat`, `/console`, `/dashboard`, `/connect`. `components/shell/UserMenu.tsx` shows the avatar, "API keys", and "Sign out".
- Keys: `lib/userKey.ts` stores one per provider and migrates the old single key. `api.submitJob(spec, model)` sends the key for the model's provider. `useModels` merges each provider's models from the user's key or the server.

## Chat

- `/chat` is the chat (`apps/console/components/chat/*`), `/console` is the monitor (`components/Console.tsx`).
- Each user message is one job with one process. The goal is the message alone. With "Chat memory" on, the spec sets `memoryScope` to the chat id and the process gets the `MEMORY` capability, so context comes from the chat's memory (see below), not a resent transcript. Each turn gets a fresh sandbox, so earlier files are not available to later turns.
- Advanced options: model, effort (unset means the model default), "Sub-agents at low effort" (sets `subagentEffort`), role, token budget, permissions, approval, chat memory.
- Conversations live in the browser's `localStorage` (`kernelagent.chats`), not on the server.
- `lib/steps.ts` turns a job's events into the step list shown in the thread. `lib/permissions.ts` is shared by the chat and the New Job modal.

## Models and user keys

- Providers: `packages/llm/openai.ts` (Chat Completions) and `packages/llm/router.ts` (`RoutingClient`, picks by model id, `providerForKey` by key prefix). `LLM_PROVIDER=multi` builds the router. `GET /models?provider=` lists one provider, and the response has `providers` with `requiresUserKey` for each.

- `GET /models` lists what the provider offers (Anthropic Models API, cached 10 min, built-in fallback). A job spec's `model` applies to every process in the job, spawned children included. `Kernel.modelFor(jobId)` resolves it.
- A user key arrives as the `x-provider-key` header. `Kernel.submitJob(spec, { apiKey })` keeps it in memory only (`jobKeys`) and drops it when the job settles. It must never reach the spec, the DB, or an event: events stream to every console. `tests/api.test.ts` checks this.
- The API server never uses its own keys unless `ALLOW_SERVER_KEY=true` (`apiModelEnv` in `packages/llm/factory.ts`). Every job must bring the visitor's key.
- A job that brought a key never falls back to the server key. A retry after the key is dropped fails and asks for a resubmit.
- The console stores keys in localStorage (`kernelagent.providerKey.anthropic`, `.openai`) and the last picked model in `kernelagent.model`.

## Design system

- Datadog-style: every page sits in `components/shell/AppShell.tsx` (dark nav rail, a top bar on phones) with a `PageHeader` title bar. Widgets are `card` (flat panel, hairline border, 4px radius).
- Themes: dark by default (`data-theme="dark"` on `<html>` in `app/layout.tsx`), light via the rail toggle (`lib/theme.ts`, saved as `kernelagent.theme`). An inline script in `app/layout.tsx` applies it before paint.
- All colors are CSS variables in `app/globals.css` (`:root` light, `[data-theme="dark"]` dark), exposed as Tailwind colors (`term-*`, `ink`, `sunk`, `accent`, `ok`, `warn`, `danger`). Use those or `dark:` variants, never raw hex or `white/`/`black/` tints. Chart series and status colors are validated per theme.

## Dashboard

- `/dashboard` (`apps/console/components/dashboard/*`) reads `GET /metrics?range=15m|1h|6h|24h|7d`. It does not use the WS stream, so it works for long windows.
- `apps/api/metrics.ts` `buildMetrics` aggregates `MetricsRepo` rows (json_extract over `events`, index `events_type_time`) into 60 buckets, totals, previous-window totals, by-model, top jobs, and recent errors. The route adds live process counts.
- Charts are plain SVG (`TimeChart.tsx`). Colors are CSS variables in `app/globals.css`, from a palette validated against the card surface. Keep categorical slots in order, and keep status colors for states only.
- `/console?job=<id>` preselects a job. The dashboard links there.

## Chat memory

- Table `memories` (not append-only), `MemoryRepo` in `packages/db/repositories.ts`. Scope = chat id.
- `REMEMBER`/`RECALL` syscalls need `MEMORY`. When a top-level process (no parent) exits in a scoped job, `Kernel.exit` saves a `turn` entry ("User asked / Answer", clipped).
- `Kernel.memoryContext(jobId)` picks the newest entries up to `MEMORY_PROMPT_CHARS` (6000). `runExecutionLoop` puts them in the system prompt once, at process start, so the prompt stays byte-stable for caching.
- API: `GET /memory?scope=`, `DELETE /memory/:id`, `DELETE /memory?scope=`. Deleting a chat in the console clears its memory.

## Token spend

- `AnthropicClient.complete` sets top-level `cache_control: {type: "ephemeral"}`. Anything that changes the system prompt or tool list mid-process breaks the cache. Keep both fixed per process.
- `CompletionResponse.inputTokens` is total input, cached or not. `cacheReadTokens`/`cacheWriteTokens` are the cached parts. `costUsd()` prices reads at 0.1x and writes at 1.25x input. `LLM_CALL` events carry both counts and `cacheSavingsUsd`.
- Effort: spec `effort` for listed processes, `subagentEffort` (default `low`) for spawned ones, `Kernel.effortFor`. The Anthropic client sends it only to models matching `EFFORT_MODELS`. Haiku 4.5 rejects effort.
- Budgets are cache-weighted (`budgetTokens` in `packages/kernel/budget.ts`, shared with replay).
- Near its budget, a process rolls over: `Kernel.rollover` adds its starting budget (max `MAX_ROLLOVERS`, clamped to the job budget), emits `BUDGET_EXTENDED`, and the loop swaps the history for a digest (`ProcessContext.compact`). With no rollover left, the loop asks for EXIT. A finishing reply is kept even if it crossed the budget.
- A process that ends sends its live parent a `CHILD_EXIT` message. If every live process in a job waits on RECEIVE with an empty mailbox, RECEIVE returns `{closed: true}`.
- Tool results sent to the model are capped at 16k chars (`capToolResult`). Peer goals in the system prompt are clipped to 200 chars.

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
