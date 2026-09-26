# Architecture decisions

Choices the brief left open, and deviations from it, with the reason for each.

## Workspace and tooling

- **No build step.** Every workspace package exports its `.ts` source (`"exports": {".": "./index.ts"}`). tsx runs apps and scripts, vitest runs tests, and `tsc --noEmit` typechecks the whole repo from the root `tsconfig.json`. This keeps a fresh clone runnable with `pnpm install`.
- **Extra files beyond Section 5.** `packages/kernel/types.ts` (canonical models), `job-spec.ts` (zod job spec + DAG validation), `config.ts` (limits and price table), `kernel.ts` (composition root), `index.ts` barrels in each package, and `packages/llm/factory.ts` (provider selection).
- **Dependency direction.** `db`, `llm`, `sandbox`, `ipc`, `telemetry` are leaves. `kernel` depends on them. `runtime` depends on `kernel`. The kernel runs processes through a `ProcessRunner` interface that `runtime` implements, so there is no package cycle.
- **zod 4.** Current major. Tool JSON schemas come from `z.toJSONSchema`, so no `zod-to-json-schema` dependency.
- **TypeScript 5.9 and vitest 3.** TypeScript 7 (native port) and vitest 5 were available, but 5.9/3.x are the conservative choice for Next.js compatibility.

## Process model

- **Extra fields on `Process`:** `timeoutMs` (wall-clock limit), `runtimeMs` (time spent RUNNING, used for the derived CPU* figure), and `result` (the EXIT value).
- **Extra state transitions** beyond the brief's table:
  - any live state `-> TERMINATED` for kill,
  - `NEW -> FAILED` when a dependency fails permanently (`DEPENDENCY_FAILED`),
  - `READY -> FAILED` and `WAITING -> FAILED` for a timeout while not running.
- **Dependency gating uses NEW.** A process with unmet dependencies stays `NEW` and is promoted `NEW -> READY` when all its dependencies TERMINATE. The scheduler also re-checks dependencies before dispatch.
- **A killed process does not satisfy a dependency.** Kill sets `error = "KILLED"` and moves the process to TERMINATED. Dependents of a killed process fail with `DEPENDENCY_FAILED`.
- **PIDs** are decimal strings from a counter starting at 101, continued across restarts from the highest pid in the database. Job ids are `job_` plus 8 hex chars.
- **Kernel restart.** Processes left live by a previous kernel run have no execution loop behind them. On boot they are marked FAILED with `KERNEL_RESTART` (emitting `PROCESS_CRASH` and `STATE_CHANGE`), and their jobs are marked FAILED.
- **PROCESS_EXIT is emitted before the final STATE_CHANGE** so the exit record precedes any dependents becoming READY.

## Scheduler and resources

- **Aging factor unit:** priority points per second spent READY (default 1).
- **Tie-break:** effective priority, then earliest `enqueuedAt`, then lowest pid.
- **Rate limiter admission.** The scheduler checks that the provider's request bucket has at least one token and the token bucket is not empty. It does not reserve tokens. The actual take happens when the model is called (`RateLimiter.acquire`), which waits if needed. Estimated tokens are reconciled with the real count after the call.
- **Budgets.** A process budget and an optional job budget (`JobSpec.tokenBudget`). Budget failures are not retried, since a retry would fail the same way.
- **Retry scope.** Retries apply to any FAILED process except `TOKEN_BUDGET_EXCEEDED`, `JOB_TOKEN_BUDGET_EXCEEDED`, `DEPENDENCY_FAILED`, and `KERNEL_RESTART`. A retry clears `startedAt`, so the wall-clock timeout applies per attempt.

## Persistence

- **better-sqlite3, synchronous.** The event log insert is synchronous, so `sequence` is assigned before any subscriber sees the event. SQLite triggers reject UPDATE and DELETE on `events`.
- **Default DB path** `data/kernelagent.db` (override with `KERNEL_DB_PATH`). Relative paths resolve against the directory the command was run from (`INIT_CWD` under pnpm), not the package directory pnpm switches into. Tests, `scripts/run-job.ts`, and `examples/run.ts` use `:memory:`.
- **Extra columns:** `processes.enqueued_at`, `timeout_ms`, `runtime_ms`, `result`; `messages.job_id`.

## LLM

- **Default Anthropic model** `claude-opus-5`, overridable with `ANTHROPIC_MODEL`. Non-streaming `messages.create` with `max_tokens` 16000.
- **Opaque blocks.** Provider blocks the kernel does not interpret (thinking blocks) travel as `{type: "opaque"}` and go back to the provider unchanged on the next turn.
- **Fallback to mock.** `LLM_PROVIDER=anthropic` without `ANTHROPIC_API_KEY` logs a warning and uses the MockLLM, so the system never refuses to boot.
- **Mock is stateless.** The MockLLM picks its script step from the number of assistant turns in the conversation, so a process resumed from a checkpoint continues at the right step.
- **Price table** in `packages/kernel/config.ts`. Unknown models use a default rate.

