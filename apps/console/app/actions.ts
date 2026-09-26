"use server";
import { AuthError } from "next-auth";
import { authEnabled, passwordEnabled, safeNext, signIn, signOut } from "@/auth";
import { accountsCall } from "@/lib/server-api";

export async function signInWith(provider: string, next: string | undefined) {
  if (!authEnabled) return;
  await signIn(provider, { redirectTo: safeNext(next) });
}

export interface FormState {
  error?: string;
  /** Put back in the form after an error, since React clears it on submit. */
  email?: string;
  name?: string;
  /** When the error came back, so the same error twice still resets the form. */
  at?: number;
}

/** Sign in with email and password. On success Auth.js redirects, which throws past the catch. */
export async function passwordSignIn(next: string | undefined, _prev: FormState, form: FormData): Promise<FormState> {
  if (!authEnabled || !passwordEnabled) return { error: "Email sign-in is not configured on this deploy." };
  const email = String(form.get("email") ?? "");
  try {
    await signIn("credentials", { email, password: form.get("password"), redirectTo: safeNext(next) });
    return {};
  } catch (err) {
    if (err instanceof AuthError) return { error: "Wrong email or password.", email, at: Date.now() };
    throw err;
  }
}

/** Create an email account, then sign in to it. */
export async function signUp(next: string | undefined, _prev: FormState, form: FormData): Promise<FormState> {
  if (!authEnabled || !passwordEnabled) return { error: "Email sign-up is not configured on this deploy." };
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const name = String(form.get("name") ?? "");
  const created = await accountsCall("signup", { email, password, name });
  if ("error" in created) return { error: created.error, email, name, at: Date.now() };
  try {
    await signIn("credentials", { email, password, redirectTo: safeNext(next) });
    return {};
  } catch (err) {
    if (err instanceof AuthError) return { error: "Your account was created, but signing in failed. Try signing in.", email, at: Date.now() };
    throw err;
  }
}

export async function signOutAction() {
  if (!authEnabled) return;
  await signOut({ redirectTo: "/" });
}
