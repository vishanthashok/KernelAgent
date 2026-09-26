"use server";
import { authEnabled, safeNext, signIn, signOut } from "@/auth";

export async function signInWith(provider: string, next: string | undefined) {
  if (!authEnabled) return;
  await signIn(provider, { redirectTo: safeNext(next) });
}

export async function signOutAction() {
  if (!authEnabled) return;
  await signOut({ redirectTo: "/" });
}
