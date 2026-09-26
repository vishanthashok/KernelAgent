"use client";
// The signed-in user's avatar with a small menu: API keys and sign out. Renders nothing when
// sign-in is off on this deploy or nobody is signed in.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions";

type User = { name?: string; email?: string; image?: string };

export function UserMenu({ user: given, variant = "bar" }: { user?: User | undefined; variant?: "bar" | "rail" }) {
  const [user, setUser] = useState<User | undefined>(given);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (given) return;
    let live = true;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { user?: User } | null) => live && s?.user && setUser(s.user))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [given]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!user) return null;
  const initial = (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={user.name ?? user.email}
        aria-label="Account menu"
        className={`flex items-center justify-center overflow-hidden rounded-full bg-accent font-semibold text-on-accent ${variant === "rail" ? "h-8 w-8 text-xs" : "h-8 w-8 text-sm"}`}
      >
        {user.image ? <img src={user.image} alt="" className="h-full w-full object-cover" /> : initial}
      </button>
      {open && (
        <div
          className={`card absolute z-50 w-56 p-1 text-sm text-term-fg ${variant === "rail" ? "bottom-0 left-full ml-2" : "top-full right-0 mt-2"}`}
          role="menu"
        >
          <div className="border-b border-term-line px-3 py-2">
            <div className="truncate font-medium">{user.name ?? "Signed in"}</div>
            {user.email && <div className="truncate text-xs text-term-dim">{user.email}</div>}
          </div>
          <Link href="/connect" className="block rounded px-3 py-2 hover:bg-term-panel-2" role="menuitem" onClick={() => setOpen(false)}>
            API keys
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="w-full rounded px-3 py-2 text-left hover:bg-term-panel-2" role="menuitem">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
