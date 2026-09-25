-- KernelAgent persistence. The events table is append-only: never UPDATE or DELETE it.

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  spec_json   TEXT NOT NULL,
  status      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS processes (
  pid                  TEXT PRIMARY KEY,
  parent_pid           TEXT,
  job_id               TEXT NOT NULL,
  role                 TEXT NOT NULL,
  goal                 TEXT NOT NULL,
  status               TEXT NOT NULL,
  priority             INTEGER NOT NULL,
  enqueued_at          INTEGER,
  token_budget         INTEGER NOT NULL,
  tokens_used          INTEGER NOT NULL,
  cost_usd             REAL NOT NULL,
  sandbox_id           TEXT,
  capabilities_json    TEXT NOT NULL,
  depends_on_json      TEXT NOT NULL,
  retry_count          INTEGER NOT NULL,
  max_retries          INTEGER NOT NULL,
  last_checkpoint_seq  INTEGER,
  timeout_ms           INTEGER NOT NULL,
  runtime_ms           INTEGER NOT NULL DEFAULT 0,
  result               TEXT,
  created_at           INTEGER NOT NULL,
  started_at           INTEGER,
  completed_at         INTEGER,
  error                TEXT
);
CREATE INDEX IF NOT EXISTS processes_job ON processes(job_id);

CREATE TABLE IF NOT EXISTS events (
  sequence      INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        TEXT NOT NULL,
  pid           TEXT,
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  timestamp     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id, sequence);
CREATE INDEX IF NOT EXISTS events_pid ON events(pid, sequence);
-- Time-range scans by event type, for the metrics dashboard.
CREATE INDEX IF NOT EXISTS events_type_time ON events(type, timestamp);

-- Enforce append-only at the storage layer.
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events table is append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events table is append-only'); END;

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL,
  from_pid    TEXT NOT NULL,
  to_pid      TEXT NOT NULL,
  body_json   TEXT NOT NULL,
  delivered   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_to ON messages(to_pid, delivered, id);

-- Files a process left in its sandbox's /output directory, kept after the sandbox is destroyed.
CREATE TABLE IF NOT EXISTS artifacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL,
  pid         TEXT NOT NULL,
  path        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  data        BLOB NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_job ON artifacts(job_id, id);

-- Chat memory: notes shared by every agent and every job in one scope (a chat).
-- Not append-only: users can delete entries.
CREATE TABLE IF NOT EXISTS memories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT NOT NULL,
  job_id      TEXT NOT NULL,
  pid         TEXT,
  kind        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope, id);
