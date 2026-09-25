// Syscall dispatcher: the ABI. This is the only interface a process has to the world.
//
// Every call follows the same path:
//   1. validate args with zod
//   2. capability check
//   3. resource check (budget, deadline)
//   4. approval gate, if the capability requires it
//   5. execute against the sandbox / IPC / process manager
//   6. emit one SYSCALL event with request, result, duration, and retry-safety class
import { z } from "zod";
import type { ToolDef } from "@kernelagent/llm";
import { CapabilityEscalationError, normalizePath, type CapabilityRequest } from "./capabilities.ts";
import { CapabilitySchema } from "./job-spec.ts";
import type { Kernel, RunHandle } from "./kernel.ts";
import type { Capability, Process } from "./types.ts";

export type RetrySafety = "SAFE" | "EFFECTFUL" | "UNSAFE_REPLAY" | "TERMINAL";

// ------------------------------------------------------------------ schemas

export const FsReadSchema = z.object({
  type: z.literal("FS_READ"),
  args: z.object({ path: z.string().min(1).describe("Path inside the sandbox, e.g. /hello.py") }),
});

export const FsWriteSchema = z.object({
  type: z.literal("FS_WRITE"),
  args: z.object({
    path: z.string().min(1).describe("Path inside the sandbox"),
    content: z.string().max(1_000_000).describe("Full file content"),
  }),
});

export const ExecSchema = z.object({
  type: z.literal("EXEC"),
  args: z.object({ cmd: z.string().min(1).max(10_000).describe("Shell command, run with the sandbox as working directory") }),
});

export const SpawnSchema = z.object({
  type: z.literal("SPAWN"),
  args: z.object({
    role: z.string().min(1).describe("Role of the child process"),
    goal: z.string().min(1).describe("Task for the child process"),
    capabilities: z
      .array(CapabilitySchema)
      .default([])
      .describe("Capabilities for the child. Must be a subset of your own."),
    tokenBudget: z.number().int().positive().optional().describe("Token budget. Capped at half your remaining budget."),
    priority: z.number().int().optional(),
  }),
});

export const SendSchema = z.object({
  type: z.literal("SEND"),
  args: z.object({
    to: z.string().min(1).describe("Target pid"),
    message: z.string().max(100_000).describe("Message body"),
  }),
});

export const ReceiveSchema = z.object({
  type: z.literal("RECEIVE"),
  args: z.object({}).default({}),
});

export const SleepSchema = z.object({
  type: z.literal("SLEEP"),
  args: z.object({ ms: z.number().int().min(0).max(60_000).describe("Milliseconds to sleep") }),
});

export const CheckpointSchema = z.object({
  type: z.literal("CHECKPOINT"),
  args: z.object({ note: z.string().max(1000).optional().describe("What has been completed so far") }).default({}),
});

export const ExitSchema = z.object({
  type: z.literal("EXIT"),
  args: z.object({ result: z.string().max(100_000).describe("Final result of your task") }),
});

export const SyscallRequestSchema = z.discriminatedUnion("type", [
  FsReadSchema,
  FsWriteSchema,
  ExecSchema,
  SpawnSchema,
  SendSchema,
  ReceiveSchema,
  SleepSchema,
  CheckpointSchema,
  ExitSchema,
]);

export type SyscallRequest = z.infer<typeof SyscallRequestSchema>;
export type SyscallType = SyscallRequest["type"];
type ArgsOf<T extends SyscallType> = Extract<SyscallRequest, { type: T }>["args"];

export type SyscallResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; code: "VALIDATION" | "DENIED" | "RESOURCE" | "EXEC_ERROR" | "ABORTED" };

/** Context a runner can supply with a syscall. */
export interface SyscallContext {
  /** Snapshot of the execution context, stored by CHECKPOINT. */
  snapshot?: () => unknown;
}

// ----------------------------------------------------------------- registry

interface SyscallSpec<T extends SyscallType> {
  description: string;
  args: z.ZodType;
  retrySafety: RetrySafety;
  /** The capability this call needs, or undefined for syscalls that need none. */
  capability?: (args: ArgsOf<T>, proc: Process) => CapabilityRequest;
  handler: (k: Kernel, h: RunHandle, args: ArgsOf<T>, ctx: SyscallContext) => Promise<unknown>;
}

type Registry = { [T in SyscallType]: SyscallSpec<T> };

class SyscallError extends Error {}

function sandboxOf(k: Kernel, pid: string): string {
  const p = k.pm.require(pid);
  if (!k.sandbox || !p.sandboxId) throw new SyscallError("process has no sandbox");
  return p.sandboxId;
}