## Syscalls and capabilities

- **Tool name == syscall name.** The model calls a tool named `FS_WRITE` with the syscall's `args` as its input. The loop wraps it as `{type, args}` and hands it to the dispatcher, which validates it with zod.
- **Only permitted tools are shown.** A process sees the syscalls its capabilities allow, plus `SLEEP`, `CHECKPOINT`, `EXIT`. It can still name any tool, and the dispatcher denies it. Least authority applies to what the model is told too.
- **Capability scopes.** FS: a path prefix (normalized, `..` collapsed). NET: comma-separated host allowlist, `*.domain` wildcards. SEND: comma-separated pid list. EXEC and SPAWN: exact-match label. RECEIVE: unscoped only (a process only reads its own mailbox). An unscoped capability covers any scope, and a scoped one never grants an unscoped child.
- **Approval is inherited.** A child spawned from an approval-gated capability keeps the gate.
- **SPAWN budget attenuates too.** A child's token budget is capped at half the parent's remaining budget.
- **SPAWN escalation is logged as a denial** (`denied: true`, `code: "DENIED"`), same as a missing capability.
- **NET has no syscall yet.** The brief's syscall table has no network call, so `NET` exists as a capability type only. `EXEC` in `LocalSandbox` is not network-restricted (it is not a security boundary).
- **SEND stays inside the job.** A process can only message pids in its own job.
- **EXIT emits its SYSCALL event before PROCESS_EXIT.** A final text answer with no tool call is dispatched as an `EXIT` syscall so it is logged the same way.
- **Syscall results to the model.** Strings are passed through, objects are JSON. Large outputs are clipped at 20,000 characters.

## Blocking and cooperative scheduling

- **One mechanism for all blocking.** `RECEIVE` on an empty mailbox, `SLEEP`, and the approval gate all call `kernel.block()`: `RUNNING -> WAITING`, emit `BLOCKED`, release the slot, and await a continuation. `wake()` moves the process `WAITING -> READY`. When the scheduler dispatches it again (`READY -> RUNNING`), the continuation resolves. A blocked process never holds a concurrency slot.
- **Turn-boundary yield.** After each turn, if the ready queue is non-empty and all slots are busy, the process yields (`RUNNING -> READY`). This keeps long agents from monopolizing slots.
- **Rate-limit reservations.** Dispatch reserves one request from the provider bucket for the process. Its next model call consumes the reservation. Ending the run releases it. This stops one scheduler tick from admitting more processes than the bucket can serve.
- **E2B paths are rooted at `/home/user`.** `E2BSandbox` maps `/x` and `x` to `/home/user/x` and collapses `..`, the same semantics as LocalSandbox, and runs commands in `/home/user`.
- **Sandboxes are created lazily** at first dispatch, and only for processes holding `FS_READ`, `FS_WRITE`, or `EXEC`. The sandbox survives retries and is destroyed when the process ends for good.

## Checkpoints

- **What is stored.** The CHECKPOINT event holds the message history up to the assistant turn that called CHECKPOINT, results of tool calls earlier in that turn, the current event sequence, and a sandbox marker. The sandbox filesystem is not snapshotted.
- **Resume.** On retry the loop rebuilds the context from the snapshot and closes the interrupted turn: CHECKPOINT gets a `{resumed: true}` result, and tool calls after it in the same turn get an error result saying they did not run.

## API and console

- **Extra read-only routes** beyond Section 13: `GET /health`, `GET /stats` (uptime, limits, rate-limiter saturation), `GET /jobs`, `GET /messages`, `GET /sandboxes`. The console needs them. No other mutations were added.
- **Dev token.** If `KERNEL_DEV_TOKEN` is set, every request needs `Authorization: Bearer <token>` (or `?token=` for the WebSocket). Unset by default.
- **WS handshake.** `?sinceSeq=N` on the URL, or a first message `{"sinceSeq": N}`. The server subscribes before it backfills, then flushes the buffered live events, dropping any sequence already sent. With no handshake in 1s it starts live from the current sequence.
- **The console derives all state from the event stream.** It folds events with `applyEvent` from `packages/kernel/replay.ts`, the same reducer the replay test checks against the live table. Rewind is `replayProcesses(events, untilSeq)`. Only `/stats` is polled.
- **CPU\*** is the share of a process's life (first dispatch to exit, or now) spent RUNNING. It is labeled "not real CPU" everywhere it appears.
- **Task Graph layout** is a hand-rolled layered SVG (column = 1 + deepest dependency or parent). No graph library.
- **Peers in the prompt.** The system prompt lists the other processes in the job (pid, role, goal) so a model can address SEND. The list is fixed when the run starts, so the prompt stays byte-stable across turns.
- **Example scripts in the API.** With the mock provider, the API loads the example workloads' mock scripts and adds 400 ms of latency per call (`MOCK_LATENCY_MS`), so example jobs submitted over HTTP behave like the CLI runs and are slow enough to watch.
- **MESSAGE events are emitted by the kernel's delivery hook**, before the receiver is woken, so the log shows the message before the `WAITING -> READY` it causes.

