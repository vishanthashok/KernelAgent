// Signed user tokens: how the console tells the API who is signed in. HMAC-SHA256 over a
// small JSON payload, base64url, with a shared secret (ACCOUNTS_SECRET) that both sides hold.
// Dependency-free so the console can import it.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface UserTokenPayload {
  /** User id. */
  sub: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function signUserToken(secret: string, sub: string, ttlMs = 60 * 60_000, now = Date.now()): string {
  const body = b64(JSON.stringify({ sub, exp: now + ttlMs } satisfies UserTokenPayload));
  return `${body}.${mac(secret, body)}`;
}

/** The token's user id, or undefined when it is malformed, forged, or expired. */
export function verifyUserToken(secret: string, token: string | undefined, now = Date.now()): string | undefined {
  if (!token) return undefined;
  const [body, sig] = token.split(".");
  if (!body || !sig) return undefined;
  const want = Buffer.from(mac(secret, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<UserTokenPayload>;
    return typeof p.sub === "string" && typeof p.exp === "number" && p.exp > now ? p.sub : undefined;
  } catch {
    return undefined;
  }
}

/** Constant-time string compare, for the console-to-API service secret. */
export function secretMatches(secret: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
