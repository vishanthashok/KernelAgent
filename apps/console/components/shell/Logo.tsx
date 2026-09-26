// The KernelAgent mark: a K drawn as a process tree. The stem is the kernel, the junction
// is where it spawns, and the arms end in child processes. Same drawing as app/icon.svg.
// On hover the arms redraw outward from the junction, like the kernel spawning processes.
export function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={`logo ${className}`} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#0d1014" />
      <rect x=".5" y=".5" width="31" height="31" rx="6.5" fill="none" stroke="#fff" strokeOpacity=".08" />
      <g stroke="#b4ff39" strokeWidth="3.4" strokeLinecap="round" fill="none">
        <path d="M11 6.5V25.5" />
        <path className="logo-arm" d="M11 16L21.5 8.5" pathLength={1} />
        <path className="logo-arm" d="M11 16L21.5 23.5" pathLength={1} />
      </g>
      <g fill="#b4ff39">
        <circle cx="11" cy="16" r="3.2" />
        <circle className="logo-node" cx="21.5" cy="8.5" r="3" />
        <circle className="logo-node" cx="21.5" cy="23.5" r="3" />
      </g>
    </svg>
  );
}
