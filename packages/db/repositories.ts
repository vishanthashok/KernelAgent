// Thin repository functions over SQLite. No ORM.
// Record shapes mirror the kernel models structurally so this package stays a leaf.
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

const SCHEMA = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

export function openDb(path = ":memory:"): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);
  return db;
}

// ---------- events ----------

export interface EventRecord {
  sequence: number;
  jobId: string;
  pid?: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface EventQuery {
  jobId?: string;
  pid?: string;
  sinceSeq?: number;
  limit?: number;
}

interface EventRow {
  sequence: number;
  job_id: string;
  pid: string | null;
  type: string;
  payload_json: string;
  timestamp: number;
}

const toEvent = (r: EventRow): EventRecord => ({
  sequence: r.sequence,
  jobId: r.job_id,
  ...(r.pid ? { pid: r.pid } : {}),
  type: r.type,
  payload: JSON.parse(r.payload_json),
  timestamp: r.timestamp,
});

export class EventRepo {
  private insert;
  constructor(private db: DB) {
    this.insert = db.prepare(
      "INSERT INTO events (job_id, pid, type, payload_json, timestamp) VALUES (?, ?, ?, ?, ?)",
    );
  }

  /** Append one event and return its assigned monotonic sequence. */
  append(e: Omit<EventRecord, "sequence">): number {
    const info = this.insert.run(e.jobId, e.pid ?? null, e.type, JSON.stringify(e.payload ?? null), e.timestamp);
    return Number(info.lastInsertRowid);
  }

  list(q: EventQuery = {}): EventRecord[] {
    const where: string[] = ["sequence > @sinceSeq"];
    if (q.jobId) where.push("job_id = @jobId");
    if (q.pid) where.push("pid = @pid");
    const sql = `SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY sequence ASC LIMIT @limit`;
    const rows = this.db.prepare(sql).all({
      sinceSeq: q.sinceSeq ?? 0,
      jobId: q.jobId,
      pid: q.pid,
      limit: q.limit ?? 1000,
    }) as EventRow[];
    return rows.map(toEvent);
  }

  get(sequence: number): EventRecord | undefined {
    const row = this.db.prepare("SELECT * FROM events WHERE sequence = ?").get(sequence) as EventRow | undefined;
    return row ? toEvent(row) : undefined;
  }

  maxSequence(): number {
    const row = this.db.prepare("SELECT MAX(sequence) AS m FROM events").get() as { m: number | null };
    return row.m ?? 0;
  }
}

// ---------- jobs ----------

export interface JobRecord {
  id: string;
  spec: unknown;
  status: string;
  createdAt: number;
}

interface JobRow {
  id: string;
  spec_json: string;
  status: string;
  created_at: number;
}

const toJob = (r: JobRow): JobRecord => ({
  id: r.id,
  spec: JSON.parse(r.spec_json),
  status: r.status,
  createdAt: r.created_at,
});

export class JobRepo {
  constructor(private db: DB) {}

  insert(j: JobRecord): void {
    this.db
      .prepare("INSERT INTO jobs (id, spec_json, status, created_at) VALUES (?, ?, ?, ?)")
      .run(j.id, JSON.stringify(j.spec), j.status, j.createdAt);
  }

  setStatus(id: string, status: string): void {
    this.db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
  }

  get(id: string): JobRecord | undefined {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return r ? toJob(r) : undefined;
  }

