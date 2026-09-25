"use client";
// Time-series chart in plain SVG: stacked bars, bars, or lines on one y-axis.
// A crosshair snaps to the nearest bucket and one tooltip lists every series there.
import { useEffect, useRef, useState } from "react";

export interface Series {
  key: string;
  label: string;
  /** A CSS color, usually var(--series-n) or var(--status-x). */
  color: string;
  /** One value per bucket. NaN means no data: lines leave a gap there. */
  values: number[];
}

export type ChartKind = "stacked" | "lines";

const PAD = { top: 8, right: 8, bottom: 22, left: 48 };

/** 0 plus up to 4 round ticks covering max. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

export function timeLabel(t: number, spanMs: number, seconds = false): string {
  const d = new Date(t);
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });
  if (spanMs <= 24 * 3600_000) return hm;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hm}`;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function TimeChart({
  times,
  bucketMs,
  series,
  kind,
  format,
  height = 180,
}: {
  times: number[];
  bucketMs: number;
  series: Series[];
  kind: ChartKind;
  format: (n: number) => string;
  height?: number;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const n = times.length;
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, n);

  const tops = times.map((_, i) =>
    kind === "stacked" ? series.reduce((s, x) => s + (x.values[i] || 0), 0) : Math.max(0, ...series.map((x) => x.values[i] || 0)),
  );
  const ticks = niceTicks(Math.max(0, ...tops));
  const yMax = ticks[ticks.length - 1]!;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const xCenter = (i: number) => PAD.left + i * slot + slot / 2;
  const span = n * bucketMs;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 90))));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - PAD.left) / slot);
    setHover(i >= 0 && i < n ? i : undefined);
  };

  const barW = Math.max(1, slot - 2); // 2px surface gap between adjacent bars

  return (
    <div ref={box} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(undefined)}
          className="block touch-none select-none"
          role="img"
          aria-label={series.map((s) => s.label).join(", ")}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t) + 0.5} y2={y(t) + 0.5} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-term-dim font-mono text-[10px] tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
          {times.map((t, i) =>
            i % labelEvery === 0 ? (
              <text key={t} x={xCenter(i)} y={height - 6} textAnchor="middle" className="fill-term-dim font-mono text-[10px] tabular-nums">
                {timeLabel(t, span)}
              </text>
            ) : null,
          )}

          {kind === "stacked" &&
            times.map((_, i) => {
              let base = 0;
              const segs = series.map((s) => {
                const v = s.values[i] ?? 0;
                const y0 = y(base);
                base += v;
                const y1 = y(base);
                return { s, v, y0, y1 };
              });
              const visible = segs.filter((g) => g.v > 0);
              return (
                <g key={i} opacity={hover === undefined || hover === i ? 1 : 0.55}>
                  {visible.map((g, j) => {
                    const top = j === visible.length - 1;
                    // 1px surface gap between stacked segments, rounded data end on top.
                    const h = Math.max(1, g.y0 - g.y1 - (top ? 0 : 1));
                    return <rect key={g.s.key} x={PAD.left + i * slot + 1} y={g.y1 + (top ? 0 : 1)} width={barW} height={h} rx={top ? Math.min(2, barW / 2) : 0} fill={g.s.color} />;
                  })}
                </g>
              );
            })}

          {kind === "lines" &&
            series.map((s) => {
              // Break the line where a bucket has no data, instead of dropping it to zero.
              const runs: number[][] = [];
              s.values.forEach((v, i) => {
                if (!Number.isFinite(v)) return;
                const run = runs[runs.length - 1];
                if (run && run[run.length - 1] === i - 1) run.push(i);
                else runs.push([i]);
              });
              return (
                <g key={s.key}>
                  {runs.map((run) =>
                    run.length === 1 ? (
                      <circle key={run[0]} cx={xCenter(run[0]!)} cy={y(s.values[run[0]!]!)} r={3} fill={s.color} />
                    ) : (
                      <polyline
                        key={run[0]}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={run.map((i) => `${xCenter(i)},${y(s.values[i]!)}`).join(" ")}
                      />
                    ),
                  )}
                </g>
              );
            })}

          {hover !== undefined && (
            <g pointerEvents="none">
              <line x1={xCenter(hover) + 0.5} x2={xCenter(hover) + 0.5} y1={PAD.top} y2={PAD.top + plotH} stroke="rgba(255,255,255,0.35)" />
              {kind === "lines" &&
                series.map((s) =>
                  Number.isFinite(s.values[hover]) ? (
                    <circle key={s.key} cx={xCenter(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="#121519" strokeWidth={2} />
                  ) : null,
                )}
            </g>
          )}
        </svg>
      )}

      {hover !== undefined && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-lg border border-white/15 bg-[#0d1116]/95 px-3 py-2 shadow-xl"
          style={xCenter(hover) > width / 2 ? { right: width - xCenter(hover) + 12 } : { left: xCenter(hover) + 12 }}
        >
          <div className="mb-1 font-mono text-[10px] text-term-dim">
            {timeLabel(times[hover]!, span, bucketMs < 60_000)} – {timeLabel(times[hover]! + bucketMs, span, bucketMs < 60_000)}
          </div>
          {[...series].reverse().map((s) => (
            <div key={s.key} className="flex items-center gap-2 py-0.5 text-xs">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
              <span className="font-mono font-semibold tabular-nums">{Number.isFinite(s.values[hover]) ? format(s.values[hover]!) : "no data"}</span>
              <span className="text-term-dim">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Legend for two or more series. Mirrors the mark: a box for bars, a line for lines. */
