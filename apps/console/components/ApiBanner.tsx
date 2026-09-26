"use client";
import { API_URL } from "@/lib/api";

/** Shown when the console cannot talk to the API, with the exact URL and reason. */
export function ApiBanner({ connected, error, className = "" }: { connected: boolean; error?: string | undefined; className?: string }) {
  if (connected || !error) return null;
  return (
    <div className={`rounded-md border border-warn/30 bg-warn/[0.06] px-4 py-3 text-sm text-warn ${className}`}>
      <div className="font-medium text-warn">The console can&apos;t reach the API.</div>
      <div className="mt-1 break-words text-warn/80">{error}</div>
      <div className="mt-2 text-xs text-warn/70">
        Check{" "}
        <a href={`${API_URL}/health`} target="_blank" rel="noreferrer" className="underline">
          {API_URL}/health
        </a>
        . It should show {"{\"ok\":true}"}.
      </div>
    </div>
  );
}
