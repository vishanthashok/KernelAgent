import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "@kernelagent/api";
import type { Kernel } from "@kernelagent/kernel";
import { makeKernel, syscallEvents } from "./helpers.ts";

type FastifyInstance = Awaited<ReturnType<typeof buildServer>>;
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const MEM = [{ type: "MEMORY" as const }];
const SPAWN_MEM = [{ type: "MEMORY" as const }, { type: "SPAWN" as const }];

/** System prompts the model saw, per pid, for a job. */
function systemPrompts(kernel: Kernel, jobId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of kernel.bus.getEvents({ jobId, limit: 100_000 })) {
    if (e.type === "LLM_CALL" && e.pid && !out.has(e.pid)) out.set(e.pid, (e.payload as { request: { system: string } }).request.system);
  }
  return out;
}

describe("chat memory", () => {
  it("shares notes with spawned children and with later jobs in the same scope", async () => {
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          lead: [
            { tool: "REMEMBER", input: { note: "the user's name is Ada" } },
            { tool: "SPAWN", input: { role: "helper", goal: "check memory", capabilities: MEM } },
            { text: "done" },
          ],
          helper: [{ tool: "RECALL", input: { query: "name" } }, (ctx) => ({ text: `recalled: ${ctx.lastToolResult}` })],
          follow: [{ text: "hi Ada" }],
        },
      },
    });
    kernel.start();

    const first = kernel.submitJob({ memoryScope: "chat_1", process: { role: "lead", goal: "learn the name", capabilities: SPAWN_MEM } });
    await kernel.waitForJob(first.jobId);
    const helper = kernel.pm.list({ jobId: first.jobId }).find((p) => p.role === "helper")!;
    expect(helper.result).toContain("the user's name is Ada");

    const second = kernel.submitJob({ memoryScope: "chat_1", process: { role: "follow", goal: "greet the user", capabilities: MEM } });
    await kernel.waitForJob(second.jobId);
    const prompt = systemPrompts(kernel, second.jobId).get(second.pids.p0!)!;
    expect(prompt).toContain("Chat memory");
    expect(prompt).toContain("the user's name is Ada");
    // The first job's request and answer were recorded as a turn.
    expect(prompt).toContain("User asked: learn the name");
    expect(prompt).toContain("Answer: done");

    // Another scope sees none of it.
    const other = kernel.submitJob({ memoryScope: "chat_2", process: { role: "follow", goal: "x", capabilities: MEM } });
    await kernel.waitForJob(other.jobId);
    expect(systemPrompts(kernel, other.jobId).get(other.pids.p0!)).not.toContain("Ada");

    const kinds = kernel.repos.memories.recent("chat_1").map((m) => m.kind);
    expect(kinds).toEqual(["note", "turn", "turn"]);
    await kernel.stop();
  });

  it("records only top-level answers as turns", async () => {
    const { kernel } = makeKernel({
      mock: {
        scripts: {
          lead: [{ tool: "SPAWN", input: { role: "child", goal: "sub task", capabilities: MEM } }, { text: "lead done" }],
          child: [{ text: "child done" }],
        },
      },
    });
    kernel.start();
    const { jobId } = kernel.submitJob({ memoryScope: "c", process: { role: "lead", goal: "g", capabilities: SPAWN_MEM } });
    await kernel.waitForJob(jobId);
    const turns = kernel.repos.memories.recent("c");
    expect(turns).toHaveLength(1);
    expect(turns[0]!.content).toContain("lead done");
    await kernel.stop();
  });

  it("denies memory without the MEMORY capability and errors without a scope", async () => {
    const { kernel } = makeKernel({
      mock: { scripts: { r: [{ tool: "REMEMBER", input: { note: "x" } }, { text: "end" }] } },
    });
    kernel.start();
    const noCap = kernel.submitJob({ memoryScope: "s", process: { role: "r", goal: "g" } });
    await kernel.waitForJob(noCap.jobId);
    expect(syscallEvents(kernel, noCap.jobId).find((e) => e.request?.type === "REMEMBER")).toMatchObject({ ok: false, code: "DENIED" });

    const noScope = kernel.submitJob({ process: { role: "r", goal: "g", capabilities: MEM } });
    await kernel.waitForJob(noScope.jobId);
    const ev = syscallEvents(kernel, noScope.jobId).find((e) => e.request?.type === "REMEMBER");
    expect(ev).toMatchObject({ ok: false, code: "EXEC_ERROR" });
    expect(ev!.error).toContain("no chat memory");
    // Without a scope the memory tools are not offered and no memory section is added.
    expect(systemPrompts(kernel, noScope.jobId).get(noScope.pids.p0!)).not.toContain("Chat memory");
    await kernel.stop();
  });

  it("searches by keyword", () => {
    const { kernel } = makeKernel();
    const m = kernel.repos.memories;
    for (const note of ["deploy target is Railway", "frontend runs on Vercel", "Railway port is 8080", "100% done_ok"]) {
      m.add({ scope: "s", jobId: "j", kind: "note", content: note, createdAt: 1 });
    }
    expect(m.search("s", "railway").map((e) => e.content)).toEqual(["Railway port is 8080", "deploy target is Railway"]);
    expect(m.search("s", "railway port").map((e) => e.content)).toEqual(["Railway port is 8080"]);
    // LIKE wildcards in the query are literal.
    expect(m.search("s", "%").map((e) => e.content)).toEqual(["100% done_ok"]);
    expect(m.search("s", "_ok").map((e) => e.content)).toEqual(["100% done_ok"]);
    expect(m.search("other", "railway")).toEqual([]);
  });

  it("lists, deletes, and clears memory over the API", async () => {
    const { kernel } = makeKernel();
    app = await buildServer(kernel);
    const a = kernel.repos.memories.add({ scope: "chat", jobId: "j", kind: "note", content: "one", createdAt: 1 });
    kernel.repos.memories.add({ scope: "chat", jobId: "j", kind: "note", content: "two", createdAt: 2 });

    const list = (await app.inject({ method: "GET", url: "/memory?scope=chat" })).json();
    expect(list.count).toBe(2);
    expect(list.entries.map((e: { content: string }) => e.content)).toEqual(["one", "two"]);
    expect((await app.inject({ method: "GET", url: "/memory" })).statusCode).toBe(400);

    expect((await app.inject({ method: "DELETE", url: `/memory/${a.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/memory/${a.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/memory?scope=chat" })).json()).toEqual({ cleared: 1 });
    expect(kernel.repos.memories.count("chat")).toBe(0);
  });
});
