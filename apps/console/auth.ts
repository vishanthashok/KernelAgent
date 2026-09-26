// Sign-in with Auth.js: GitHub, Google, and email + password, JWT sessions. Auth turns on
// when AUTH_SECRET is set with at least one way to sign in. Without it (local dev, a fresh
// clone) every page is open. Accounts (ACCOUNTS_SECRET, shared with the API) store users and
// their chats in the API's database. Model calls are paid for by the key the visitor
// brings, never by the login.
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { accountsCall, accountsSecret } from "@/lib/server-api";

declare module "next-auth" {
  interface Session {
    /** The account id in the API's database. Unset when accounts are off. */
    user: { id?: string } & DefaultSession["user"];
  }
}

const env = process.env;
const oauth = [
  ...(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET ? [{ id: "github", name: "GitHub", provider: GitHub }] : []),
  ...(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET ? [{ id: "google", name: "Google", provider: Google }] : []),
];

/** Email and password accounts need the API's account store. */
export const passwordEnabled = !!accountsSecret;
export const authEnabled = !!env.AUTH_SECRET && (oauth.length > 0 || passwordEnabled);

/** The provider sign-in buttons to show. */
export const authProviders = oauth.map(({ id, name }) => ({ id, name }));

const credentials = Credentials({
  credentials: { email: { type: "email" }, password: { type: "password" } },
  async authorize(c) {
    const r = await accountsCall("login", { email: c.email, password: c.password });
    return "user" in r ? { id: r.user.id, email: r.user.email, name: r.user.name ?? null, image: r.user.image ?? null } : null;
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [...oauth.map((o) => o.provider), ...(passwordEnabled ? [credentials] : [])],
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  // Vercel and Railway sit behind proxies that set the host header.
  trustHost: true,
  callbacks: {
    async jwt({ token, user, account }) {
      if (!account || !accountsSecret) return token;
      if (account.provider === "credentials") {
        token.uid = user.id;
      } else {
        // GitHub or Google vouched for the email: find or create its account.
        const r = await accountsCall("oauth", { email: user.email, name: user.name, image: user.image });
        if ("error" in r) throw new Error(r.error);
        token.uid = r.user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});

/** The signed-in user, or undefined when signed out or when auth is off. */
export async function currentUser(): Promise<{ id?: string; name?: string; email?: string; image?: string } | undefined> {
  if (!authEnabled) return undefined;
  const session = await auth();
  const u = session?.user;
  if (!u) return undefined;
  return {
    ...(u.id ? { id: u.id } : {}),
    ...(u.name ? { name: u.name } : {}),
    ...(u.email ? { email: u.email } : {}),
    ...(u.image ? { image: u.image } : {}),
  };
}

/** A same-site path to return to after sign-in. Anything else goes to /connect. */
export function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/connect";
}
