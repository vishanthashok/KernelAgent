import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildServer } from "@kernelagent/api";
import { signUserToken, verifyUserToken } from "@kernelagent/kernel/user-token";
import { makeKernel } from "./helpers.ts";

type FastifyInstance = Awaited<ReturnType<typeof buildServer>>;
const SECRET = "test-accounts-secret-0123456789";
const svc = { "x-accounts-secret": SECRET };

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup() {
  const made = makeKernel();
  app = await buildServer(made.kernel, { accountsSecret: SECRET });
  return { ...made, app };
}

async function signup(a: FastifyInstance, email: string, password = "correct horse") {
  const res = await a.inject({ method: "POST", url: "/accounts/signup", headers: svc, payload: { email, password, name: "Ada" } });
  return res;
}

describe("user tokens", () => {
  it("verifies its own tokens and rejects forged or expired ones", () => {
    const t = signUserToken(SECRET, "u1", 1000, 0);
    expect(verifyUserToken(SECRET, t, 500)).toBe("u1");
    expect(verifyUserToken(SECRET, t, 1500)).toBeUndefined();
    expect(verifyUserToken("other-secret", t, 500)).toBeUndefined();
    const [body] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "u2", exp: 1000 })).toString("base64url") + "." + t.split(".")[1];
    expect(forged.startsWith(body!)).toBe(false);
    expect(verifyUserToken(SECRET, forged, 500)).toBeUndefined();
  });
});