const MAX_TOOL_OUTPUT = 20_000;
const clip = (s: string) => (s.length > MAX_TOOL_OUTPUT ? s.slice(0, MAX_TOOL_OUTPUT) + `\n[truncated ${s.length - MAX_TOOL_OUTPUT} chars]` : s);

export const SYSCALLS: Registry = {
  FS_READ: {
    description: "Read a file from your sandbox.",
    args: FsReadSchema.shape.args,
    retrySafety: "SAFE",
    capability: (a) => ({ type: "FS_READ", resource: normalizePath(a.path) }),
    handler: async (k, h, a) => clip(await k.sandbox!.readFile(sandboxOf(k, h.pid), normalizePath(a.path))),
  },
  FS_WRITE: {
    description: "Write a file in your sandbox, replacing any existing content.",
    args: FsWriteSchema.shape.args,
    retrySafety: "EFFECTFUL",
    capability: (a) => ({ type: "FS_WRITE", resource: normalizePath(a.path) }),
    handler: async (k, h, a) => {
      await k.sandbox!.writeFile(sandboxOf(k, h.pid), normalizePath(a.path), a.content);
      return { path: normalizePath(a.path), bytes: Buffer.byteLength(a.content) };
    },
  },
  EXEC: {
    description: "Run a shell command in your sandbox. Returns stdout, stderr, and exit code.",
    args: ExecSchema.shape.args,
    retrySafety: "UNSAFE_REPLAY",
    capability: () => ({ type: "EXEC" }),
    handler: async (k, h, a) => {
      const r = await k.sandbox!.exec(sandboxOf(k, h.pid), a.cmd);
      return { stdout: clip(r.stdout), stderr: clip(r.stderr), exitCode: r.exitCode };
    },
  },
  SPAWN: {
    description: "Create a child process. Its capabilities must be a subset of yours. Returns the child pid.",
    args: SpawnSchema.shape.args,
    retrySafety: "EFFECTFUL",
    capability: () => ({ type: "SPAWN" }),
    handler: async (k, h, a) => {
      const parent = k.pm.require(h.pid);
      const caps = k.caps.attenuate(parent.capabilities, a.capabilities as Capability[]);
      const remaining = Math.max(1, parent.tokenBudget - parent.tokensUsed);
      const cap = Math.max(1, Math.floor(remaining / 2));
      const child = k.createChildProcess(parent, {
        role: a.role,
        goal: a.goal,
        capabilities: caps,
        tokenBudget: Math.min(a.tokenBudget ?? cap, cap),
        ...(a.priority !== undefined ? { priority: a.priority } : {}),
      });
      return { pid: child.pid, capabilities: caps, tokenBudget: child.tokenBudget };
    },
  },
  SEND: {
    description: "Send a message to another process's mailbox.",
    args: SendSchema.shape.args,
    retrySafety: "EFFECTFUL",
    capability: (a) => ({ type: "SEND", resource: a.to }),
    handler: async (k, h, a) => {
      const from = k.pm.require(h.pid);
      const to = k.pm.get(a.to);
      if (!to || to.jobId !== from.jobId) throw new SyscallError(`no process ${a.to} in this job`);
      if (to.status === "TERMINATED" || to.status === "FAILED") throw new SyscallError(`process ${a.to} is ${to.status}`);
      const { message, woke } = k.channel.send(from.jobId, from.pid, to.pid, a.message);
      k.bus.emit("MESSAGE", from.jobId, from.pid, { id: message.id, from: from.pid, to: to.pid, body: a.message, woke });
      return { messageId: message.id, delivered: true };
    },
  },
  RECEIVE: {
    description: "Take the oldest message from your mailbox. Blocks until one arrives.",
    args: ReceiveSchema.shape.args,
    retrySafety: "EFFECTFUL",
    capability: () => ({ type: "RECEIVE" }),
    handler: async (k, h) => {
      for (;;) {
        const m = k.channel.tryReceive(h.pid);
        if (m) return { id: m.id, from: m.fromPid, message: m.body };
        await k.block(h, "RECEIVE", { mailbox: h.pid });
      }
    },
  },
  SLEEP: {
    description: "Yield for a number of milliseconds.",
    args: SleepSchema.shape.args,
    retrySafety: "SAFE",
    handler: async (k, h, a) => {
      const timer = setTimeout(() => k.wake(h.pid, undefined, "SLEEP_DONE"), a.ms);
      try {
        await k.block(h, "SLEEP", { ms: a.ms });
      } finally {
        clearTimeout(timer);
      }
      return { slept: a.ms };
    },
  },
  CHECKPOINT: {
    description: "Save your progress. On a retry you resume from the latest checkpoint instead of starting over.",
    args: CheckpointSchema.shape.args,
    retrySafety: "SAFE",
    handler: async (k, h, a, ctx) => k.checkpoint(h, ctx.snapshot?.() ?? null, a.note),
  },
  EXIT: {
    description: "Finish your task and terminate with a result.",
    args: ExitSchema.shape.args,
    retrySafety: "TERMINAL",
    handler: async (_k, _h, a) => ({ result: a.result }),
  },
};

