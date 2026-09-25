"use client";
import type { ReplayedProcess } from "@kernelagent/kernel/replay";
import type { IpcMessage } from "@/lib/useKernel";
import { clock } from "@/lib/format";

export function IpcView({ messages, processes, onSelect }: { messages: IpcMessage[]; processes: ReplayedProcess[]; onSelect: (pid: string) => void }) {
  const boxes = processes
    .filter((p) => p.capabilities.some((c) => c.type === "RECEIVE" || c.type === "SEND") || messages.some((m) => m.to === p.pid || m.from === p.pid))
    .map((p) => ({
      p,
      pending: messages.filter((m) => m.to === p.pid && m.receivedAt === undefined).length,
      received: messages.filter((m) => m.to === p.pid && m.receivedAt !== undefined).length,
      sent: messages.filter((m) => m.from === p.pid).length,
    }));
  const Pid = ({ pid }: { pid: string }) => (
    <button className="text-term-accent hover:underline" onClick={() => onSelect(pid)}>
      {pid}
    </button>
  );
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-term-dim">MAILBOXES</h2>
        <table className="whitespace-pre">
          <thead className="text-term-dim">
            <tr>
              {["PID", "ROLE", "STATE", "PENDING", "RECEIVED", "SENT"].map((h) => (
                <th key={h} className="px-2 text-left font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {boxes.map(({ p, pending, received, sent }) => (
              <tr key={p.pid} className="border-t border-term-line/50">
                <td className="px-2">
                  <Pid pid={p.pid} />
                </td>
                <td className="px-2">{p.role}</td>
                <td className="px-2">
                  {p.status}
                  {p.waitingOn === "RECEIVE" ? " (blocked on RECEIVE)" : ""}
                </td>
                <td className={`px-2 text-right ${pending ? "text-amber-300" : ""}`}>{pending}</td>
                <td className="px-2 text-right">{received}</td>
                <td className="px-2 text-right">{sent}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {boxes.length === 0 && <p className="text-term-dim">no processes with IPC capabilities</p>}
      </div>
      <div>
        <h2 className="mb-1 text-term-dim">MESSAGE FLOW</h2>
        {messages.length === 0 && <p className="text-term-dim">no messages yet</p>}
        {[...messages].reverse().map((m) => (
          <div key={m.id} className="whitespace-pre-wrap border-t border-term-line/50 py-0.5">
            <span className="text-term-dim">{clock(m.sentAt)} #{m.id} </span>
            <Pid pid={m.from} /> ──▶ <Pid pid={m.to} />{" "}
            <span className={m.receivedAt ? "text-term-dim" : "text-amber-300"}>{m.receivedAt ? "delivered" : "queued"}</span>{" "}
            <span className="text-amber-100">{m.body.length > 200 ? m.body.slice(0, 200) + "…" : m.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
