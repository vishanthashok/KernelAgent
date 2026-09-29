import Link from "next/link";
import { Logo } from "@/components/shell/Logo";

/** Logo and name, linking home. Shared by the landing, login, and connect pages. */
export function Brand() {
  return (
    <Link href="/" className="brand flex items-center gap-2.5">
      <Logo size={28} />
      <span className="text-[15px] font-semibold tracking-tight">KernelAgent</span>
    </Link>
  );
}

export const REPO_URL = "https://github.com/vishanthashok/KernelAgent";
