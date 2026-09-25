// Shared sandbox types.

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxAdapter {
  readonly provider: string;
  create(pid: string): Promise<{ sandboxId: string }>;
  readFile(sandboxId: string, path: string): Promise<string>;
  writeFile(sandboxId: string, path: string, content: string): Promise<void>;
  exec(sandboxId: string, cmd: string): Promise<ExecResult>;
  destroy(sandboxId: string): Promise<void>;
  /** Sandboxes currently alive, keyed by id. Used by the console's Sandboxes view. */
  list(): { sandboxId: string; pid: string; createdAt: number }[];
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}
