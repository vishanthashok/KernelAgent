# Architecture

KernelAgent is a control plane that runs each AI agent as an OS-style process. A job becomes a set of processes. The scheduler dispatches them to a worker. Each process touches the world only through syscalls, checked against its capabilities, inside its own sandbox. Every state change, model call, and syscall lands in an append-only event log.

## Diagram

```
                 POST /jobs                         WS /events/stream
  client ───────────────────────┐          ┌─────────────────────────────▶ console
                                ▼          │                              (Next.js)
 ┌──────────────────────────── apps/api (Fastify) ─────────────────────────────┐
 │                                                                             │
 │  ┌────────────────────────── packages/kernel ────────────────────────────┐  │
 │  │                                                                       │  │
 │  │  job-spec ──▶ ProcessManager ◀──── only mutator of status             │  │
 │  │   (zod, DAG)   state machine ─────────────┐                           │  │
 │  │                  │  ▲                     │ STATE_CHANGE              │  │
 │  │       NEW→READY  │  │ READY→RUNNING       ▼                           │  │
 │  │                  ▼  │               ┌──────────┐   ┌───────────────┐  │  │
 │  │              Scheduler ────────────▶│ EventBus │──▶│ SQLite events │  │  │
 │  │   priority + aging, MAX_CONCURRENCY │ (append- │   │ (append-only, │  │  │
 │  │   rate-limit admission              │   only)  │   │  seq = rowid) │  │  │
 │  │                  │                  └────┬─────┘   └───────────────┘  │  │
 │  │                  │ dispatch              ├──▶ WS broadcaster          │  │
 │  │                  ▼                       └──▶ OpenTelemetry           │  │
 │  │   ResourceManager: token budgets, cost, RPM/TPM buckets, timeouts     │  │
 │  │   CapabilityManager: check, attenuate on SPAWN                        │  │
 │  │   SyscallDispatcher: validate → capability → resource → approval      │  │
 │  │                      → execute → SYSCALL event                        │  │
 │  └────────────┬───────────────────────────────┬──────────────────────────┘  │
 │               │ ProcessRunner                 │ SandboxAdapter / Channel     │
 │  ┌────────────▼──────────────┐     ┌──────────▼─────────┐  ┌─────────────┐  │
 │  │ packages/runtime          │     │ packages/sandbox   │  │ packages/ipc│  │
 │  │  Worker → execution loop  │     │  LocalSandbox (dev)│  │  mailboxes  │  │
 │  │  model ⇄ syscalls (tools) │     │  E2BSandbox        │  │  (SQLite)   │  │
 │  └────────────┬──────────────┘     └────────────────────┘  └─────────────┘  │
 │               │ ModelClient                                                 │
 │  ┌────────────▼──────────────┐                                              │
 │  │ packages/llm              │                                              │
 │  │  MockLLM | AnthropicClient│                                              │
 │  └───────────────────────────┘                                              │
 └─────────────────────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Role | Depends on |
|---|---|---|
| `packages/kernel` | Process model, scheduler, capabilities, syscalls, resources, event bus, replay | db, llm, sandbox, ipc, telemetry |
| `packages/runtime` | `Worker` and the per-process execution loop | kernel, llm |
| `packages/llm` | `ModelClient` interface, `MockLLM`, `AnthropicClient` | none |
| `packages/sandbox` | `SandboxAdapter` interface, `LocalSandbox`, `E2BSandbox` | none |
| `packages/ipc` | Mailboxes and delivery | db |
| `packages/db` | SQLite schema and repositories | none |
| `packages/telemetry` | OpenTelemetry setup, span helpers, kernel metrics | none |
| `apps/api` | Fastify HTTP API and WebSocket stream | kernel, runtime |
| `apps/console` | Next.js monitor | kernel (replay reducer only) |

The kernel never imports the runtime. It calls a `ProcessRunner` interface that the API wires to `Worker`. Provider SDKs (`@anthropic-ai/sdk`, `@e2b/code-interpreter`) are only imported inside their adapters.

## Lifecycle of a job

1. `POST /jobs` validates the spec with zod, checks the DAG, and emits `JOB_SUBMITTED`.
2. Each process is created in `NEW` (`PROCESS_CREATED`). Processes with no dependencies move to `READY`.
3. The scheduler picks the highest effective priority `READY` process whose dependencies all exited, if a slot is free and the rate limiter admits it. It emits `PROCESS_SCHEDULED`, moves it to `RUNNING`, and reserves one model request.
4. The worker runs the execution loop. It creates a sandbox if the process holds `FS_*` or `EXEC`, builds the system prompt, and calls the model with the permitted syscalls as tools. Each model call emits `LLM_CALL` with the full request and response.
5. Each `tool_use` becomes a syscall. The dispatcher validates, checks capability, checks budget and deadline, waits for approval if needed, executes, and emits `SYSCALL`.
6. Blocking syscalls (`RECEIVE`, `SLEEP`, approval) move the process to `WAITING` and free its slot. A wake moves it to `READY`. The scheduler resumes it later.
7. `EXIT`, or a final text answer, emits `PROCESS_EXIT` and moves it to `TERMINATED`. Dependents whose dependencies have all exited move `NEW -> READY`.
8. When every process has settled, the job is `COMPLETED` (all exited) or `FAILED`.

## State machine

```
            SUBMITTED / DEPENDENCIES_MET
   NEW ─────────────────────────────▶ READY ◀──────────────┐
    │                                  │  ▲                │ wake (MESSAGE,
    │ DEPENDENCY_FAILED       DISPATCH │  │ YIELD          │  SLEEP_DONE,
    ▼                                  ▼  │                │  APPROVED, ...)
  FAILED ◀─────── crash / budget ──── RUNNING ─────────▶ WAITING
    │     timeout                       │     block
    │                                   │ EXIT
    └── RETRY (retryCount < max) ──▶ READY
                                        ▼
                                   TERMINATED   (also reached by kill from any live state)
