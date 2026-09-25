// Fastify control API. Routes per the brief, Section 13.
import Fastify, { type FastifyInstance } from "fastify";
import { JobSpecError, type Kernel } from "@kernelagent/kernel";

export async function buildServer(kernel: Kernel, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  app.post("/jobs", async (req, reply) => {
    try {
      const res = kernel.submitJob(req.body);
      return reply.code(201).send(res);
    } catch (err) {
      if (err instanceof JobSpecError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get("/jobs", async () => ({ jobs: kernel.listJobs() }));

  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    const job = kernel.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: "no such job" });
    return { job, processes: kernel.repos.processes.list({ jobId: job.id }) };
  });

  app.get<{ Querystring: { jobId?: string; status?: string } }>("/processes", async (req) => ({
    processes: kernel.repos.processes.list({
      ...(req.query.jobId ? { jobId: req.query.jobId } : {}),
      ...(req.query.status ? { status: req.query.status } : {}),
    }),
  }));

  app.get<{ Querystring: { sinceSeq?: string; jobId?: string; pid?: string; limit?: string } }>("/events", async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 500) || 500, 5000);
    const events = kernel.bus.getEvents({
      sinceSeq: Number(req.query.sinceSeq ?? 0) || 0,
      limit,
      ...(req.query.jobId ? { jobId: req.query.jobId } : {}),
      ...(req.query.pid ? { pid: req.query.pid } : {}),
    });
    const last = events[events.length - 1];
    return { events, nextSeq: last ? last.sequence : Number(req.query.sinceSeq ?? 0) || 0, hasMore: events.length === limit };
  });

  return app;
}