describe("accounts", () => {
  it("allows PUT and DELETE with the user token header through CORS", async () => {
    const { app } = await setup();
    for (const method of ["PUT", "DELETE"]) {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/chats/c1",
        headers: { origin: "https://console.example", "access-control-request-method": method, "access-control-request-headers": "content-type,x-user-token" },
      });
      expect(String(res.headers["access-control-allow-methods"])).toContain(method);
      expect(String(res.headers["access-control-allow-headers"])).toContain("x-user-token");
    }
  });

  it("needs the service secret for account routes", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/accounts/signup", payload: { email: "a@b.co", password: "12345678" } });
    expect(res.statusCode).toBe(403);
  });

  it("signs up, signs in, and never returns the password hash", async () => {
    const { app } = await setup();
    const created = await signup(app, "Ada@Example.com");
    expect(created.statusCode).toBe(201);
    expect(created.json().user).toMatchObject({ email: "ada@example.com", name: "Ada" });
    expect(created.body).not.toContain("scrypt");

    expect((await signup(app, "ada@example.com")).statusCode).toBe(409);
    expect((await signup(app, "bad-email")).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/accounts/signup", headers: svc, payload: { email: "x@y.co", password: "short" } })).statusCode).toBe(400);

    const ok = await app.inject({ method: "POST", url: "/accounts/login", headers: svc, payload: { email: "ada@example.com", password: "correct horse" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.id).toBe(created.json().user.id);
    const bad = await app.inject({ method: "POST", url: "/accounts/login", headers: svc, payload: { email: "ada@example.com", password: "wrong pass" } });
    expect(bad.statusCode).toBe(401);
  });

  it("links a provider sign-in to the same account by email, and blocks password sign-up on it", async () => {
    const { app } = await setup();
    const first = await app.inject({ method: "POST", url: "/accounts/oauth", headers: svc, payload: { email: "g@example.com", name: "G", image: "https://x/y.png" } });
    const again = await app.inject({ method: "POST", url: "/accounts/oauth", headers: svc, payload: { email: "G@example.com" } });
    expect(again.json().user.id).toBe(first.json().user.id);
    expect(again.json().user.image).toBe("https://x/y.png");
    expect((await signup(app, "g@example.com")).statusCode).toBe(409);
  });

  it("keeps each user's chats and memory to themselves", async () => {
    const { app, kernel } = await setup();
    kernel.start();
    const a = (await signup(app, "a@example.com")).json().user.id as string;
    const b = (await signup(app, "b@example.com")).json().user.id as string;
    const ta = { "x-user-token": signUserToken(SECRET, a) };
    const tb = { "x-user-token": signUserToken(SECRET, b) };

    expect((await app.inject({ method: "GET", url: "/chats" })).statusCode).toBe(401);
    const chat = { id: "chat1", title: "hi", turns: [] };
    expect((await app.inject({ method: "PUT", url: "/chats/chat1", headers: ta, payload: chat })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/chats", headers: ta })).json().chats).toEqual([chat]);
    expect((await app.inject({ method: "GET", url: "/chats", headers: tb })).json().chats).toEqual([]);

    // Jobs need a user. Memory scope is stored per user.
    const anon = await app.inject({ method: "POST", url: "/jobs", payload: { memoryScope: "chat1", process: { role: "r", goal: "g", capabilities: [{ type: "MEMORY" }] } } });
    expect(anon.statusCode).toBe(401);
    const res = await app.inject({ method: "POST", url: "/jobs", headers: ta, payload: { memoryScope: "chat1", process: { role: "r", goal: "g", capabilities: [{ type: "MEMORY" }] } } });
    expect(res.statusCode).toBe(201);
    await kernel.waitForJob(res.json().jobId);

    const mine = (await app.inject({ method: "GET", url: "/memory?scope=chat1", headers: ta })).json();
    expect(mine.count).toBeGreaterThan(0);
    expect(mine.entries.every((e: { scope: string }) => e.scope === "chat1")).toBe(true);
    const theirs = (await app.inject({ method: "GET", url: "/memory?scope=chat1", headers: tb })).json();
    expect(theirs.count).toBe(0);
    const id = mine.entries[0].id as number;
    expect((await app.inject({ method: "DELETE", url: `/memory/${id}?scope=chat1`, headers: tb })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/memory/${id}?scope=chat1`, headers: ta })).statusCode).toBe(200);

    // Deleting a chat clears its memory.
    expect((await app.inject({ method: "DELETE", url: "/chats/chat1", headers: ta })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/memory?scope=chat1", headers: ta })).json().count).toBe(0);
    expect((await app.inject({ method: "GET", url: "/chats", headers: ta })).json().chats).toEqual([]);
    await kernel.stop();
  });
});

describe("job ownership", () => {
  it("shows each user only their own jobs, processes, events, files, and metrics", async () => {
    const { app, kernel } = await setup();
    kernel.start();
    const a = (await signup(app, "a@example.com")).json().user.id as string;
    const b = (await signup(app, "b@example.com")).json().user.id as string;
    const ta = { "x-user-token": signUserToken(SECRET, a) };
    const tb = { "x-user-token": signUserToken(SECRET, b) };

    // A job whose agent leaves a file in /output, so artifacts are covered too.
    const res = await app.inject({
      method: "POST",
      url: "/jobs",
      headers: ta,
      payload: { process: { role: "r", goal: "g" } },
    });
    const { jobId, pids } = res.json() as { jobId: string; pids: Record<string, string> };
    await kernel.waitForJob(jobId);
    const pid = Object.values(pids)[0]!;
    kernel.repos.artifacts.insert({ jobId, pid, path: "/output/a.txt", mime: "text/plain", createdAt: Date.now() }, new TextEncoder().encode("hi"));
    const artifactId = kernel.repos.artifacts.list({ jobId })[0]!.id;

    const get = (url: string, headers: Record<string, string>) => app.inject({ method: "GET", url, headers });
    // The owner sees it.
    expect((await get("/jobs", ta)).json().jobs.map((j: { id: string }) => j.id)).toContain(jobId);
    expect((await get(`/jobs/${jobId}`, ta)).statusCode).toBe(200);
    expect((await get("/processes", ta)).json().processes).toHaveLength(1);
    expect((await get(`/processes/${pid}`, ta)).statusCode).toBe(200);
    expect((await get("/events?sinceSeq=0", ta)).json().events.length).toBeGreaterThan(0);
    expect((await get("/artifacts", ta)).json().artifacts).toHaveLength(1);
    expect((await get(`/artifacts/${artifactId}`, ta)).statusCode).toBe(200);
    expect((await get("/metrics?range=15m", ta)).json().totals.llmCalls).toBeGreaterThan(0);

    // Someone else does not.
    expect((await get("/jobs", tb)).json().jobs).toEqual([]);
    expect((await get(`/jobs/${jobId}`, tb)).statusCode).toBe(404);
    expect((await get("/processes", tb)).json().processes).toEqual([]);
    expect((await get(`/processes/${pid}`, tb)).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/processes/${pid}/kill`, headers: tb })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/processes/${pid}/signal`, headers: tb, payload: { signal: "retry" } })).statusCode).toBe(404);
    expect((await get("/events?sinceSeq=0", tb)).json().events).toEqual([]);
    expect((await get("/artifacts", tb)).json().artifacts).toEqual([]);
    expect((await get(`/artifacts/${artifactId}`, tb)).statusCode).toBe(404);
    expect((await get(`/artifacts/${artifactId}?userToken=${signUserToken(SECRET, b)}`, {})).statusCode).toBe(404);
    expect((await get("/metrics?range=15m", tb)).json().totals.llmCalls).toBe(0);
    // And nobody signed out does.
    expect((await get("/jobs", {})).statusCode).toBe(401);
    expect((await get("/events?sinceSeq=0", {})).statusCode).toBe(401);

    // The owner is kept out of the event log.
    expect(JSON.stringify(kernel.bus.getEvents({ limit: 100_000 }))).not.toContain(a);
    await kernel.stop();
  });

  it("streams only the user's own events over the WebSocket", async () => {
    const { app, kernel } = await setup();
    kernel.start();
    const a = (await signup(app, "a@example.com")).json().user.id as string;
    const b = (await signup(app, "b@example.com")).json().user.id as string;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    const listen = (token?: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/events/stream?sinceSeq=0${token ? `&userToken=${token}` : ""}`);
      const jobs = new Set<string>();
      const state = { live: false, closed: 0 as number };
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "event") jobs.add(msg.event.jobId);
        if (msg.type === "live") state.live = true;
      });
      ws.on("close", (code) => (state.closed = code));
      return { ws, jobs, state };
    };
    const la = listen(signUserToken(SECRET, a));
    const lb = listen(signUserToken(SECRET, b));
    const anon = listen();
    while (!la.state.live || !lb.state.live) await new Promise((r) => setTimeout(r, 5));

    const ja = (await app.inject({ method: "POST", url: "/jobs", headers: { "x-user-token": signUserToken(SECRET, a) }, payload: { process: { role: "r", goal: "a" } } })).json().jobId as string;
    const jb = (await app.inject({ method: "POST", url: "/jobs", headers: { "x-user-token": signUserToken(SECRET, b) }, payload: { process: { role: "r", goal: "b" } } })).json().jobId as string;
    await kernel.waitForJob(ja);
    await kernel.waitForJob(jb);
    await new Promise((r) => setTimeout(r, 50));

    expect([...la.jobs]).toEqual([ja]);
    expect([...lb.jobs]).toEqual([jb]);
    expect(anon.state.closed).toBe(4401);
    la.ws.close();
    lb.ws.close();
    await kernel.stop();
  });
});