  list(): JobRecord[] {
    return (this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as JobRow[]).map(toJob);
  }
}

// ---------- processes ----------

export interface ProcessRecord {
  pid: string;
  parentPid?: string;
  jobId: string;
  role: string;
  goal: string;
  status: string;
  priority: number;
  enqueuedAt?: number;
  tokenBudget: number;
  tokensUsed: number;
  costUsd: number;
  sandboxId?: string;
  capabilities: unknown[];
  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  lastCheckpointSeq?: number;
  timeoutMs: number;
  runtimeMs: number;
  result?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

interface ProcessRow {
  pid: string;
  parent_pid: string | null;
  job_id: string;
  role: string;
  goal: string;
  status: string;
  priority: number;
  enqueued_at: number | null;
  token_budget: number;
  tokens_used: number;
  cost_usd: number;
  sandbox_id: string | null;
  capabilities_json: string;
  depends_on_json: string;
  retry_count: number;
  max_retries: number;
  last_checkpoint_seq: number | null;
  timeout_ms: number;
  runtime_ms: number;
  result: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
}

const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

const toProcess = (r: ProcessRow): ProcessRecord => {
  const p: ProcessRecord = {
    pid: r.pid,
    jobId: r.job_id,
    role: r.role,
    goal: r.goal,
    status: r.status,
    priority: r.priority,
    tokenBudget: r.token_budget,
    tokensUsed: r.tokens_used,
    costUsd: r.cost_usd,
    capabilities: JSON.parse(r.capabilities_json),
    dependsOn: JSON.parse(r.depends_on_json),
    retryCount: r.retry_count,
    maxRetries: r.max_retries,
    timeoutMs: r.timeout_ms,
    runtimeMs: r.runtime_ms,
    createdAt: r.created_at,
  };
  const extras: Partial<ProcessRecord> = {
    parentPid: opt(r.parent_pid),
    enqueuedAt: opt(r.enqueued_at),
    sandboxId: opt(r.sandbox_id),
    lastCheckpointSeq: opt(r.last_checkpoint_seq),
    result: opt(r.result),
    startedAt: opt(r.started_at),
    completedAt: opt(r.completed_at),
    error: opt(r.error),
  };
  for (const [k, v] of Object.entries(extras)) if (v !== undefined) (p as unknown as Record<string, unknown>)[k] = v;
  return p;
};

export interface ProcessQuery {
  jobId?: string;
  status?: string;
}

export class ProcessRepo {
  private upsertStmt;
  constructor(private db: DB) {
    this.upsertStmt = db.prepare(`
      INSERT INTO processes (pid, parent_pid, job_id, role, goal, status, priority, enqueued_at, token_budget,
        tokens_used, cost_usd, sandbox_id, capabilities_json, depends_on_json, retry_count, max_retries,
        last_checkpoint_seq, timeout_ms, runtime_ms, result, created_at, started_at, completed_at, error)
      VALUES (@pid, @parentPid, @jobId, @role, @goal, @status, @priority, @enqueuedAt, @tokenBudget,
        @tokensUsed, @costUsd, @sandboxId, @capabilities, @dependsOn, @retryCount, @maxRetries,
        @lastCheckpointSeq, @timeoutMs, @runtimeMs, @result, @createdAt, @startedAt, @completedAt, @error)
      ON CONFLICT(pid) DO UPDATE SET
        status=excluded.status, priority=excluded.priority, enqueued_at=excluded.enqueued_at,
        token_budget=excluded.token_budget, tokens_used=excluded.tokens_used, cost_usd=excluded.cost_usd,
        sandbox_id=excluded.sandbox_id, capabilities_json=excluded.capabilities_json,
        retry_count=excluded.retry_count, last_checkpoint_seq=excluded.last_checkpoint_seq,
        runtime_ms=excluded.runtime_ms, result=excluded.result, started_at=excluded.started_at,
        completed_at=excluded.completed_at, error=excluded.error`);
  }

  upsert(p: ProcessRecord): void {
    this.upsertStmt.run({
      pid: p.pid,
      parentPid: p.parentPid ?? null,
      jobId: p.jobId,
      role: p.role,
      goal: p.goal,
      status: p.status,
      priority: p.priority,
      enqueuedAt: p.enqueuedAt ?? null,
      tokenBudget: p.tokenBudget,
      tokensUsed: p.tokensUsed,
      costUsd: p.costUsd,
      sandboxId: p.sandboxId ?? null,
      capabilities: JSON.stringify(p.capabilities),
      dependsOn: JSON.stringify(p.dependsOn),
      retryCount: p.retryCount,
      maxRetries: p.maxRetries,
      lastCheckpointSeq: p.lastCheckpointSeq ?? null,
      timeoutMs: p.timeoutMs,
      runtimeMs: Math.round(p.runtimeMs),
      result: p.result ?? null,
      createdAt: p.createdAt,
      startedAt: p.startedAt ?? null,
      completedAt: p.completedAt ?? null,
      error: p.error ?? null,
    });
  }

