// The KernelAgent mark: a shell prompt waiting for input. A chevron and a cursor, nothing
// else. Same drawing as app/icon.svg. The cursor blinks while the logo is hovered.
export function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={`logo ${className}`} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#141416" />
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="none" stroke="#fff" strokeOpacity=".1" />
      <path d="M9.5 10.5L15 16l-5.5 5.5" fill="none" stroke="#ece8df" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect className="logo-cursor" x="17" y="19.6" width="6.5" height="2.6" rx="1.3" fill="#f0b44c" />
    </svg>
  );
}
