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
      {open && <div className="fixed inset-0 z-20 bg-black/60 md:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-white/10 bg-[#0d1116] transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-4 pt-5 pb-3">
          <div className="mb-5 font-mono text-sm font-semibold tracking-[0.35em]">KERNELAGENT</div>
          <button onClick={onNew} className="pill pill-light w-full justify-center">
            New chat
          </button>
        </div>
        <div className="label-caps px-5 pt-2 pb-2">Chats</div>
        <nav className="min-h-0 flex-1 overflow-auto px-2">
          {sorted.length === 0 && <p className="px-3 py-2 text-sm text-term-dim">No chats yet.</p>}
          {sorted.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center rounded-xl px-3 py-2 text-sm transition-colors ${
                c.id === activeId ? "bg-white/10 text-term-fg" : "text-term-dim hover:bg-white/5 hover:text-term-fg"
              }`}
            >
              <button onClick={() => onSelect(c.id)} className="min-w-0 flex-1 truncate text-left">
                {c.title || "New chat"}
              </button>
              <button
                onClick={() => onDelete(c.id)}
                className="ml-2 hidden text-xs text-term-dim hover:text-red-300 group-hover:block"
                title="Delete chat"
              >
                ✕
              </button>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-4 text-sm">
          <div className="mb-3 flex items-center gap-2 text-xs text-term-dim">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`} />
            <span className="truncate">{connected ? (stats ? `${stats.provider} / ${model?.name ?? stats.model}` : "live") : "API offline"}</span>
          </div>
          <Link href="/console" className="pill pill-ghost w-full justify-center text-sm">
            Open console
          </Link>
        </div>
      </aside>
    </>
  );
}