  maxNumericPid(): number {
    const r = this.db.prepare("SELECT MAX(CAST(pid AS INTEGER)) AS m FROM processes").get() as { m: number | null };
    return r.m ?? 0;
  }

  get(pid: string): ProcessRecord | undefined {
    const r = this.db.prepare("SELECT * FROM processes WHERE pid = ?").get(pid) as ProcessRow | undefined;
    return r ? toProcess(r) : undefined;
  }

  list(q: ProcessQuery = {}): ProcessRecord[] {
    const where: string[] = [];
    if (q.jobId) where.push("job_id = @jobId");
    if (q.status) where.push("status = @status");
    const sql = `SELECT * FROM processes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at ASC, pid ASC`;
    return (this.db.prepare(sql).all({ jobId: q.jobId, status: q.status }) as ProcessRow[]).map(toProcess);
  }
}

// ---------- messages ----------

export interface MessageRecord {
  id: number;
  jobId: string;
  fromPid: string;
  toPid: string;
  body: unknown;
  delivered: boolean;
  createdAt: number;
}

interface MessageRow {
  id: number;
  job_id: string;
  from_pid: string;
  to_pid: string;
  body_json: string;
  delivered: number;
  created_at: number;
}

const toMessage = (r: MessageRow): MessageRecord => ({
  id: r.id,
  jobId: r.job_id,
  fromPid: r.from_pid,
  toPid: r.to_pid,
  body: JSON.parse(r.body_json),
  delivered: r.delivered === 1,
  createdAt: r.created_at,
});

export class MessageRepo {
  constructor(private db: DB) {}

  insert(m: Omit<MessageRecord, "id" | "delivered">): MessageRecord {
    const info = this.db
      .prepare("INSERT INTO messages (job_id, from_pid, to_pid, body_json, delivered, created_at) VALUES (?, ?, ?, ?, 0, ?)")
      .run(m.jobId, m.fromPid, m.toPid, JSON.stringify(m.body), m.createdAt);
    return { ...m, id: Number(info.lastInsertRowid), delivered: false };
  }

  /** Atomically take the oldest undelivered message for a pid and mark it delivered. */
  take(toPid: string): MessageRecord | undefined {
    const tx = this.db.transaction((pid: string) => {
      const r = this.db
        .prepare("SELECT * FROM messages WHERE to_pid = ? AND delivered = 0 ORDER BY id ASC LIMIT 1")
        .get(pid) as MessageRow | undefined;
      if (!r) return undefined;
      this.db.prepare("UPDATE messages SET delivered = 1 WHERE id = ?").run(r.id);
      return { ...toMessage(r), delivered: true };
    });
    return tx(toPid);
  }

  pendingCount(toPid: string): number {
    const r = this.db.prepare("SELECT COUNT(*) AS c FROM messages WHERE to_pid = ? AND delivered = 0").get(toPid) as { c: number };
    return r.c;
  }

  list(q: { jobId?: string; pid?: string } = {}): MessageRecord[] {
    const where: string[] = [];
    if (q.jobId) where.push("job_id = @jobId");
    if (q.pid) where.push("(from_pid = @pid OR to_pid = @pid)");
    const sql = `SELECT * FROM messages ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id ASC`;
    return (this.db.prepare(sql).all({ jobId: q.jobId, pid: q.pid }) as MessageRow[]).map(toMessage);
  }
}

// ---------- artifacts ----------

export interface ArtifactMeta {
  id: number;
  jobId: string;
  pid: string;
  path: string;
  mime: string;
  size: number;
  createdAt: number;
}

interface ArtifactRow {
  id: number;
  job_id: string;
  pid: string;
  path: string;
  mime: string;
  size: number;
  created_at: number;
  data?: Buffer;
}

const toArtifact = (r: ArtifactRow): ArtifactMeta => ({
  id: r.id,
  jobId: r.job_id,
  pid: r.pid,
  path: r.path,
  mime: r.mime,
  size: r.size,
  createdAt: r.created_at,
});

export class ArtifactRepo {
  constructor(private db: DB) {}

