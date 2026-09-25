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
