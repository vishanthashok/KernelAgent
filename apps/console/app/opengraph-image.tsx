// Link preview for LinkedIn and other sites. Matches the landing page: the prompt mark and
// the headline, on the dark canvas.
import { ImageResponse } from "next/og";

export const alt = "KernelAgent: agents, run like processes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#121319", color: "#e6e8ef", padding: 80 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg viewBox="0 0 32 32" width={56} height={56}>
            <rect width="32" height="32" rx="8" fill="#141416" />
            <rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="none" stroke="#ffffff" strokeOpacity=".1" />
            <path d="M9.5 10.5L15 16l-5.5 5.5" fill="none" stroke="#ece8df" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="17" y="19.6" width="6.5" height="2.6" rx="1.3" fill="#f0b44c" />
          </svg>
          <div style={{ fontSize: 34, fontWeight: 600 }}>KernelAgent</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", fontSize: 92, lineHeight: 1.05, marginTop: 70, letterSpacing: -2 }}>
          <span>Agents, run like&nbsp;</span>
          <span style={{ color: "#f0b44c" }}>processes.</span>
        </div>
        <div style={{ fontSize: 28, color: "#9aa0b2", marginTop: "auto" }}>Scheduler, checked syscalls, sandboxes, and a log you can replay.</div>
      </div>
    ),
    size,
  );
}