```

The brief's transitions are all present. The extensions (kill from any live state, `NEW -> FAILED`, timeouts from `READY` and `WAITING`) are listed in `docs/decisions.md`. Any other transition throws `IllegalTransitionError`.

## The event log

- `EventBus.emit()` inserts into SQLite synchronously. The row id is the sequence number, so the sequence is assigned before any subscriber sees the event.
- SQLite triggers reject `UPDATE` and `DELETE` on `events`.
- The `processes` table is a cache of current state. `packages/kernel/replay.ts` rebuilds every process field from events alone, and `tests/replay.test.ts` asserts it matches the live table field for field.
- `LLM_CALL` holds the system prompt, messages, tool definitions, raw response, token counts, cost, and duration. The console's Traces tab replays a job to any sequence number with this data.

## Where the OS analogy stops

The OS vocabulary is useful, but an agent kernel differs from a real one in ways that matter. Here they are, stated plainly.

**No preemption.** A model call cannot be paused mid-generation. The scheduler only regains control at yield points: a syscall, the end of a turn, a block, or an exit. A process in the middle of a long model call keeps its slot until the call returns. The kernel can abort that call (kill, timeout) but cannot suspend and resume it. This is cooperative multitasking, like Windows 3.x, not a timer interrupt.

**No CPU to schedule.** The scarce resources are tokens, dollars, wall-clock time, and provider rate limits. The scheduler's real job is bounding concurrency against those. `CPU*` in the console is the share of a process's life spent `RUNNING`. It is labeled "not real CPU" everywhere.

**Priority is advisory at turn granularity.** A high-priority process that becomes `READY` waits for a free slot. It does not interrupt a running one. Aging (`priority + agingFactor × seconds waiting`) prevents starvation among `READY` processes. It cannot shorten a running turn.

**Checkpoints are not memory snapshots.** A checkpoint stores the conversation (the process's "registers and stack") and the event sequence. It does not snapshot the sandbox filesystem. A resumed process sees the files as they are now, not as they were at the checkpoint.

**No exactly-once execution.** Syscalls committed before the last checkpoint are not replayed on retry. Anything after it may run again. `EXEC` is marked `UNSAFE_REPLAY` for this reason. The model is told to checkpoint after risky effects. The kernel does not claim more.

**Isolation depends on the sandbox adapter.** `LocalSandbox` confines file paths to a temp directory, but `EXEC` runs a real shell as the kernel's user. It is not a security boundary. `E2BSandbox` gives real isolation. Capabilities limit what a process asks for. Only the sandbox limits what a command can do once it runs.

**The model is not the process.** A process is kernel state: status, budget, capabilities, mailbox, history. The model is a stateless function the process calls each turn. Swapping `MockLLM` for Claude changes the decisions, not the process model.

**Syscalls are proposals.** The model proposes a syscall as a `tool_use` block. Nothing happens until the kernel validates it. A real CPU executes whatever instruction it fetches. Here, a bad or unauthorized request is rejected and logged, and the model sees the error.