## Reliability and presentation

- **Timeouts are checked by a watchdog** on the scheduler tick interval (at least every 50 ms), not by a timer per process.
- **Kill aborts in-flight work.** Each run has an `AbortController` and a generation number. Kill, timeout, and retry abort the signal (cancelling a pending model call or rate-limit wait) and bump the generation, so a stale loop cannot act on the process.
- **The `retry` signal** re-queues a permanently FAILED process and sets its job back to RUNNING. Dependents already failed with `DEPENDENCY_FAILED` stay failed.
- **A third job file, `examples/approval-gate.json`,** reuses the coding-task script with `EXEC` behind the approval gate. `pnpm demo` submits it to show the gate. It is a demo aid, not a third workload.
- **`pnpm demo`** turns OpenTelemetry off by default so the console exporter does not flood the terminal. Set `OTEL_SDK_DISABLED=false` to keep it on.

## Console design

- **Portfolio-style dashboard.** The console matches the owner's portfolio: a floating light pill nav with spaced mono labels, a large Manrope headline, white and outline pill buttons, and glass cards on a dark dusk gradient. Fonts load through `next/font/google` (Manrope for text, JetBrains Mono for data). Shared styles live as Tailwind utilities in `apps/console/app/globals.css` (`card`, `label-caps`, `pill`, `pill-light`, `pill-dark`, `pill-ghost`), and process states render with `components/StateChip.tsx`.

## Output files

- **`/output/` is the hand-back folder.** Only files there are kept after a process ends. This keeps artifact storage bounded (20 files, 10 MB each per process) and makes intent explicit. Files are stored as SQLite BLOBs in `artifacts`, next to the event log.
- **`ARTIFACT` is a new event type** beyond the brief's list. It carries metadata only. The bytes live in the `artifacts` table.
- **A job completes after cleanup.** Job status flips to COMPLETED or FAILED only once every exited process's files are saved and its sandbox is destroyed, so the console never shows a finished job with files still missing.

## Chat

- **One message, one job.** The kernel has no conversation concept, so the chat maps each user message onto a new single-process job. Follow-ups carry the earlier turns inside the goal (last 8 turns, 12k characters). This keeps the kernel unchanged and makes every turn independently replayable. The cost is that each turn gets a fresh sandbox.
- **Chats are stored in localStorage.** They are per browser and not synced. Job data itself stays in the server's event log, so a chat's answers and files reappear as long as the API still has those jobs.
- **Routes.** `/` is the chat, `/console` is the monitor. Both use the same `useKernel()` stream.

## Budgets that end with an answer

- **Budgets are cache-weighted.** `tokensUsed` charges cached input at its price weight (reads 0.1x, writes 1.25x) through `budgetTokens()` in `packages/kernel/budget.ts`. Before, a process resending a mostly cached history paid 0.1x in money but 1x in budget, so children ran out after four or five turns. Replay uses the same helper.
- **Rollover, not death.** When a process has less than 20% of its budget left, or less than two calls like its last one, the execution loop asks `Kernel.rollover()` for another starting budget (at most `MAX_ROLLOVERS`, default 2, clamped to the job budget). On success it replaces the history with one message: the goal plus a digest of every tool call and the latest notes (`digestHistory` in `context.ts`). No extra model call. The pid, sandbox, and system prompt stay the same, so dependents, files, and the prompt cache all survive. `BUDGET_EXTENDED` is a new event type, and replay folds it into `tokenBudget`. Rollover counts live in kernel memory, since a kernel restart fails live processes anyway.
- **Wrap-up.** With no rollover left, the loop adds a note to the next user turn asking for EXIT with the best answer so far. The reply that finishes a process (EXIT or plain text) is kept even if that call crossed the budget. Any other reply that crosses it still fails the process, as before.
- **CHILD_EXIT.** When a process ends for good, the kernel sends its live parent a `{type: "CHILD_EXIT", pid, role, status, result | error + lastOutput}` message. A parent blocked on RECEIVE wakes instead of waiting on a dead child.
- **RECEIVE deadlock release.** If every live process in a job is blocked on RECEIVE with an empty mailbox, nothing can ever arrive. The kernel wakes them all, and RECEIVE returns `{closed: true, reason}`. The check runs when a process blocks on RECEIVE and when any process ends.
