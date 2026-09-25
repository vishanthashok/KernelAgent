import { afterEach, describe, expect, it } from "vitest";
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
