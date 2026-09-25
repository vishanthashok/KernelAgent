import { z } from "zod";

export const CapabilitySchema = z.object({
  type: z.enum(["FS_READ", "FS_WRITE", "EXEC", "SPAWN", "NET", "SEND", "RECEIVE"]),
  scope: z.string().optional(),
  requiresApproval: z.boolean().optional(),
});

export const ProcessSpecSchema = z.object({
  // Local id inside the job spec. Used for dependsOn edges.
  id: z.string().min(1).optional(),
  role: z.string().min(1),
  goal: z.string().min(1),
  priority: z.number().int().default(0),
  tokenBudget: z.number().int().positive().default(20_000),
  capabilities: z.array(CapabilitySchema).default([]),
  dependsOn: z.array(z.string()).default([]),
  maxRetries: z.number().int().min(0).default(2),
  timeoutMs: z.number().int().positive().default(5 * 60_000),
});

// Model id for every process in the job, spawned children included. Omit to use the kernel default.
const ModelField = z.string().min(1).max(200).optional();

const SingleJobSpec = z.object({
  name: z.string().optional(),
  model: ModelField,
  tokenBudget: z.number().int().positive().optional(),
  process: ProcessSpecSchema,
});

const DagJobSpec = z.object({
  name: z.string().optional(),
  model: ModelField,
  tokenBudget: z.number().int().positive().optional(),
  processes: z.array(ProcessSpecSchema).min(1),
});

export const JobSpecSchema = z.union([SingleJobSpec, DagJobSpec]);

export type ProcessSpec = z.infer<typeof ProcessSpecSchema>;
export type JobSpec = z.infer<typeof JobSpecSchema>;
export type JobSpecInput = z.input<typeof JobSpecSchema>;

export class JobSpecError extends Error {}

/** Normalize a spec into a list of process specs with unique local ids and a valid DAG. */
export function normalizeJobSpec(input: unknown): { spec: JobSpec; processes: (ProcessSpec & { id: string })[] } {
  const parsed = JobSpecSchema.safeParse(input);
  if (!parsed.success) throw new JobSpecError(`invalid job spec: ${parsed.error.message}`);
  const spec = parsed.data;
  const list = "process" in spec ? [spec.process] : spec.processes;
  const processes = list.map((p, i) => ({ ...p, id: p.id ?? `p${i}` }));

  const ids = new Set<string>();
  for (const p of processes) {
    if (ids.has(p.id)) throw new JobSpecError(`duplicate process id: ${p.id}`);
    ids.add(p.id);
  }
  for (const p of processes) {
    for (const d of p.dependsOn) {
      if (!ids.has(d)) throw new JobSpecError(`process ${p.id} depends on unknown id ${d}`);
      if (d === p.id) throw new JobSpecError(`process ${p.id} depends on itself`);
    }
  }
  // Cycle check with DFS.
  const byId = new Map(processes.map((p) => [p.id, p]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): void => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) throw new JobSpecError(`dependency cycle through ${id}`);
    state.set(id, 1);
    for (const d of byId.get(id)!.dependsOn) visit(d);
    state.set(id, 2);
  };
  for (const p of processes) visit(p.id);

  return { spec, processes };
}
