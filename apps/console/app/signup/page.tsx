import { redirect } from "next/navigation";
import { authEnabled, currentUser, passwordEnabled, safeNext } from "@/auth";
import { AuthCard } from "@/components/landing/AuthCard";

export const metadata = { title: "Create an account · KernelAgent" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (authEnabled && (await currentUser())) redirect(safeNext(next));
  // Without email accounts, GitHub or Google sign-in creates the account.
  if (!passwordEnabled) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return <AuthCard mode="signup" next={next} />;
}