/** Tool definitions for the model. Tool definitions == syscall schemas. */
export function syscallTools(filter?: (t: SyscallType) => boolean): ToolDef[] {
  return (Object.keys(SYSCALLS) as SyscallType[])
    .filter((t) => !filter || filter(t))
    .map((name) => {
      const { $schema: _drop, ...schema } = z.toJSONSchema(SYSCALLS[name].args, { io: "input" }) as Record<string, unknown>;
      return { name, description: SYSCALLS[name].description, input_schema: schema };
    });
}

// --------------------------------------------------------------- dispatcher

export class SyscallDispatcher {
  constructor(private k: Kernel) {}

  async dispatch(h: RunHandle, raw: unknown, ctx: SyscallContext = {}): Promise<SyscallResult> {
    const started = this.k.now();
    const proc = this.k.pm.require(h.pid);
    const emit = (payload: Record<string, unknown>) =>
      this.k.bus.emit("SYSCALL", proc.jobId, proc.pid, { ...payload, durationMs: this.k.now() - started });

    // 1. validate
    const parsed = SyscallRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const error = z.prettifyError(parsed.error);
      emit({ request: raw, ok: false, code: "VALIDATION", error });
      return { ok: false, code: "VALIDATION", error };
    }
    const request = parsed.data;
    const spec = SYSCALLS[request.type] as SyscallSpec<SyscallType>;
    const base = { request, retrySafety: spec.retrySafety };

    // 2. capability check
    let capability: Capability | undefined;
    if (spec.capability) {
      const need = spec.capability(request.args as never, proc);
      capability = this.k.caps.find(proc.capabilities, need);
      if (!capability) {
        const error = `permission denied: ${need.type}${need.resource ? ` on ${need.resource}` : ""} requires a capability this process does not hold`;
        emit({ ...base, ok: false, denied: true, code: "DENIED", required: need, error });
        return { ok: false, code: "DENIED", error };
      }
    }

    // 3. resource check
    const resourceError = this.resourceCheck(h);
    if (resourceError) {
      emit({ ...base, capability, ok: false, code: "RESOURCE", error: resourceError });
      return { ok: false, code: "RESOURCE", error: resourceError };
    }

    // 4. human approval gate
    if (capability?.requiresApproval) {
      const approved = await this.k.block<boolean>(h, "APPROVAL", { request, capability });
      if (!approved) {
        const error = "denied by operator";
        emit({ ...base, capability, ok: false, denied: true, code: "DENIED", approval: "denied", error });
        return { ok: false, code: "DENIED", error };
      }
    }

    // 5. execute
    try {
      const value = await spec.handler(this.k, h, request.args as never, ctx);
      this.k.assertLive(h);
      // 6. record
      emit({ ...base, capability, ok: true, result: value, ...(capability?.requiresApproval ? { approval: "approved" } : {}) });
      if (request.type === "EXIT") this.k.exit(h, request.args.result);
      this.k.scheduler.request();
      return { ok: true, value };
    } catch (err) {
      if (!this.k.isLive(h)) return { ok: false, code: "ABORTED", error: "process no longer running" };
      const denied = err instanceof CapabilityEscalationError;
      const error = err instanceof Error ? err.message : String(err);
      emit({ ...base, capability, ok: false, code: denied ? "DENIED" : "EXEC_ERROR", error, ...(denied ? { denied: true } : {}) });
      this.k.scheduler.request();
      return { ok: false, code: denied ? "DENIED" : "EXEC_ERROR", error };
    }
  }

  private resourceCheck(h: RunHandle): string | undefined {
    if (!this.k.isLive(h)) return "process is not running";
    const p = this.k.pm.require(h.pid);
    if (p.status !== "RUNNING") return `process is ${p.status}`;
    const budget = this.k.resources.checkBudget(h.pid);
    if (budget) return budget;
    const deadline = this.k.resources.deadline(h.pid);
    if (deadline !== undefined && this.k.now() > deadline) return "TIMEOUT";
    return undefined;
  }
}
