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
- **Default DB path** `./data/kernelagent.db` (override with `KERNEL_DB_PATH`). Tests and `scripts/run-job.ts` use `:memory:`.
- **Extra columns:** `processes.enqueued_at`, `timeout_ms`, `runtime_ms`, `result`; `messages.job_id`.

## LLM

- **Default Anthropic model** `claude-opus-5`, overridable with `ANTHROPIC_MODEL`. Non-streaming `messages.create` with `max_tokens` 16000.
- **Opaque blocks.** Provider blocks the kernel does not interpret (thinking blocks) travel as `{type: "opaque"}` and go back to the provider unchanged on the next turn.
- **Fallback to mock.** `LLM_PROVIDER=anthropic` without `ANTHROPIC_API_KEY` logs a warning and uses the MockLLM, so the system never refuses to boot.
- **Mock is stateless.** The MockLLM picks its script step from the number of assistant turns in the conversation, so a process resumed from a checkpoint continues at the right step.
- **Price table** in `packages/kernel/config.ts`. Unknown models use a default rate.
