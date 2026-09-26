// The KernelAgent mark: a kernel core with three processes on the scheduler's orbit,
// colored like process states (running, waiting, ready). Same drawing as app/icon.svg.
// The orbit turns slowly while the logo is hovered.
import { useId } from "react";

export function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  const bg = `logo-bg-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={`logo ${className}`} aria-hidden>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9b6ce0" />
          <stop offset="1" stopColor="#3d1a78" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${bg})`} />
      <g className="logo-orbit">
        <circle cx="16" cy="16" r="9" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" strokeDasharray="2.2 2.2" />
        <path d="M16 16L16 7M16 16L23.79 20.5M16 16L8.21 20.5" stroke="#fff" strokeOpacity=".7" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="16" cy="7" r="2.8" fill="#3fb950" stroke="#2a1257" strokeWidth="1" />
        <circle cx="23.79" cy="20.5" r="2.8" fill="#e3b341" stroke="#2a1257" strokeWidth="1" />
        <circle cx="8.21" cy="20.5" r="2.8" fill="#fff" stroke="#2a1257" strokeWidth="1" />
      </g>
      <path d="M16 12.2l3.3 1.9v3.8L16 19.8l-3.3-1.9v-3.8z" fill="#fff" />
    </svg>
  );
}
