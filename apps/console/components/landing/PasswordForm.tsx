"use client";
// Email and password form for sign-in and sign-up. Errors come back from the server action.
import { useActionState } from "react";
import type { FormState } from "@/app/actions";

export function PasswordForm({
  action,
  mode,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  mode: "signin" | "signup";
}) {
  const [state, submit, pending] = useActionState(action, {});
  const field = "w-full border px-3 py-2 text-sm";
  return (
    // A new key per result remounts the fields, so the kept email shows after an error.
    <form key={state.at ?? 0} action={submit} className="flex flex-col gap-2">
      {mode === "signup" && (
        <label className="flex flex-col gap-1 text-xs text-term-dim">
          Name
          <input name="name" autoComplete="name" maxLength={80} defaultValue={state.name} className={field} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-term-dim">
        Email
        <input name="email" type="email" required autoComplete="email" defaultValue={state.email} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-term-dim">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={field}
        />
      </label>
      {state.error && <p className="text-xs text-danger" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending} className="pill pill-light mt-1 w-full justify-center py-2 text-sm disabled:opacity-50">
        {pending ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