  insert(a: Omit<ArtifactMeta, "id" | "size">, data: Uint8Array): ArtifactMeta {
    const info = this.db
      .prepare("INSERT INTO artifacts (job_id, pid, path, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(a.jobId, a.pid, a.path, a.mime, data.byteLength, Buffer.from(data), a.createdAt);
    return { ...a, id: Number(info.lastInsertRowid), size: data.byteLength };
  }

  list(q: { jobId?: string; pid?: string } = {}): ArtifactMeta[] {
    const where: string[] = [];
    if (q.jobId) where.push("job_id = @jobId");
    if (q.pid) where.push("pid = @pid");
    const sql = `SELECT id, job_id, pid, path, mime, size, created_at FROM artifacts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id ASC`;
    return (this.db.prepare(sql).all({ jobId: q.jobId, pid: q.pid }) as ArtifactRow[]).map(toArtifact);
  }

  get(id: number): { meta: ArtifactMeta; data: Buffer } | undefined {
    const r = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
    return r ? { meta: toArtifact(r), data: r.data! } : undefined;
  }
}

/** "note" is written by an agent with REMEMBER. "turn" is the kernel's record of a finished request. */
export type MemoryKind = "note" | "turn";

export interface MemoryEntry {
  id: number;
  scope: string;
  jobId: string;
  pid?: string;
  kind: MemoryKind;
  content: string;
  createdAt: number;
}

interface MemoryRow {
  id: number;
  scope: string;
  job_id: string;
  pid: string | null;
  kind: MemoryKind;
  content: string;
  created_at: number;
}

const toMemory = (r: MemoryRow): MemoryEntry => ({
  id: r.id,
  scope: r.scope,
  jobId: r.job_id,
  ...(r.pid ? { pid: r.pid } : {}),
  kind: r.kind,
  content: r.content,
  createdAt: r.created_at,
});

export class MemoryRepo {
  constructor(private db: DB) {}

  add(m: Omit<MemoryEntry, "id">): MemoryEntry {
    const info = this.db
      .prepare("INSERT INTO memories (scope, job_id, pid, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(m.scope, m.jobId, m.pid ?? null, m.kind, m.content, m.createdAt);
    return { ...m, id: Number(info.lastInsertRowid) };
  }

  /** The newest entries of a scope, returned oldest first. */
  recent(scope: string, limit = 50): MemoryEntry[] {
    const rows = this.db.prepare("SELECT * FROM memories WHERE scope = ? ORDER BY id DESC LIMIT ?").all(scope, limit) as MemoryRow[];
    return rows.reverse().map(toMemory);
  }

  /** Entries containing every word of the query (case-insensitive), newest first. */
  search(scope: string, query: string, limit = 10): MemoryEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const where = words.map((_, i) => `AND lower(content) LIKE @w${i} ESCAPE '\\'`).join(" ");
    const params: Record<string, unknown> = { scope, limit };
    words.forEach((w, i) => (params[`w${i}`] = `%${w.replace(/[\\%_]/g, (c) => "\\" + c)}%`));
    const rows = this.db.prepare(`SELECT * FROM memories WHERE scope = @scope ${where} ORDER BY id DESC LIMIT @limit`).all(params) as MemoryRow[];
    return rows.map(toMemory);
  }

  count(scope: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM memories WHERE scope = ?").get(scope) as { n: number }).n;
  }

  /** Delete one entry. With a scope, only if the entry belongs to it. */
  delete(id: number, scope?: string): boolean {
    if (scope !== undefined) return this.db.prepare("DELETE FROM memories WHERE id = ? AND scope = ?").run(id, scope).changes > 0;
    return this.db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
  }

