// Link preview for LinkedIn and other sites.
import { ImageResponse } from "next/og";

export const alt = "KernelAgent: run AI agents like OS processes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const rows = [
    ["p-1", "planner", "TERMINATED", "#3fb950"],
    ["p-2", "researcher", "RUNNING", "#b69cf0"],
    ["p-3", "coder", "BLOCKED", "#e3b341"],
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#16121f", color: "#e6e8ef", padding: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 12, background: "#8a5cd6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, fontWeight: 700, color: "#fff" }}>
            K
          </div>
          <div style={{ fontSize: 40, fontWeight: 600 }}>KernelAgent</div>
        </div>
        <div style={{ fontSize: 64, fontWeight: 600, marginTop: 48, lineHeight: 1.1, maxWidth: 950 }}>Run AI agents like operating system processes.</div>
        <div style={{ fontSize: 28, color: "#a9a2bf", marginTop: 24 }}>Scheduler · permission-checked syscalls · sandboxes · replayable log</div>
        <div style={{ display: "flex", gap: 16, marginTop: "auto" }}>
          {rows.map(([pid, role, state, color]) => (
            <div key={pid} style={{ display: "flex", gap: 14, fontSize: 24, fontFamily: "monospace", padding: "12px 18px", border: "1px solid #2f3140", borderRadius: 8 }}>
              <span>{pid}</span>
              <span style={{ color: "#a9a2bf" }}>{role}</span>
              <span style={{ color }}>{state}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
