// Permission presets shown in the New Job panel and the chat's Advanced options.
export const PERMISSIONS = [
  { key: "files", label: "Read and write files", caps: [{ type: "FS_READ" }, { type: "FS_WRITE" }] },
  { key: "exec", label: "Run shell commands", caps: [{ type: "EXEC" }] },
  { key: "spawn", label: "Start sub-agents", caps: [{ type: "SPAWN" }] },
  { key: "ipc", label: "Send and receive messages", caps: [{ type: "SEND" }, { type: "RECEIVE" }] },
] as const;

export type PermKey = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMS: Record<PermKey, boolean> = { files: true, exec: true, spawn: true, ipc: true };

/** Turn checkbox state into a capability list. `approval` gates EXEC behind the operator. */
export function buildCapabilities(perms: Record<PermKey, boolean>, approval: boolean) {
  return PERMISSIONS.filter((p) => perms[p.key]).flatMap((p) =>
    p.caps.map((c) => (c.type === "EXEC" && approval ? { ...c, requiresApproval: true } : { ...c })),
  );
}
