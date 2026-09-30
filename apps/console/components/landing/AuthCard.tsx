// The sign-in and sign-up card: provider buttons, then the email form. Server component.
import Link from "next/link";
import { authEnabled, authProviders, passwordEnabled, safeNext } from "@/auth";
import { passwordSignIn, signInWith, signUp } from "@/app/actions";
import { Brand } from "./Brand";
import { PasswordForm } from "./PasswordForm";
import { ICON } from "./providerIcons";

const ERRORS: Record<string, string> = {
  OAuthAccountNotLinked: "That email is linked to another sign-in method.",
  AccessDenied: "Sign-in was cancelled.",
  Configuration: "Sign-in failed. Try again, or use another method.",
};

export function AuthCard({ mode, next, error }: { mode: "signin" | "signup"; next?: string | undefined; error?: string | undefined }) {
  const q = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Brand />
      </div>
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">{mode === "signup" ? "Create your account" : "Sign in"}</h1>
        <p className="mt-1 text-sm text-term-dim">
          {mode === "signup" ? "Your chats and agent memory are saved to your account, on any device." : "Sign in to run agents."} Next you add your own Claude or OpenAI API key.
        </p>
        {error && <p className="mt-3 rounded border border-danger/40 p-2 text-xs text-danger">{ERRORS[error] ?? "Sign-in failed. Try again."}</p>}
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
            {passwordEnabled && (
              <>
                {authProviders.length > 0 && (
                  <div className="my-2 flex items-center gap-3 text-[11px] text-term-dim">
                    <span className="h-px flex-1 bg-term-line" />
                    or with email
                    <span className="h-px flex-1 bg-term-line" />
                  </div>
                )}
                <PasswordForm mode={mode} action={(mode === "signup" ? signUp : passwordSignIn).bind(null, next)} />
                <p className="mt-2 text-center text-xs text-term-dim">
                  {mode === "signup" ? (
                    <>
                      Have an account?{" "}
                      <Link href={`/login${q}`} className="text-term-accent underline">
                        Sign in
                      </Link>
                    </>
                  ) : (
                    <>
                      New here?{" "}
                      <Link href={`/signup${q}`} className="text-term-accent underline">
                        Create an account
                      </Link>
                    </>
                  )}
                </p>
              </>
            )}
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
          {passwordEnabled
            ? "Your account stores your name, email, chats, and agent memory. Your API keys stay in your browser and are never saved to your account."
            : "We only read your name, email, and avatar to show who is signed in."}
        </p>
      </div>
      <Link href="/" className="mt-6 text-xs text-term-dim hover:text-term-fg">
        ← Back to the overview
      </Link>
    </main>
  );
}