  clear(scope: string): number {
    return this.db.prepare("DELETE FROM memories WHERE scope = ?").run(scope).changes;
  }
}

// ---------- accounts ----------

export interface UserRecord {
  id: string;
  email: string;
  name?: string;
  image?: string;
  /** "scrypt$salt$hash", or undefined for provider-only accounts. */
  passwordHash?: string;
  createdAt: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  password_hash: string | null;
  created_at: number;
}

const toUser = (r: UserRow): UserRecord => ({
  id: r.id,
  email: r.email,
  ...(r.name ? { name: r.name } : {}),
  ...(r.image ? { image: r.image } : {}),
  ...(r.password_hash ? { passwordHash: r.password_hash } : {}),
  createdAt: r.created_at,
});

export class UserRepo {
  constructor(private db: DB) {}

  insert(u: UserRecord): UserRecord {
    this.db
      .prepare("INSERT INTO users (id, email, name, image, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(u.id, u.email, u.name ?? null, u.image ?? null, u.passwordHash ?? null, u.createdAt);
    return u;
  }

  byEmail(email: string): UserRecord | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
    return r && toUser(r);
  }

  get(id: string): UserRecord | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return r && toUser(r);
  }

  /** Fill in a name, avatar, or password the account does not have yet. */
  update(id: string, f: { name?: string; image?: string; passwordHash?: string }): void {
    this.db
      .prepare("UPDATE users SET name = COALESCE(?, name), image = COALESCE(?, image), password_hash = COALESCE(?, password_hash) WHERE id = ?")
      .run(f.name ?? null, f.image ?? null, f.passwordHash ?? null, id);
  }
}

export interface ChatRecord {
  id: string;
  data: unknown;
  updatedAt: number;
}

export class ChatRepo {
  constructor(private db: DB) {}

  list(userId: string): ChatRecord[] {
    const rows = this.db.prepare("SELECT id, data, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as {
      id: string;
      data: string;
      updated_at: number;
    }[];
    return rows.map((r) => ({ id: r.id, data: JSON.parse(r.data) as unknown, updatedAt: r.updated_at }));
  }

