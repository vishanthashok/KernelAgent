import { redirect } from "next/navigation";
import { authEnabled, currentUser, safeNext } from "@/auth";
import { AuthCard } from "@/components/landing/AuthCard";

export const metadata = { title: "Sign in · KernelAgent" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (authEnabled && (await currentUser())) redirect(safeNext(next));
  return <AuthCard mode="signin" next={next} error={error} />;
}
