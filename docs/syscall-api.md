# Syscall ABI

Syscalls are the only way a process affects the world. The source of truth is `packages/kernel/syscall.ts`: each syscall has a zod schema, a required capability, a handler, and a retry-safety class.

## Calling convention

A process's model sees one tool per permitted syscall. The tool name is the syscall name, and the tool input is the syscall's `args`:

```json
{ "type": "tool_use", "id": "toolu_1", "name": "FS_WRITE", "input": { "path": "/hello.py", "content": "print('hi')" } }
```

The execution loop turns that into a request and calls the kernel:

```ts
kernel.syscall(pid, { type: "FS_WRITE", args: { path: "/hello.py", content: "print('hi')" } })
```

A process is shown the syscalls its capabilities allow, plus `SLEEP`, `CHECKPOINT`, and `EXIT`. It may still name any syscall. The dispatcher denies what it does not hold.

## Dispatch pipeline

Every call runs these steps in order and emits exactly one `SYSCALL` event:

1. **Validate** the request against `SyscallRequestSchema` (a zod discriminated union). Failure returns `code: "VALIDATION"`.
2. **Capability check.** The syscall's capability request (type plus resource, such as a path or pid) must be covered by one of the process's capabilities. Failure returns `code: "DENIED"` and the event has `denied: true`. Nothing executes.
3. **Resource check.** The process must be `RUNNING` in the current run, under its token budgets, and before its deadline. Failure returns `code: "RESOURCE"`.
4. **Approval gate.** If the matching capability has `requiresApproval: true`, the process moves to `WAITING` with a `BLOCKED {reason: "APPROVAL"}` event until an operator sends `approve` or `deny`. Deny returns `code: "DENIED"` with `approval: "denied"`.
5. **Execute** against the sandbox, IPC, or process manager. A thrown error returns `code: "EXEC_ERROR"`. A capability escalation in `SPAWN` returns `code: "DENIED"`.
6. **Record** a `SYSCALL` event.

### Result

```ts
type SyscallResult =
  | { ok: true; value: unknown }
  | { ok: false; code: "VALIDATION" | "DENIED" | "RESOURCE" | "EXEC_ERROR" | "ABORTED"; error: string };
```

The model receives `value` as the `tool_result` content (strings as-is, objects as JSON), or `{error, code}` with `is_error: true`. Outputs longer than 20,000 characters are clipped.

### SYSCALL event payload

| Field | Meaning |
|---|---|
| `request` | The validated request, or the raw input on a validation failure |
| `ok` | Whether it succeeded |
| `code`, `error` | Failure class and message |
| `denied` | `true` for capability or approval denials |
| `required` | On a denial, the capability request that was not covered |
| `capability` | The capability that authorized the call |
| `approval` | `"approved"` or `"denied"` when the gate applied |
| `result` | The value returned to the process |
| `retrySafety` | `SAFE`, `EFFECTFUL`, `UNSAFE_REPLAY`, or `TERMINAL` |
| `sandboxId` | The process's sandbox, if it has one |
| `durationMs` | Wall-clock time, including time blocked |

## Syscalls

| Syscall | Capability | Args | Result | Retry safety | Other events |
|---|---|---|---|---|---|
| `FS_READ` | `FS_READ` on the path | `{path}` | file content (string) | `SAFE` | |
| `FS_WRITE` | `FS_WRITE` on the path | `{path, content}` | `{path, bytes}` | `EFFECTFUL` | |
| `EXEC` | `EXEC` | `{cmd}` | `{stdout, stderr, exitCode}` | `UNSAFE_REPLAY` | |
| `SPAWN` | `SPAWN` | `{role, goal, capabilities?, tokenBudget?, priority?}` | `{pid, capabilities, tokenBudget}` | `EFFECTFUL` | `PROCESS_CREATED`, `STATE_CHANGE` for the child |
| `SEND` | `SEND` on the target pid | `{to, message}` | `{messageId, queued, wokeReceiver}` | `EFFECTFUL` | `MESSAGE`, and the receiver's `WAITING -> READY` |
| `RECEIVE` | `RECEIVE` | `{}` | `{id, from, message}` | `EFFECTFUL` (consumes) | `STATE_CHANGE`, `BLOCKED` if the mailbox is empty |
| `SLEEP` | none | `{ms}` (0 to 60000) | `{slept}` | `SAFE` | `STATE_CHANGE`, `BLOCKED` |
| `CHECKPOINT` | none | `{note?}` | `{checkpointSeq}` | `SAFE` | `CHECKPOINT` |
| `EXIT` | none | `{result}` | `{result}` | `TERMINAL` | `PROCESS_EXIT`, `STATE_CHANGE` |