  put(userId: string, id: string, data: unknown, updatedAt: number): void {
    this.db
      .prepare("INSERT INTO chats (user_id, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .run(userId, id, JSON.stringify(data), updatedAt);
  }

  delete(userId: string, id: string): boolean {
    return this.db.prepare("DELETE FROM chats WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
  }

  count(userId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM chats WHERE user_id = ?").get(userId) as { n: number }).n;
  }
}

export class JobOwnerRepo {
  constructor(private db: DB) {}

  set(jobId: string, userId: string): void {
    this.db.prepare("INSERT OR REPLACE INTO job_owners (job_id, user_id) VALUES (?, ?)").run(jobId, userId);
  }

  owner(jobId: string): string | undefined {
    return (this.db.prepare("SELECT user_id FROM job_owners WHERE job_id = ?").get(jobId) as { user_id: string } | undefined)?.user_id;
  }

  jobIds(userId: string): Set<string> {
    const rows = this.db.prepare("SELECT job_id FROM job_owners WHERE user_id = ?").all(userId) as { job_id: string }[];
    return new Set(rows.map((r) => r.job_id));
  }
}

// ---------- metrics ----------

export interface LlmCallRow {
  ts: number;
  jobId: string;
  pid: string | null;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  savings: number;
  durationMs: number;
}

export interface SyscallRow {
  ts: number;
  jobId: string;
  pid: string | null;
  type: string;
  ok: boolean;
  code: string | null;
  denied: boolean;
  error: string | null;
}

export interface StateChangeRow {
  ts: number;
  jobId: string;
  pid: string | null;
  to: string;
  reason: string | null;
}

export interface CrashRow {
  ts: number;
  jobId: string;
  pid: string | null;
  error: string | null;
}

export interface JobSummaryRow {
  id: string;
  name: string | null;
  status: string;
  createdAt: number;
}

/**
 * Read-only queries for the metrics dashboard. Fields are pulled out with json_extract so
 * the large LLM request bodies never cross into JS.
 */
export class MetricsRepo {
  constructor(private db: DB) {}

  llmCalls(from: number, to: number): LlmCallRow[] {
    return this.db
      .prepare(
        `SELECT timestamp AS ts, job_id AS jobId, pid,
           coalesce(json_extract(payload_json, '$.model'), '?') AS model,
           coalesce(json_extract(payload_json, '$.inputTokens'), 0) AS input,
           coalesce(json_extract(payload_json, '$.outputTokens'), 0) AS output,
           coalesce(json_extract(payload_json, '$.cacheReadTokens'), 0) AS cacheRead,
           coalesce(json_extract(payload_json, '$.cacheWriteTokens'), 0) AS cacheWrite,
           coalesce(json_extract(payload_json, '$.costUsd'), 0) AS cost,
           coalesce(json_extract(payload_json, '$.cacheSavingsUsd'), 0) AS savings,
           coalesce(json_extract(payload_json, '$.durationMs'), 0) AS durationMs
         FROM events WHERE type = 'LLM_CALL' AND timestamp >= ? AND timestamp < ? ORDER BY timestamp`,
      )
      .all(from, to) as LlmCallRow[];
  }

  syscalls(from: number, to: number): SyscallRow[] {
    const rows = this.db
      .prepare(
        `SELECT timestamp AS ts, job_id AS jobId, pid,
           coalesce(json_extract(payload_json, '$.request.type'), '?') AS type,
           json_extract(payload_json, '$.ok') AS ok,
           json_extract(payload_json, '$.code') AS code,
           json_extract(payload_json, '$.denied') AS denied,
           substr(json_extract(payload_json, '$.error'), 1, 200) AS error
         FROM events WHERE type = 'SYSCALL' AND timestamp >= ? AND timestamp < ? ORDER BY timestamp`,
      )
      .all(from, to) as (Omit<SyscallRow, "ok" | "denied"> & { ok: number | null; denied: number | null })[];
    return rows.map((r) => ({ ...r, ok: r.ok === 1, denied: r.denied === 1 }));
  }

  /** Transitions into a terminal state: how agents ended. */
  terminalStates(from: number, to: number): StateChangeRow[] {
    return this.db
      .prepare(
        `SELECT timestamp AS ts, job_id AS jobId, pid,
           json_extract(payload_json, '$.to') AS "to",
           json_extract(payload_json, '$.reason') AS reason
         FROM events WHERE type = 'STATE_CHANGE' AND timestamp >= ? AND timestamp < ?
           AND json_extract(payload_json, '$.to') IN ('TERMINATED', 'FAILED')
         ORDER BY timestamp`,
      )
      .all(from, to) as StateChangeRow[];
  }

  crashes(from: number, to: number): CrashRow[] {
    return this.db
      .prepare(
        `SELECT timestamp AS ts, job_id AS jobId, pid,
           substr(coalesce(json_extract(payload_json, '$.error'), json_extract(payload_json, '$.reason')), 1, 200) AS error
         FROM events WHERE type = 'PROCESS_CRASH' AND timestamp >= ? AND timestamp < ? ORDER BY timestamp`,
      )
      .all(from, to) as CrashRow[];
  }

  jobs(ids: string[]): JobSummaryRow[] {
    if (ids.length === 0) return [];
    const marks = ids.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT id, json_extract(spec_json, '$.name') AS name, status, created_at AS createdAt
         FROM jobs WHERE id IN (${marks})`,
      )
      .all(...ids) as JobSummaryRow[];
  }
}

export interface Repositories {
  db: DB;
  events: EventRepo;
  jobs: JobRepo;
  processes: ProcessRepo;
  messages: MessageRepo;
  artifacts: ArtifactRepo;
  memories: MemoryRepo;
  metrics: MetricsRepo;
  users: UserRepo;
  chats: ChatRepo;
  jobOwners: JobOwnerRepo;
}

export function createRepositories(path = ":memory:"): Repositories {
  const db = openDb(path);
  return {
    db,
    events: new EventRepo(db),
    jobs: new JobRepo(db),
    processes: new ProcessRepo(db),
    messages: new MessageRepo(db),
    artifacts: new ArtifactRepo(db),
    memories: new MemoryRepo(db),
    metrics: new MetricsRepo(db),
    users: new UserRepo(db),
    chats: new ChatRepo(db),
    jobOwners: new JobOwnerRepo(db),
  };
}
