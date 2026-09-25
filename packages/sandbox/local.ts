// LocalSandbox: DEVELOPMENT ONLY. NOT A SECURITY BOUNDARY.
//
// Each sandbox is a scoped temp directory on the host. File paths are resolved inside
// that directory and cannot escape it, and exec runs with its working directory pinned
// there. But exec runs a real host shell as the kernel's user: a command can still read
// or write anything that user can. Use E2BSandbox (SANDBOX_PROVIDER=e2b) for isolation.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { SandboxError, type ExecResult, type SandboxAdapter } from "./types.ts";

export interface LocalSandboxOptions {
  root?: string;
  execTimeoutMs?: number;
  maxOutputBytes?: number;
}

interface Box {
  dir: string;
  pid: string;
  createdAt: number;
}

export class LocalSandbox implements SandboxAdapter {
  readonly provider = "local";
  private boxes = new Map<string, Box>();
  private root: string;
  private execTimeoutMs: number;
  private maxOutputBytes: number;
  private counter = 0;

  constructor(opts: LocalSandboxOptions = {}) {
    this.root = opts.root ?? tmpdir();
    this.execTimeoutMs = opts.execTimeoutMs ?? 30_000;
    this.maxOutputBytes = opts.maxOutputBytes ?? 64 * 1024;
  }

  async create(pid: string): Promise<{ sandboxId: string }> {
    const dir = mkdtempSync(join(this.root, `kernelagent-${pid}-`));
    const sandboxId = `sbx_${pid}_${++this.counter}`;
    this.boxes.set(sandboxId, { dir, pid, createdAt: Date.now() });
    return { sandboxId };
  }

  private box(sandboxId: string): Box {
    const b = this.boxes.get(sandboxId);
    if (!b) throw new SandboxError(`no such sandbox: ${sandboxId}`);
    return b;
  }

  /** Resolve a sandbox-relative path. "/foo" means "<sandbox>/foo". Rejects escapes. */
  resolvePath(sandboxId: string, path: string): string {
    const { dir } = this.box(sandboxId);
    const full = resolve(dir, "." + (path.startsWith("/") ? path : "/" + path));
    const rel = relative(dir, full);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new SandboxError(`path escapes sandbox: ${path}`);
    return full;
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    try {
      return await readFile(this.resolvePath(sandboxId, path), "utf8");
    } catch (err) {
      if (err instanceof SandboxError) throw err;
      throw new SandboxError(`cannot read ${path}: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
    }
  }

  async writeFile(sandboxId: string, path: string, content: string): Promise<void> {
    const full = this.resolvePath(sandboxId, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  exec(sandboxId: string, cmd: string): Promise<ExecResult> {
    const { dir } = this.box(sandboxId);
    return new Promise((resolvePromise) => {
      const child = spawn("sh", ["-c", cmd], {
        cwd: dir,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, TMPDIR: dir, LANG: "C.UTF-8" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const cap = (s: string, chunk: Buffer) => (s.length < this.maxOutputBytes ? (s + chunk.toString("utf8")).slice(0, this.maxOutputBytes) : s);
      child.stdout.on("data", (c: Buffer) => (stdout = cap(stdout, c)));
      child.stderr.on("data", (c: Buffer) => (stderr = cap(stderr, c)));
      const timer = setTimeout(() => {
        stderr += `\n[sandbox] killed after ${this.execTimeoutMs}ms`;
        child.kill("SIGKILL");
      }, this.execTimeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolvePromise({ stdout, stderr: stderr + String(err), exitCode: 127 });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolvePromise({ stdout, stderr, exitCode: code ?? (signal ? 137 : 1) });
      });
    });
  }

  async destroy(sandboxId: string): Promise<void> {
    const b = this.boxes.get(sandboxId);
    if (!b) return;
    this.boxes.delete(sandboxId);
    rmSync(b.dir, { recursive: true, force: true });
  }

  list(): { sandboxId: string; pid: string; createdAt: number }[] {
    return [...this.boxes].map(([sandboxId, b]) => ({ sandboxId, pid: b.pid, createdAt: b.createdAt }));
  }
}
