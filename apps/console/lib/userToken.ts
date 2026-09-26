// The signed-in user's API token, from the console's /api/token route. Cached until shortly
// before it expires. Undefined when accounts are off or nobody is signed in.
let cache: { token: string | undefined; until: number } | undefined;
let inflight: Promise<string | undefined> | undefined;

export function userToken(): Promise<string | undefined> {
  if (cache && Date.now() < cache.until) return Promise.resolve(cache.token);
  inflight ??= fetch("/api/token", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ token: string | null; expiresAt?: number }>) : { token: null }))
    .catch(() => ({ token: null as string | null, expiresAt: undefined }))
    .then((b) => {
      const token = b.token ?? undefined;
      // Refresh five minutes early. Without a token, check again in a minute.
      cache = { token, until: token && b.expiresAt ? b.expiresAt - 5 * 60_000 : Date.now() + 60_000 };
      return token;
    })
    .finally(() => (inflight = undefined));
  return inflight;
}
