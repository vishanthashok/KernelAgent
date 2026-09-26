import Link from "next/link";

/** Logo and name, linking home. Shared by the landing, login, and connect pages. */
export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent font-mono text-sm font-bold text-on-accent">K</span>
      <span className="text-[15px] font-semibold">KernelAgent</span>
    </Link>
  );
}

export const REPO_URL = "https://github.com/vishanthashok/KernelAgent";
