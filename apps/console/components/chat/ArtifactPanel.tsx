"use client";
// Opens a file an agent left in /output beside the chat, instead of downloading it.
// Markdown renders, PDFs and images show in place, CSV becomes a table, HTML renders in a
// sandbox with scripts off, and anything text-like shows with line numbers.
import { useEffect, useMemo, useState } from "react";
import { artifactUrl } from "@/lib/api";
import type { TurnFile } from "@/lib/chats";
import { Markdown } from "./Markdown";

type Kind = "markdown" | "pdf" | "image" | "csv" | "html" | "json" | "text" | "binary";

const TEXT_EXT = /\.(txt|log|py|ts|tsx|js|jsx|mjs|json|ya?ml|toml|sh|sql|css|scss|go|rs|java|kt|c|h|cpp|rb|php|swift|xml|ini|env|dockerfile)$/i;

export function kindOf(f: Pick<TurnFile, "path" | "mime">): Kind {
  const p = f.path.toLowerCase();
  const m = f.mime.toLowerCase();
  if (p.endsWith(".md") || p.endsWith(".markdown") || m.includes("markdown")) return "markdown";
  if (p.endsWith(".pdf") || m.includes("pdf")) return "pdf";
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(p)) return "image";
  if (p.endsWith(".csv") || m.includes("csv")) return "csv";
  if (p.endsWith(".html") || p.endsWith(".htm") || m.includes("html")) return "html";
  if (p.endsWith(".json") || m.includes("json")) return "json";
  if (m.startsWith("text/") || TEXT_EXT.test(p)) return "text";
  return "binary";
}

export const fileName = (path: string) => path.split("/").pop() ?? path;

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Split CSV into rows, honoring quoted fields. Enough for files agents write. */
function parseCsv(text: string, maxRows = 500): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

interface Loaded {
  url: string;
  text?: string;
}

export function ArtifactPanel({ files, index, onIndex, onClose }: { files: TurnFile[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const file = files[Math.min(index, files.length - 1)];
  const kind = file ? kindOf(file) : "binary";
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!file) return;
    let live = true;
    let url: string | undefined;
    setLoaded(undefined);
    setError(undefined);
    fetch(artifactUrl(file.id))
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "This file is no longer on the server." : `The server returned ${r.status}.`);
        const blob = await r.blob();
        const typed = kind === "pdf" ? new Blob([blob], { type: "application/pdf" }) : blob;
        url = URL.createObjectURL(typed);
        const text = ["markdown", "csv", "html", "json", "text"].includes(kind) ? await blob.text() : undefined;
        if (live) setLoaded({ url, ...(text !== undefined ? { text } : {}) });
      })
      .catch((err: Error) => live && setError(err.message || "Could not load the file."));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file?.id, kind]);

  const csv = useMemo(() => (kind === "csv" && loaded?.text ? parseCsv(loaded.text) : []), [kind, loaded?.text]);

  if (!file) return null;
  const name = fileName(file.path);

  return (
    <div className="flex h-full flex-col bg-term-panel">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-term-line px-4">
        <span className="rounded-[4px] border border-term-line px-1.5 py-0.5 font-mono text-[10px] text-term-dim uppercase">{name.split(".").pop()?.slice(0, 4)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">{name}</div>
          <div className="font-mono text-[10.5px] text-term-dim">{fileSize(file.size)}</div>
        </div>
        {loaded?.text !== undefined && (
          <button
            onClick={() =>
              void navigator.clipboard.writeText(loaded.text ?? "").then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              })
            }
            className="rounded-[5px] px-2 py-1 text-[12px] text-term-dim hover:bg-ink/10 hover:text-term-fg"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {loaded && (kind === "pdf" || kind === "image") && (
          <a href={loaded.url} target="_blank" rel="noreferrer" className="rounded-[5px] px-2 py-1 text-[12px] text-term-dim hover:bg-ink/10 hover:text-term-fg">
            New tab
          </a>
        )}
        {loaded && (
          <a href={loaded.url} download={name} className="rounded-[5px] px-2 py-1 text-[12px] text-term-dim hover:bg-ink/10 hover:text-term-fg">
            Download
          </a>
        )}
        <button onClick={onClose} aria-label="Close file" className="rounded-[5px] px-2 py-1 text-term-dim hover:bg-ink/10 hover:text-term-fg">
          ✕
        </button>
      </div>

      {files.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-term-line px-3 py-2">
          {files.map((f, i) => (
            <button
              key={f.id}
              onClick={() => onIndex(i)}
              className={`shrink-0 rounded-[5px] px-2.5 py-1 font-mono text-[11.5px] ${i === index ? "bg-ink/10 text-term-fg" : "text-term-dim hover:text-term-fg"}`}
            >
              {fileName(f.path)}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="p-6 text-sm text-danger">{error}</div>
        ) : !loaded ? (
          <div className="p-6 text-sm text-term-dim">Opening {name}…</div>
        ) : kind === "markdown" ? (
          <div className="px-6 py-5">
            <Markdown text={loaded.text ?? ""} />
          </div>
        ) : kind === "pdf" ? (
          <iframe src={loaded.url} title={name} className="h-full w-full border-0 bg-white" />
        ) : kind === "image" ? (
          <div className="flex min-h-full items-center justify-center p-6">
            <img src={loaded.url} alt={name} className="max-h-full max-w-full rounded-[4px]" />
          </div>
        ) : kind === "html" ? (
          <iframe srcDoc={loaded.text} sandbox="" title={name} className="h-full w-full border-0 bg-white" />
        ) : kind === "csv" ? (
          <table className="min-w-full border-collapse font-mono text-[12px]">
            <tbody>
              {csv.map((r, i) => (
                <tr key={i} className={i === 0 ? "sticky top-0 bg-term-panel-2 font-semibold" : "border-t border-term-line/60"}>
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-1.5 whitespace-nowrap">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : kind === "binary" ? (
          <div className="p-6 text-sm text-term-dim">
            This file type can&apos;t be shown here.{" "}
            <a href={loaded.url} download={name} className="text-term-fg underline">
              Download it
            </a>
            .
          </div>
        ) : (
          <Lines text={kind === "json" ? prettyJson(loaded.text ?? "") : (loaded.text ?? "")} />
        )}
      </div>
    </div>
  );
}

function prettyJson(t: string): string {
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}

function Lines({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre className="py-4 font-mono text-[12.5px] leading-[1.65]">
      {lines.map((l, i) => (
        <div key={i} className="flex">
          <span className="w-12 shrink-0 pr-4 text-right text-term-dim/50 select-none">{i + 1}</span>
          <span className="pr-4 whitespace-pre-wrap break-all">{l}</span>
        </div>
      ))}
    </pre>
  );
}
