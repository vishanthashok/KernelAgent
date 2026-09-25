import { afterEach, describe, expect, it, vi } from "vitest";
type FastifyInstance = Awaited<ReturnType<typeof buildServer>>;
import { buildServer } from "@kernelagent/api";
import { makeKernel } from "./helpers.ts";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("control API", () => {
  it("POST /jobs creates processes and the scheduler dispatches them", async () => {
    const { kernel } = makeKernel();
    kernel.start();
    app = await buildServer(kernel);

    const res = await app.inject({
      method: "POST",
      url: "/jobs",
      payload: { processes: [{ id: "a", role: "planner", goal: "plan" }, { id: "b", role: "coder", goal: "code", dependsOn: ["a"] }] },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json() as { jobId: string };
    await kernel.waitForJob(jobId);

    const job = (await app.inject({ method: "GET", url: `/jobs/${jobId}` })).json();
    expect(job.job.status).toBe("COMPLETED");
    expect(job.processes.map((p: { status: string }) => p.status)).toEqual(["TERMINATED", "TERMINATED"]);

    const procs = (await app.inject({ method: "GET", url: `/processes?jobId=${jobId}&status=TERMINATED` })).json();
    expect(procs.processes).toHaveLength(2);

    const ev = (await app.inject({ method: "GET", url: `/events?sinceSeq=0&jobId=${jobId}` })).json();
    expect(ev.events[0].type).toBe("JOB_SUBMITTED");
    await kernel.stop();
  });

  it("rejects an invalid job spec with 400", async () => {
    const { kernel } = makeKernel();
    app = await buildServer(kernel);
    const res = await app.inject({
      method: "POST",
      url: "/jobs",
      payload: { processes: [{ id: "a", role: "x", goal: "y", dependsOn: ["a"] }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists models and runs a job on the model it picks", async () => {
    const { kernel, llm } = makeKernel();
    vi.spyOn(llm, "listModels").mockResolvedValue([
      { id: "mock-llm", name: "Mock" },
      { id: "mock-small", name: "Mock small" },
    ]);
    const seen: (string | undefined)[] = [];
    const complete = llm.complete.bind(llm);
    vi.spyOn(llm, "complete").mockImplementation((req, opts) => {
      seen.push(opts?.model);
      return complete(req, opts);
    });
    kernel.start();
    app = await buildServer(kernel);

    const models = (await app.inject({ method: "GET", url: "/models" })).json();
    expect(models).toMatchObject({ provider: "mock", default: "mock-llm" });
    expect(models.models.map((m: { id: string }) => m.id)).toEqual(["mock-llm", "mock-small"]);

    const bad = await app.inject({ method: "POST", url: "/jobs", payload: { model: "nope", process: { role: "r", goal: "g" } } });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({ method: "POST", url: "/jobs", payload: { model: "mock-small", process: { role: "r", goal: "g" } } });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json() as { jobId: string };
    await kernel.waitForJob(jobId);
    const calls = kernel.bus.getEvents({ jobId, limit: 1000 }).filter((e) => e.type === "LLM_CALL");
    expect(calls.length).toBeGreaterThan(0);
    for (const e of calls) expect((e.payload as { model: string }).model).toBe("mock-small");
    expect(seen.every((m) => m === "mock-small")).toBe(true);
    await kernel.stop();
  });
});

describe("bring your own key", () => {
  const KEY = "sk-user-test-key-9f3a";

  function byokKernel(requiresUserKey: boolean) {
    const made = makeKernel();
    Object.defineProperty(made.llm, "acceptsUserKeys", { value: true });
    Object.defineProperty(made.llm, "requiresUserKey", { value: requiresUserKey });
    const keys: (string | undefined)[] = [];
    const complete = made.llm.complete.bind(made.llm);
    vi.spyOn(made.llm, "complete").mockImplementation((req, opts) => {
      keys.push(opts?.apiKey);
      return complete(req, opts);
    });
    return { ...made, keys };
  }

  it("runs the job on the caller's key and never records it", async () => {
    const { kernel, keys } = byokKernel(false);
    kernel.start();
    app = await buildServer(kernel);
    const res = await app.inject({
      method: "POST",
      url: "/jobs",
      headers: { "x-provider-key": KEY },
      payload: { process: { role: "r", goal: "g" } },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json() as { jobId: string };
    await kernel.waitForJob(jobId);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k === KEY)).toBe(true);

    const everything = JSON.stringify([
      kernel.bus.getEvents({ limit: 100_000 }),
      kernel.listJobs(),
      (await app.inject({ method: "GET", url: `/jobs/${jobId}` })).json(),
    ]);
    expect(everything).not.toContain(KEY);
    await kernel.stop();
  });

  it("rejects a job without a key when the server requires one", async () => {
    const { kernel } = byokKernel(true);
    app = await buildServer(kernel);
    const res = await app.inject({ method: "POST", url: "/jobs", payload: { process: { role: "r", goal: "g" } } });
    expect(res.statusCode).toBe(400);
    const models = (await app.inject({ method: "GET", url: "/models" })).json();
    expect(models).toMatchObject({ acceptsUserKeys: true, requiresUserKey: true });
  });

  it("allows the key header through CORS", async () => {
    const { kernel } = byokKernel(false);
    app = await buildServer(kernel);
    const res = await app.inject({
      method: "OPTIONS",
      url: "/jobs",
      headers: { origin: "https://console.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-provider-key" },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(String(res.headers["access-control-allow-headers"])).toContain("x-provider-key");
  });
});

import WebSocket from "ws";

describe("process routes", () => {
  it("inspects, kills, and signals processes", async () => {
    const { kernel } = makeKernel({
      mock: { scripts: { waiter: [{ tool: "RECEIVE", input: {} }, { text: "never" }], sleeper: [{ tool: "SLEEP", input: { ms: 60_000 } }, { text: "woke" }] } },
    });
    kernel.start();
    app = await buildServer(kernel);
    const { jobId, pids } = kernel.submitJob({
      processes: [
        { id: "w", role: "waiter", goal: "wait", capabilities: [{ type: "RECEIVE" }] },
        { id: "s", role: "sleeper", goal: "sleep" },
      ],
    });
    await new Promise((r) => setTimeout(r, 50));

    const one = (await app.inject({ method: "GET", url: `/processes/${pids.w}` })).json();
    expect(one.process.status).toBe("WAITING");
    expect(one.process.waitingOn).toBe("RECEIVE");
    expect(one.events.some((e: { type: string }) => e.type === "BLOCKED")).toBe(true);

    const bad = await app.inject({ method: "POST", url: `/processes/${pids.s}/signal`, payload: { signal: "approve" } });
    expect(bad.statusCode).toBe(409);
    const resume = await app.inject({ method: "POST", url: `/processes/${pids.s}/signal`, payload: { signal: "resume" } });
    expect(resume.json()).toMatchObject({ ok: true });

    const kill = await app.inject({ method: "POST", url: `/processes/${pids.w}/kill` });
    expect(kill.json().killed).toEqual([pids.w]);
    const job = await kernel.waitForJob(jobId);
    expect(job.status).toBe("FAILED"); // one process was killed
    expect(kernel.pm.get(pids.s!)!.result).toBe("woke");
    expect((await app.inject({ method: "GET", url: "/processes/nope" })).statusCode).toBe(404);
    await kernel.stop();
  });

  it("enforces the dev token when configured", async () => {
    const { kernel } = makeKernel();
    app = await buildServer(kernel, { devToken: "s3cret" });
    expect((await app.inject({ method: "GET", url: "/jobs" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/jobs", headers: { authorization: "Bearer s3cret" } })).statusCode).toBe(200);
  });
});

describe("WS /events/stream", () => {
  it("backfills from sinceSeq, then streams live events without gaps", async () => {
    const { kernel } = makeKernel({ mock: { latencyMs: 10 } });
    kernel.start();
    app = await buildServer(kernel);
    const first = kernel.submitJob({ process: { role: "a", goal: "first" } });
    await kernel.waitForJob(first.jobId);
    const backfillFrom = 3;

    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/events/stream?sinceSeq=${backfillFrom}`);
    const seqs: number[] = [];
    let live = false;
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "event") seqs.push(msg.event.sequence);
      if (msg.type === "live") live = true;
    });
    await new Promise((r) => ws.on("open", r));
    while (!live) await new Promise((r) => setTimeout(r, 5));

    const second = kernel.submitJob({ process: { role: "b", goal: "second" } });
    await kernel.waitForJob(second.jobId);
    await new Promise((r) => setTimeout(r, 30));
    ws.close();
    await kernel.stop();

    const last = kernel.bus.lastSequence();
    expect(seqs).toEqual(Array.from({ length: last - backfillFrom }, (_, i) => backfillFrom + 1 + i));
  });
});