export function Legend({ series, kind }: { series: Series[]; kind: ChartKind }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-term-dim">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className={kind === "lines" ? "h-0.5 w-3 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"} style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** A chart card: title, legend, chart, and a table view of the same buckets. */
export function ChartCard({
  title,
  subtitle,
  times,
  bucketMs,
  series,
  kind,
  format,
  dim,
}: {
  title: string;
  subtitle?: string;
  times: number[];
  bucketMs: number;
  series: Series[];
  kind: ChartKind;
  format: (n: number) => string;
  dim?: boolean;
}) {
  const [table, setTable] = useState(false);
  const span = times.length * bucketMs;
  const rows = times.map((t, i) => ({ t, vals: series.map((s) => s.values[i] ?? 0) })).filter((r) => r.vals.some((v) => v > 0));
  const cell = (v: number) => (Number.isFinite(v) ? format(v) : "–");
  return (
    <section className={`card flex min-w-0 flex-col p-5 transition-opacity ${dim ? "opacity-60" : ""}`}>
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-term-dim">{subtitle}</p>}
        </div>
        <button onClick={() => setTable(!table)} className={`pill px-3 py-0.5 text-[11px] ${table ? "pill-light" : "pill-ghost"}`}>
          {table ? "Chart" : "Table"}
        </button>
      </div>
      {!table && (
        <div className="mb-2">
          <Legend series={series} kind={kind} />
        </div>
      )}
      {table ? (
        <div className="max-h-[200px] overflow-auto">
          {rows.length === 0 ? (
            <div className="py-8 text-center text-xs text-term-dim">No data in this range.</div>
          ) : (
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-[#121519] text-left text-term-dim">
                <tr>
                  <th className="py-1 pr-3 font-normal">Time</th>
                  {series.map((s) => (
                    <th key={s.key} className="py-1 pr-3 text-right font-normal">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {rows.map((r) => (
                  <tr key={r.t} className="border-t border-white/5">
                    <td className="py-1 pr-3 text-term-dim">{timeLabel(r.t, span, bucketMs < 60_000)}</td>
                    {r.vals.map((v, j) => (
                      <td key={j} className="py-1 pr-3 text-right">
                        {cell(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <TimeChart times={times} bucketMs={bucketMs} series={series} kind={kind} format={format} />
      )}
    </section>
  );
}
