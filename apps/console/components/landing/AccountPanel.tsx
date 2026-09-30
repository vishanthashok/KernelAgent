"use client";
// The landing page's account box: create an account or sign in, right in the hero. Signed-in
// visitors get links back to their chats instead. Uses the same server actions as /signup and /login.
import Link from "next/link";
import { useState } from "react";
import { passwordSignIn, signInWith, signUp } from "@/app/actions";
import { PasswordForm } from "./PasswordForm";
import { ICON } from "./providerIcons";

const NEXT = "/connect";
const PRIMARY =
  "mt-1 w-full rounded-[5px] bg-term-fg px-4 py-2.5 text-[14px] font-medium text-term-bg transition-opacity hover:opacity-85 disabled:opacity-50";

export function AccountPanel({
  user,
  accounts,
  providers,
}: {
  user?: { name?: string; email?: string } | undefined;
  /** Email accounts are on (ACCOUNTS_SECRET and AUTH_SECRET are set). */
  accounts: boolean;
  providers: { id: string; name: string }[];
}) {
  const [mode, setMode] = useState<"signup" | "signin">("signup");

  if (user) {
    const first = (user.name ?? user.email ?? "").split(/[\s@]/)[0];
    return (
      <Panel>
        <p className="font-serif text-[26px] leading-tight">Welcome back{first ? `, ${first}` : ""}.</p>
        <p className="mt-2 text-[14px] leading-relaxed text-term-dim">Your chats and everything your agents remember are where you left them.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/chat" className={`${PRIMARY} text-center`}>
            Open your chats
          </Link>
          <Link href="/connect" className="py-2 text-center text-[13px] text-term-dim hover:text-term-fg">
            API keys
          </Link>
        </div>
      </Panel>
    );
  }

  if (!accounts && providers.length === 0) {
    return (
      <Panel>
        <p className="text-[14px] leading-relaxed text-term-dim">Accounts are off on this deploy, so the app is open to everyone.</p>
        <Link href={NEXT} className={`${PRIMARY} mt-5 block text-center`}>
          Open the app
        </Link>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex gap-5 border-b border-term-line text-[14px]" role="tablist">
        {(["signup", "signin"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`-mb-px border-b pb-2.5 transition-colors ${mode === m ? "border-term-fg text-term-fg" : "border-transparent text-term-dim hover:text-term-fg"}`}
          >
            {m === "signup" ? "Create account" : "Sign in"}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {accounts && (
          <PasswordForm key={mode} mode={mode} action={(mode === "signup" ? signUp : passwordSignIn).bind(null, NEXT)} buttonClass={PRIMARY} />
        )}
        {providers.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {accounts && <div className="text-center text-[11px] text-term-dim">or</div>}
            {providers.map((p) => (
              <form key={p.id} action={signInWith.bind(null, p.id, NEXT)}>
                <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-[5px] border border-term-line py-2 text-[13px] hover:bg-term-panel-2">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                    {ICON[p.id]}
                  </svg>
                  Continue with {p.name}
                </button>
              </form>
            ))}
          </div>
        )}
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-term-dim">
        Your chats and what your agents remember are saved to your account, on any device. Your API key stays in your browser.
      </p>
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div id="account" className="scroll-mt-24 rounded-[8px] border border-term-line bg-term-panel p-6">
      {children}
    </div>
  );
}
