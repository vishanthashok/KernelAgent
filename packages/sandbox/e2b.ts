// E2BSandbox: real isolation via E2B microVMs. Selected with SANDBOX_PROVIDER=e2b and E2B_API_KEY.
import { CommandExitError, Sandbox } from "@e2b/code-interpreter";
import { SandboxError, type ExecResult, type SandboxAdapter } from "./types.ts";

// Commands run and relative paths resolve inside this directory in the microVM.
const WORKDIR = "/home/user";

export class E2BSandbox implements SandboxAdapter {
  readonly provider = "e2b";
  private boxes = new Map<string, { sbx: Sandbox; pid: string; createdAt: number }>();

  constructor(
    private opts: { apiKey: string; timeoutMs?: number; execTimeoutMs?: number },
  ) {}

  async create(pid: string): Promise<{ sandboxId: string }> {
    const sbx = await Sandbox.create({ apiKey: this.opts.apiKey, timeoutMs: this.opts.timeoutMs ?? 10 * 60_000 });
    this.boxes.set(sbx.sandboxId, { sbx, pid, createdAt: Date.now() });
    return { sandboxId: sbx.sandboxId };
  }

  private sbx(id: string): Sandbox {
    const b = this.boxes.get(id);
    if (!b) throw new SandboxError(`no such sandbox: ${id}`);
    return b.sbx;
  }

  private path(p: string): string {
    return p.startsWith("/") ? p : `${WORKDIR}/${p}`;
  }

  async readFile(id: string, path: string): Promise<string> {
    return this.sbx(id).files.read(this.path(path));
  }

  async writeFile(id: string, path: string, content: string): Promise<void> {
    await this.sbx(id).files.write(this.path(path), content);
  }

  async exec(id: string, cmd: string): Promise<ExecResult> {
    try {
      const r = await this.sbx(id).commands.run(cmd, { cwd: WORKDIR, timeoutMs: this.opts.execTimeoutMs ?? 60_000 });
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
    } catch (err) {
      if (err instanceof CommandExitError) return { stdout: err.stdout, stderr: err.stderr, exitCode: err.exitCode };
      throw err;
    }
  }

  async destroy(id: string): Promise<void> {
    const b = this.boxes.get(id);
    if (!b) return;
    this.boxes.delete(id);
    await b.sbx.kill();
  }

  list(): { sandboxId: string; pid: string; createdAt: number }[] {
    return [...this.boxes].map(([sandboxId, b]) => ({ sandboxId, pid: b.pid, createdAt: b.createdAt }));
  }
}
