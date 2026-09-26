// Server-only calls from the console to the API's /accounts routes, with the shared secret.

const API_URL = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const DEV_TOKEN = process.env.NEXT_PUBLIC_KERNEL_DEV_TOKEN;

export const accountsSecret = process.env.ACCOUNTS_SECRET;

export interface AccountUser {
  id: string;
  email: string;
  name?: string;
  image?: string;
}

/** POST to an /accounts route. Returns the user, or the API's error message. */
export async function accountsCall(path: string, body: unknown): Promise<{ user: AccountUser } | { error: string }> {
  if (!accountsSecret) return { error: "accounts are not configured on this deploy" };
  try {
    const res = await fetch(`${API_URL}/accounts/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-accounts-secret": accountsSecret,
        ...(DEV_TOKEN ? { authorization: `Bearer ${DEV_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json()) as { user?: AccountUser; error?: string };
    return res.ok && json.user ? { user: json.user } : { error: json.error ?? `the API returned ${res.status}` };
  } catch {
    return { error: "Can't reach the KernelAgent API. Try again in a minute." };
  }
}
