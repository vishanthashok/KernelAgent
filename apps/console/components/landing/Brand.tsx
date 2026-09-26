import Link from "next/link";
import { Logo } from "@/components/shell/Logo";

/** Logo and name, linking home. Shared by the landing, login, and connect pages. */
export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <Logo size={32} />
      <span className="text-[15px] font-semibold">KernelAgent</span>
    </Link>
  );
}

export const REPO_URL = "https://github.com/vishanthashok/KernelAgent";
