"use client";
import Link from "next/link";
import { useState } from "react";
import type { Stats } from "@/lib/api";
import type { Chat } from "@/lib/chats";
import type { ResolvedModel } from "@/lib/useModels";

export function ChatSidebar({
  chats,
  activeId,
  onSelect,
  onNew,
  onDelete,
  connected,
  stats,
  model,
  open,
  onClose,
}: {
  chats: Chat[];
  activeId?: string | undefined;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  connected: boolean;
  stats?: Stats | undefined;
  model?: ResolvedModel | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const sorted = [...chats]
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.turns.some((t) => t.prompt.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = groupByDay(sorted);
  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-sunk/60 md:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-term-line bg-term-panel transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col gap-2 border-b border-term-line p-3">
          <button
            onClick={onNew}
            className="flex w-full items-center justify-between rounded-[7px] border border-term-line px-3 py-2 text-[13.5px] transition-colors hover:border-accent/60"
          >
            New chat <span className="font-mono text-term-dim">+</span>
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="w-full rounded-[7px] border px-3 py-1.5 text-[13px]"
          />
        </div>
        <nav className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {sorted.length === 0 && <p className="px-3 py-2 text-[13px] text-term-dim">{q ? "No chats match." : "No chats yet."}</p>}
          {groups.map(([label, items]) => (
            <div key={label} className="mb-3">
              <div className="px-3 pt-1 pb-1 text-[11px] text-term-dim">{label}</div>
              {items.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center rounded-[6px] px-3 py-1.5 text-[13.5px] transition-colors ${
                    c.id === activeId ? "bg-ink/10 text-term-fg" : "text-term-dim hover:bg-ink/5 hover:text-term-fg"
                  }`}
                >
                  <button onClick={() => onSelect(c.id)} className="min-w-0 flex-1 truncate text-left">
                    {c.title || "New chat"}
                  </button>
                  <button onClick={() => onDelete(c.id)} className="ml-2 hidden text-xs text-term-dim hover:text-danger group-hover:block" title="Delete chat">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-term-line px-3 py-3 text-sm">
          <div className="mb-3 flex items-center gap-2 text-xs text-term-dim">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-[var(--status-good)]" : "bg-[var(--status-critical)]"}`} />
            <span className="truncate">{connected ? (stats ? `${stats.provider} / ${model?.name ?? stats.model}` : "live") : "API offline"}</span>
          </div>
          <Link href="/dashboard" className="pill pill-ghost w-full justify-center py-1.5 text-xs">
            Open metrics
          </Link>
        </div>
      </aside>
    </>
  );
}

/** Chats grouped as Today, Yesterday, This week, and Earlier. */
function groupByDay(chats: Chat[]): [string, Chat[]][] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const label = (t: number) => (t >= start.getTime() ? "Today" : t >= start.getTime() - day ? "Yesterday" : t >= start.getTime() - 6 * day ? "This week" : "Earlier");
  const out: [string, Chat[]][] = [];
  for (const c of chats) {
    const l = label(c.updatedAt);
    const g = out.find(([k]) => k === l);
    if (g) g[1].push(c);
    else out.push([l, [c]]);
  }
  return out;
}
