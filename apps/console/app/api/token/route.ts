// A short-lived signed token that tells the API who is signed in. The browser fetches it and
// sends it as x-user-token. No token when accounts are off or nobody is signed in.
import { signUserToken } from "@kernelagent/kernel/user-token";
import { authEnabled, currentUser } from "@/auth";
import { accountsSecret } from "@/lib/server-api";

export const dynamic = "force-dynamic";
const TTL_MS = 60 * 60_000;

export async function GET() {
  const user = authEnabled && accountsSecret ? await currentUser() : undefined;
  if (!user?.id || !accountsSecret) return Response.json({ token: null }, { headers: { "cache-control": "no-store" } });
  return Response.json({ token: signUserToken(accountsSecret, user.id, TTL_MS), expiresAt: Date.now() + TTL_MS }, { headers: { "cache-control": "no-store" } });
}
