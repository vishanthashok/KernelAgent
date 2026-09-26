import Link from "next/link";
import { redirect } from "next/navigation";
import { authEnabled, authProviders, currentUser, safeNext } from "@/auth";
import { signInWith } from "@/app/actions";
import { Brand } from "@/components/landing/Brand";

export const metadata = { title: "Sign in · KernelAgent" };

const ICON: Record<string, React.ReactNode> = {
  github: (
    <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.85-2.34 4.7-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z" fill="currentColor" />
  ),
  google: (
    <path d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.4a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.74 2.97-4.3 2.97-7.33zM12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.5c-.9.6-2.04.95-3.39.95-2.6 0-4.81-1.76-5.6-4.12H3.07v2.58A10 10 0 0 0 12 22zm-5.6-8.1a6 6 0 0 1 0-3.8V7.52H3.07a10 10 0 0 0 0 8.96l3.33-2.58zM12 5.98c1.47 0 2.79.5 3.83 1.5l2.86-2.86A9.6 9.6 0 0 0 12 2 10 10 0 0 0 3.07 7.52l3.33 2.58C7.19 7.74 9.4 5.98 12 5.98z" fill="currentColor" />
  ),
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (authEnabled && (await currentUser())) redirect(safeNext(next));

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Brand />
      </div>
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-term-dim">Sign in to run agents. Next you add your own Claude or OpenAI API key.</p>
        {authEnabled ? (
          <div className="mt-5 flex flex-col gap-2">
            {authProviders.map((p) => (
              <form key={p.id} action={signInWith.bind(null, p.id, next)}>
                <button type="submit" className="pill pill-ghost w-full justify-center py-2 text-sm">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                    {ICON[p.id]}
                  </svg>
                  Continue with {p.name}
                </button>
              </form>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded border border-term-line bg-term-panel-2 p-3 text-sm text-term-dim">
            Sign-in is not configured on this deploy, so the app is open.
            <Link href={safeNext(next)} className="mt-3 flex w-full justify-center pill pill-light py-2">
              Continue
            </Link>
          </div>
        )}
        <p className="mt-5 text-xs text-term-dim">
          We only read your name, email, and avatar to show who is signed in. Nothing is stored on a server.
        </p>
      </div>
      <Link href="/" className="mt-6 text-xs text-term-dim hover:text-term-fg">
        ← Back to the overview
      </Link>
    </main>
  );
}
