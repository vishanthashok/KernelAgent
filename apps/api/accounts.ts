// Accounts: sign-up, sign-in, provider sign-in, and saved chats. On only when the API has
// ACCOUNTS_SECRET. The console calls the /accounts routes server-side with that secret, and
// the browser proves who it is with a signed user token (see packages/kernel/user-token.ts).
// API keys are never stored: they stay in the browser.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kernel } from "@kernelagent/kernel";
import { secretMatches, verifyUserToken } from "@kernelagent/kernel/user-token";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const USER_TOKEN_HEADER = "x-user-token";
export const SERVICE_HEADER = "x-accounts-secret";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const CHAT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_CHAT_BYTES = 512_000;
const MAX_CHATS = 500;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function checkPassword(password: string, stored: string | undefined): Promise<boolean> {
  const [kind, salt, hash] = (stored ?? "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(password, Buffer.from(salt, "base64"), want.length);
  return timingSafeEqual(want, got);
}

/** A user's memory scope for one chat, so no user can reach another's memory. */
export const userScope = (userId: string, chatId: string) => `u${userId}_${chatId}`;

const publicUser = (u: { id: string; email: string; name?: string; image?: string }) => ({
  id: u.id,
  email: u.email,
  ...(u.name ? { name: u.name } : {}),
  ...(u.image ? { image: u.image } : {}),
});

/** Failed sign-ins per email, to slow down password guessing. */
class AttemptLimiter {
  private fails = new Map<string, { n: number; since: number }>();
  constructor(private max = 10, private windowMs = 10 * 60_000) {}
  blocked(key: string, now: number): boolean {
    const f = this.fails.get(key);
    if (!f || now - f.since > this.windowMs) return false;
    return f.n >= this.max;
  }
  fail(key: string, now: number): void {
    const f = this.fails.get(key);
    if (!f || now - f.since > this.windowMs) this.fails.set(key, { n: 1, since: now });
    else f.n++;
  }
  reset(key: string): void {
    this.fails.delete(key);
  }
}

export interface Accounts {
  /** The signed-in user's id, or undefined. */
  userOf(req: FastifyRequest): string | undefined;
  /** The signed-in user's id, or a 401 sent on reply. */
  requireUser(req: FastifyRequest, reply: FastifyReply): string | undefined;
}

export function registerAccounts(app: FastifyInstance, kernel: Kernel, secret: string): Accounts {
  const repos = kernel.repos;
  const limiter = new AttemptLimiter();

  // The header, or ?userToken= for the WebSocket and file downloads, which cannot set headers.
  const userOf = (req: FastifyRequest) => {
    const h = req.headers[USER_TOKEN_HEADER];
    const q = (req.query as { userToken?: unknown } | undefined)?.userToken;
    const token = typeof h === "string" ? h : typeof q === "string" ? q : undefined;
    const uid = verifyUserToken(secret, token, kernel.now());
    return uid && repos.users.get(uid) ? uid : undefined;
  };
  const requireUser = (req: FastifyRequest, reply: FastifyReply) => {
    const uid = userOf(req);
    if (!uid) void reply.code(401).send({ error: "sign in first" });
    return uid;
  };
  const service = (req: FastifyRequest, reply: FastifyReply) => {
    if (secretMatches(secret, req.headers[SERVICE_HEADER])) return true;
    void reply.code(403).send({ error: "forbidden" });
    return false;
  };
  const newUserId = () => randomBytes(8).toString("hex");

  // ------------------------------------------------ console-to-API (service secret)

  app.post<{ Body: { email?: unknown; password?: unknown; name?: unknown } }>("/accounts/signup", async (req, reply) => {
    if (!service(req, reply)) return;
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const name = String(req.body?.name ?? "").trim().slice(0, 80);
    if (!EMAIL.test(email)) return reply.code(400).send({ error: "Enter a valid email address." });
    if (password.length < 8 || password.length > 200) return reply.code(400).send({ error: "Use a password of at least 8 characters." });
    const existing = repos.users.byEmail(email);
    if (existing?.passwordHash) return reply.code(409).send({ error: "An account with this email already exists. Sign in instead." });
    if (existing) {
      // Signed in with GitHub or Google before: only that provider can prove the email.
      return reply.code(409).send({ error: "This email already has an account through GitHub or Google. Sign in with that." });
    }
    const user = repos.users.insert({
      id: newUserId(),
      email,
      ...(name ? { name } : {}),
      passwordHash: await hashPassword(password),
      createdAt: kernel.now(),
    });
    return reply.code(201).send({ user: publicUser(user) });
  });

  app.post<{ Body: { email?: unknown; password?: unknown } }>("/accounts/login", async (req, reply) => {
    if (!service(req, reply)) return;
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const now = kernel.now();
    if (limiter.blocked(email, now)) return reply.code(429).send({ error: "Too many attempts. Try again in a few minutes." });
    const user = repos.users.byEmail(email);
    if (!user || !(await checkPassword(password, user.passwordHash))) {
      limiter.fail(email, now);
      return reply.code(401).send({ error: "Wrong email or password." });
    }
    limiter.reset(email);
    return { user: publicUser(user) };
  });

  // GitHub or Google vouched for this email. Find its account or create one.
  app.post<{ Body: { email?: unknown; name?: unknown; image?: unknown } }>("/accounts/oauth", async (req, reply) => {
    if (!service(req, reply)) return;
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) return reply.code(400).send({ error: "the provider did not share an email" });
    const name = typeof req.body?.name === "string" ? req.body.name.slice(0, 80) : undefined;
    const image = typeof req.body?.image === "string" && /^https:\/\//.test(req.body.image) ? req.body.image.slice(0, 500) : undefined;
    let user = repos.users.byEmail(email);
    if (user) repos.users.update(user.id, { ...(name ? { name } : {}), ...(image ? { image } : {}) });
    else user = repos.users.insert({ id: newUserId(), email, ...(name ? { name } : {}), ...(image ? { image } : {}), createdAt: kernel.now() });
    return { user: publicUser(repos.users.get(user.id)!) };
  });

  // ------------------------------------------------ browser (user token)

  app.get("/me", async (req, reply) => {
    const uid = requireUser(req, reply);
    if (!uid) return;
    return { user: publicUser(repos.users.get(uid)!), chats: repos.chats.count(uid) };
  });

  app.get("/chats", async (req, reply) => {
    const uid = requireUser(req, reply);
    if (!uid) return;
    return { chats: repos.chats.list(uid).map((c) => c.data) };
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/chats/:id", { bodyLimit: MAX_CHAT_BYTES * 2 }, async (req, reply) => {
    const uid = requireUser(req, reply);
    if (!uid) return;
    const id = req.params.id;
    if (!CHAT_ID.test(id)) return reply.code(400).send({ error: "bad chat id" });
    const body = req.body as { id?: unknown } | null;
    if (!body || typeof body !== "object" || body.id !== id) return reply.code(400).send({ error: "body must be the chat, with a matching id" });
    if (JSON.stringify(body).length > MAX_CHAT_BYTES) return reply.code(413).send({ error: "chat too large" });
    if (repos.chats.count(uid) >= MAX_CHATS && !repos.chats.list(uid).some((c) => c.id === id)) {
      return reply.code(400).send({ error: `limit of ${MAX_CHATS} chats reached. Delete some first.` });
    }
    repos.chats.put(uid, id, body, kernel.now());
    return { saved: id };
  });

  app.delete<{ Params: { id: string } }>("/chats/:id", async (req, reply) => {
    const uid = requireUser(req, reply);
    if (!uid) return;
    if (!CHAT_ID.test(req.params.id)) return reply.code(400).send({ error: "bad chat id" });
    repos.chats.delete(uid, req.params.id);
    // A deleted chat takes its memory with it.
    repos.memories.clear(userScope(uid, req.params.id));
    return { deleted: req.params.id };
  });

  return { userOf, requireUser };
}
