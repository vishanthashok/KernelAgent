// Fastify control API + live event stream. Routes per the brief, Section 13.
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { JobSpecError, type Kernel, type KernelEvent } from "@kernelagent/kernel";

export interface ServerOptions {
  logger?: boolean;
  /** Optional shared dev token. When set, every request must send `Authorization: Bearer <token>`. */
  devToken?: string;
}

const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export async function buildServer(kernel: Kernel, opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  if (opts.devToken) {
    app.addHook("onRequest", async (req, reply) => {
      // /health stays public so uptime checks and browsers can probe it.
      if (req.url === "/health") return;
      const q = req.query as Record<string, string | undefined>;
      const ok = req.headers.authorization === `Bearer ${opts.devToken}` || q.token === opts.devToken;
      if (!ok) return reply.code(401).send({ error: "unauthorized" });
    });
  }

  /** A process row enriched with live fields the table does not store. */
  const liveProcess = (pid: string) => {
    const row = kernel.repos.processes.get(pid);
    if (!row) return undefined;
    const live = kernel.pm.get(pid);
    return {
      ...row,
      ...(live ? { runtimeMs: kernel.pm.runtimeMs(pid) } : {}),
      waitingOn: kernel.waitingOn(pid) ?? null,
    };
  };

  app.get("/health", async () => ({ ok: true }));

  app.get("/stats", async () => {
    const limiter = kernel.resources.limiter(kernel.llm.provider);
    return {
      bootedAt: kernel.bootedAt,
      uptimeMs: kernel.now() - kernel.bootedAt,
      provider: kernel.llm.provider,
      model: kernel.llm.model,
      sandbox: kernel.sandbox?.provider ?? null,
      maxConcurrency: kernel.config.maxConcurrency,
      running: kernel.scheduler.running(),
      queueDepth: kernel.scheduler.queueDepth(),
      rateLimiter: { ...limiter.saturation(), reservations: limiter.reservations() },
      lastSequence: kernel.bus.lastSequence(),
    };
  });

  // ---------------------------------------------------------------- jobs

  // Models the configured provider can run. The console fills its model picker from this.
  app.get("/models", async () => ({
    provider: kernel.llm.provider,
    default: kernel.llm.model,
    models: await kernel.llm.listModels(),
  }));

  app.post("/jobs", async (req, reply) => {
    const model = (req.body as { model?: unknown } | null)?.model;
    if (typeof model === "string" && model !== kernel.llm.model) {
      const known = await kernel.llm.listModels();
      if (!known.some((m) => m.id === model)) {
        return reply.code(400).send({ error: `unknown model ${model} for provider ${kernel.llm.provider}` });
      }
    }
    try {
      return reply.code(201).send(kernel.submitJob(req.body));
    } catch (err) {
      if (err instanceof JobSpecError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get("/jobs", async () => ({ jobs: kernel.listJobs() }));

  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    const job = kernel.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: "no such job" });
    const processes = kernel.repos.processes.list({ jobId: job.id }).map((p) => liveProcess(p.pid));
    return { job, processes };
  });

  // ----------------------------------------------------------- processes

  app.get<{ Querystring: { jobId?: string; status?: string } }>("/processes", async (req) => ({
    processes: kernel.repos.processes
      .list({
        ...(req.query.jobId ? { jobId: req.query.jobId } : {}),
        ...(req.query.status ? { status: req.query.status } : {}),
      })
      .map((p) => liveProcess(p.pid)),
  }));

  app.get<{ Params: { pid: string }; Querystring: { limit?: string } }>("/processes/:pid", async (req, reply) => {
    const process = liveProcess(req.params.pid);
    if (!process) return reply.code(404).send({ error: "no such process" });
    const events = kernel.bus.getEvents({ pid: req.params.pid, limit: num(req.query.limit, 5000) });
    return { process, events };
  });

  app.post<{ Params: { pid: string } }>("/processes/:pid/kill", async (req, reply) => {
    if (!kernel.pm.get(req.params.pid)) {
      if (kernel.repos.processes.get(req.params.pid)) return reply.code(409).send({ error: "process belongs to a previous kernel run" });
      return reply.code(404).send({ error: "no such process" });
    }
    return { killed: kernel.kill(req.params.pid) };
  });

  app.post<{ Params: { pid: string }; Body: { signal?: string } }>("/processes/:pid/signal", async (req, reply) => {
    const signal = req.body?.signal;
    if (!signal) return reply.code(400).send({ error: "body must be {signal: approve|deny|resume|retry|kill}" });
    const res = kernel.signal(req.params.pid, signal);
    return reply.code(res.ok ? 200 : 409).send(res);
  });

  // ------------------------------------------------------ IPC, sandboxes

  app.get<{ Querystring: { jobId?: string; pid?: string } }>("/messages", async (req) => ({
    messages: kernel.channel.mailbox.list({
      ...(req.query.jobId ? { jobId: req.query.jobId } : {}),
      ...(req.query.pid ? { pid: req.query.pid } : {}),
    }),
  }));

  app.get("/sandboxes", async () => ({
    provider: kernel.sandbox?.provider ?? null,
    sandboxes: kernel.sandbox?.list() ?? [],
  }));

  // ----------------------------------------------------------- artifacts

  app.get<{ Querystring: { jobId?: string; pid?: string } }>("/artifacts", async (req) => ({
    artifacts: kernel.repos.artifacts.list({
      ...(req.query.jobId ? { jobId: req.query.jobId } : {}),
      ...(req.query.pid ? { pid: req.query.pid } : {}),
    }),
  }));

  app.get<{ Params: { id: string } }>("/artifacts/:id", async (req, reply) => {
    const a = kernel.repos.artifacts.get(Number(req.params.id));
    if (!a) return reply.code(404).send({ error: "no such artifact" });
    const name = a.meta.path.split("/").pop() ?? "file";
    return reply
      .header("content-type", a.meta.mime)
      .header("content-disposition", `attachment; filename="${name.replace(/"/g, "")}"`)
      .send(a.data);
  });

  // -------------------------------------------------------------- events

  app.get<{ Querystring: { sinceSeq?: string; jobId?: string; pid?: string; limit?: string } }>("/events", async (req) => {
    const sinceSeq = num(req.query.sinceSeq, 0);
    const limit = Math.min(Math.max(num(req.query.limit, 500), 1), 5000);
    const events = kernel.bus.getEvents({
      sinceSeq,
      limit,
      ...(req.query.jobId ? { jobId: req.query.jobId } : {}),
      ...(req.query.pid ? { pid: req.query.pid } : {}),
    });
    const last = events[events.length - 1];
    return { events, nextSeq: last ? last.sequence : sinceSeq, hasMore: events.length === limit };
  });

  /**
   * Live stream. Handshake: `?sinceSeq=N` on the URL, or a first message `{"sinceSeq": N}`.
   * The server backfills everything after N from the log, then streams live events,
   * with no gaps and no duplicates.
   */
  app.get<{ Querystring: { sinceSeq?: string } }>("/events/stream", { websocket: true }, (socket, req) => {
    let lastSent = -1;
    let ready = false;
    const buffered: KernelEvent[] = [];

    const send = (e: KernelEvent) => {
      if (e.sequence <= lastSent) return;
      lastSent = e.sequence;
      socket.send(JSON.stringify({ type: "event", event: e }));
    };

    // Subscribe first so nothing emitted during backfill is lost.
    const unsubscribe = kernel.bus.subscribe((e) => {
      if (ready) send(e);
      else buffered.push(e);
    });
    socket.on("close", unsubscribe);

    const start = (sinceSeq: number) => {
      if (lastSent >= 0) return;
      lastSent = sinceSeq;
      for (;;) {
        const page = kernel.bus.getEvents({ sinceSeq: lastSent, limit: 2000 });
        for (const e of page) send(e);
        if (page.length < 2000) break;
      }
      for (const e of buffered) send(e);
      buffered.length = 0;
      ready = true;
      socket.send(JSON.stringify({ type: "live", lastSequence: lastSent }));
    };

    if (req.query.sinceSeq !== undefined) start(num(req.query.sinceSeq, 0));
    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as { sinceSeq?: number };
        if (typeof msg.sinceSeq === "number") start(msg.sinceSeq);
      } catch {
        // ignore malformed client messages
      }
    });
    // Without a handshake within 1s, start live from now.
    setTimeout(() => start(kernel.bus.lastSequence()), 1000).unref?.();
  });

  return app;
}