A final model answer with no tool call is dispatched as `EXIT` with that text.

### FS_READ, FS_WRITE

Paths are sandbox paths. `/a/b.txt` and `a/b.txt` mean the same file. Paths are normalized before the capability check, so `/work/../etc` is checked as `/etc`. `LocalSandbox` also refuses any resolved path outside its directory.

### EXEC

Runs `sh -c <cmd>` with the sandbox as the working directory. `LocalSandbox` kills a command after 30 s and caps each output stream at 64 KiB. A non-zero exit code is a successful syscall with `exitCode` set. It is not an error.

### SPAWN

Creates a child in the same job with `parentPid` set. Its capabilities come from `CapabilityManager.attenuate(parent, requested)`:

- Every requested capability must be covered by a parent capability of the same type with an equal or wider scope.
- An unscoped parent capability covers any scope. A scoped parent capability never grants an unscoped one.
- The approval flag is inherited. A child cannot shed its parent's approval gate.
- The child's token budget is capped at half the parent's remaining budget.

Any violation throws `CapabilityEscalationError`. The syscall is logged with `denied: true` and no process is created. The child runs independently. The parent does not wait for it unless it uses IPC.

### SEND, RECEIVE

Each process has a FIFO mailbox stored in the `messages` table. `SEND` only reaches pids in the same job that are still alive. `RECEIVE` takes the oldest undelivered message. If there is none, the process blocks: `RUNNING -> WAITING`, `BLOCKED {reason: "RECEIVE"}`, and its slot is released. A `SEND` to a blocked receiver emits `MESSAGE` and then wakes it (`WAITING -> READY`). When the scheduler dispatches it, `RECEIVE` returns the message.

### SLEEP

Blocks like `RECEIVE` and wakes after `ms`. The slot is released while sleeping. An operator `resume` signal wakes it early.

### CHECKPOINT

Stores a `CHECKPOINT` event holding:

- `context`: the conversation up to the turn that called `CHECKPOINT`, plus results of earlier tool calls in that turn,
- `atSequence`: the event sequence at that moment,
- `sandbox`: a marker `{sandboxId, provider, filesystem: "not-snapshotted"}`.

The process's `lastCheckpointSeq` points at this event. On retry, the loop rebuilds the context from it. The `CHECKPOINT` call gets `{checkpointSeq, resumed: true}` as its result. Later calls in the same turn get an error result saying they did not run.

**Limitation:** the sandbox filesystem is not snapshotted. Neither `LocalSandbox` nor E2B offers a cheap snapshot, so only a marker is stored. Files written after the checkpoint remain after a retry.

### EXIT

Records `PROCESS_EXIT {result}` and moves the process to `TERMINATED`. Its sandbox is destroyed. Dependents that were waiting on it may become `READY`.

## Retry safety

| Class | Meaning | Syscalls |
|---|---|---|
| `SAFE` | Idempotent. Replaying it changes nothing. | `FS_READ`, `SLEEP`, `CHECKPOINT` |
| `EFFECTFUL` | Changes state. Replaying it repeats the change. | `FS_WRITE`, `SPAWN`, `SEND`, `RECEIVE` |
| `UNSAFE_REPLAY` | Arbitrary side effects. Never assume a replay is harmless. | `EXEC` |
| `TERMINAL` | Ends the process. | `EXIT` |

The guarantee is at-least-once after the last checkpoint:

- Syscalls completed before the last `CHECKPOINT` are not replayed on retry. The resumed context already holds their results.
- Syscalls after it may run again, because a retry resumes from the checkpoint, or from the start if there is none.
- The system prompt tells the model to `CHECKPOINT` after effects it would not want repeated.

The kernel does not claim exactly-once execution.

## Operator signals

`POST /processes/:pid/signal` with `{"signal": ...}`:

| Signal | Effect |
|---|---|
| `approve` | Resolve a pending approval gate. The syscall executes. |
| `deny` | Resolve it as denied. The syscall returns `DENIED`. |
| `resume` | Wake a `WAITING` process early. A pending approval is treated as denied. |
| `retry` | Re-queue a `FAILED` process (`FAILED -> READY`). |
| `kill` | Same as `POST /processes/:pid/kill`. |

`POST /processes/:pid/kill` moves the process and all its descendants to `TERMINATED`, aborts their runs, destroys their sandboxes, and emits `PROCESS_EXIT {killed: true}` for each. A killed process does not satisfy a dependency.
