// Sign-in with Auth.js: GitHub and Google, JWT sessions, no database. Auth turns on only when
// AUTH_SECRET and at least one provider's id and secret are set. Without them (local dev, a
// fresh clone) every page is open. The login gates the UI only. Model calls are paid for by
// the key the visitor brings, not by the login.
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

const env = process.env;
const providers = [
  ...(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET ? [GitHub] : []),
  ...(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET ? [Google] : []),
];

export const authEnabled = !!env.AUTH_SECRET && providers.length > 0;

/** The sign-in buttons to show. */
export const authProviders = providers.map((p) => (p === GitHub ? { id: "github", name: "GitHub" } : { id: "google", name: "Google" }));

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Vercel and Railway sit behind proxies that set the host header.
  trustHost: true,
});

/** The signed-in user, or undefined when signed out or when auth is off. */
export async function currentUser(): Promise<{ name?: string; email?: string; image?: string } | undefined> {
  if (!authEnabled) return undefined;
  const session = await auth();
  const u = session?.user;
  if (!u) return undefined;
  return { ...(u.name ? { name: u.name } : {}), ...(u.email ? { email: u.email } : {}), ...(u.image ? { image: u.image } : {}) };
}

/** A same-site path to return to after sign-in. Anything else goes to /connect. */
export function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/connect";
}
