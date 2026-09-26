"use client";
// App frame shared by every page: a dark nav rail on the left (a top bar on phones),
// and a content area. Pages put a PageHeader at the top of their content.
import Link from "next/link";
import { useTheme } from "@/lib/theme";
import { Logo } from "./Logo";

export type Section = "chat" | "console" | "dashboard";

const I = {
  chat: <path d="M4 5h16v11H9l-5 4V5z" />,
  console: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M8 10l3 2-3 2M13 15h3" />
    </>
  ),
  dashboard: <path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
};

function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof I; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {I[name]}
    </svg>
  );
}

const NAV: { key: Section; href: string; label: string }[] = [
  { key: "chat", href: "/", label: "Chat" },
  { key: "console", href: "/console", label: "Console" },
  { key: "dashboard", href: "/dashboard", label: "Metrics" },
];

function ThemeButton({ compact }: { compact?: boolean }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => setTheme(next)}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      className={`flex flex-col items-center gap-1 rounded-md text-nav-fg transition-colors hover:bg-[#ffffff14] hover:text-white ${compact ? "p-2" : "w-full px-1 py-2"}`}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
      {!compact && <span className="text-[10px] font-medium">{theme === "dark" ? "Light" : "Dark"}</span>}
    </button>
  );
}

export function AppShell({ active, children, status }: { active: Section; children: React.ReactNode; status?: boolean | undefined }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      {/* Rail (tablet and up) */}
      <aside className="hidden w-[68px] shrink-0 flex-col items-center bg-nav py-3 md:flex">
        <Link href="/" className="logo-link mb-5 block rounded-lg" title="KernelAgent" aria-label="KernelAgent home">
          <Logo size={38} />
        </Link>
        <nav className="flex w-full flex-1 flex-col gap-1 px-1.5">
          {NAV.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              className={`relative flex flex-col items-center gap-1 rounded-md px-1 py-2 transition-colors ${
                active === n.key ? "bg-[#ffffff1f] text-white" : "text-nav-fg hover:bg-[#ffffff14] hover:text-white"
              }`}
            >
              {active === n.key && <span className="absolute top-2 bottom-2 -left-1.5 w-[3px] rounded-r bg-accent" />}
              <Icon name={n.key} />
              <span className="text-[10px] font-medium">{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="flex w-full flex-col items-center gap-2 px-1.5">
          <ThemeButton />
          {status !== undefined && (
            <span className="flex items-center gap-1 text-[10px] text-nav-fg" title={status ? "API connected" : "API unreachable"}>
              <span className={`h-2 w-2 rounded-full ${status ? "bg-[var(--status-good)]" : "bg-[var(--status-critical)]"}`} />
              {status ? "API" : "Off"}
            </span>
          )}
        </div>
      </aside>

      {/* Top bar (phones) */}
      <header className="flex h-12 shrink-0 items-center gap-1 bg-nav px-2 md:hidden">
        <Link href="/" className="logo-link mr-1 block rounded-lg" aria-label="KernelAgent home">
          <Logo size={32} />
        </Link>
        {NAV.map((n) => (
          <Link
            key={n.key}
            href={n.href}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${active === n.key ? "bg-[#ffffff1f] text-white" : "text-nav-fg"}`}
          >
            <Icon name={n.key} className="h-4 w-4" />
            {n.label}
          </Link>
        ))}
        <span className="ml-auto" />
        {status !== undefined && <span className={`mr-1 h-2 w-2 rounded-full ${status ? "bg-[var(--status-good)]" : "bg-[var(--status-critical)]"}`} />}
        <ThemeButton compact />
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** Title bar at the top of a page's content: breadcrumb, title, and actions on the right. */
export function PageHeader({ crumb, title, children }: { crumb?: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-term-line bg-term-panel px-4 py-2 md:px-5">
      <div className="min-w-0">
        {crumb && <div className="text-[11px] text-term-dim">{crumb}</div>}
        <h1 className="truncate text-[15px] font-semibold">{title}</h1>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
