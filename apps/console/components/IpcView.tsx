"use client";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import type { IpcMessage } from "@/lib/useKernel";
import { clock } from "@/lib/format";
import { StateChip } from "./StateChip";

export function IpcView({ messages, processes, onSelect }: { messages: IpcMessage[]; processes: ReplayedProcess[]; onSelect: (pid: string) => void }) {
  const boxes = processes
    .filter((p) => p.capabilities.some((c) => c.type === "RECEIVE" || c.type === "SEND") || messages.some((m) => m.to === p.pid || m.from === p.pid))
    .sort((a, b) => Number(a.pid) - Number(b.pid))
    .map((p) => ({
      p,
      pending: messages.filter((m) => m.to === p.pid && m.receivedAt === undefined).length,
      received: messages.filter((m) => m.to === p.pid && m.receivedAt !== undefined).length,
      sent: messages.filter((m) => m.from === p.pid).length,
    }));
  const Pid = ({ pid }: { pid: string }) => (
    <button className="font-mono text-term-accent hover:underline" onClick={() => onSelect(pid)}>
      {pid}
    </button>
  );
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <div className="label-caps mb-3">Mailboxes</div>
        {boxes.length === 0 ? (
          <p className="text-term-dim">No processes with messaging permissions.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr>
                {["PID", "Role", "State", "Queued", "Read", "Sent"].map((h) => (
                  <th key={h} className="label-caps px-2 pb-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-sm">
              {boxes.map(({ p, pending, received, sent }) => (
                <tr key={p.pid} className="border-t border-ink/[0.06]">
                  <td className="px-2 py-2.5">
                    <Pid pid={p.pid} />
                  </td>
                  <td className="px-2 py-2.5 font-medium">{p.role}</td>
                  <td className="px-2 py-2.5">
                    <StateChip status={p.status} detail={p.waitingOn?.toLowerCase()} />
                  </td>
                  <td className={`px-2 py-2.5 font-mono ${pending ? "text-warn" : "text-term-dim"}`}>{pending}</td>
                  <td className="px-2 py-2.5 font-mono text-term-dim">{received}</td>
                  <td className="px-2 py-2.5 font-mono text-term-dim">{sent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <div className="label-caps mb-3">Message flow</div>
        {messages.length === 0 && <p className="text-term-dim">No messages yet.</p>}
        <div className="space-y-2">
          {[...messages].reverse().map((m) => (
            <div key={m.id} className="rounded-md border border-ink/[0.08] bg-ink/[0.02] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Pid pid={m.from} />
                <span className="text-term-dim">→</span>
                <Pid pid={m.to} />
                <span
                  className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                    m.receivedAt ? "bg-ink/5 text-term-dim" : "bg-warn/10 text-warn"
                  }`}
                >
                  {m.receivedAt ? "delivered" : "queued"}
                </span>
                <span className="ml-auto font-mono text-term-dim">
                  #{m.id} · {clock(m.sentAt)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed">{m.body.length > 300 ? m.body.slice(0, 300) + "…" : m.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
