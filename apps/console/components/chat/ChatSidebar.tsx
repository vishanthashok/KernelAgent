"use client";
import Link from "next/link";
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
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-sunk/60 md:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-term-line bg-term-panel-2 transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-12 items-center border-b border-term-line px-3">
          <button onClick={onNew} className="pill pill-light w-full justify-center py-1.5">
            New chat
          </button>
        </div>
        <div className="label-caps px-4 pt-3 pb-1.5">Chats</div>
        <nav className="min-h-0 flex-1 overflow-auto px-2">
          {sorted.length === 0 && <p className="px-3 py-2 text-sm text-term-dim">No chats yet.</p>}
          {sorted.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center rounded-md px-3 py-2 text-sm transition-colors ${
                c.id === activeId ? "bg-accent/12 font-medium text-term-fg" : "text-term-dim hover:bg-ink/5 hover:text-term-fg"
              }`}
            >
              <button onClick={() => onSelect(c.id)} className="min-w-0 flex-1 truncate text-left">
                {c.title || "New chat"}
              </button>
              <button
                onClick={() => onDelete(c.id)}
                className="ml-2 hidden text-xs text-term-dim hover:text-danger group-hover:block"
                title="Delete chat"
              >
                ✕
              </button>
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
