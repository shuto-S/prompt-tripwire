import type { DatabaseSync } from "node:sqlite";

const BOOTSTRAP = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT;
`;

const MIGRATIONS = [
  `
  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 0),
    snapshot_hash TEXT,
    task_hash TEXT NOT NULL,
    active_contract_id TEXT,
    blocking_decision_ids_json TEXT NOT NULL,
    last_error_code TEXT,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    retain_until TEXT,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
  ) STRICT;

  CREATE INDEX runs_state_idx ON runs(state);
  CREATE INDEX runs_retention_idx ON runs(retain_until, pinned);

  CREATE TABLE snapshots (
    snapshot_hash TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE run_snapshots (
    run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
    snapshot_hash TEXT NOT NULL REFERENCES snapshots(snapshot_hash)
  ) STRICT;

  CREATE TABLE contracts (
    contract_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version > 0),
    content_hash TEXT NOT NULL,
    approved_at TEXT,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, version)
  ) STRICT;

  CREATE TABLE idempotency_keys (
    idempotency_key TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE events (
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL UNIQUE REFERENCES idempotency_keys(idempotency_key),
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    run_version_after INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX events_run_idx ON events(run_id, occurred_at, event_id);

  CREATE TABLE artifacts (
    artifact_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
    created_at TEXT NOT NULL,
    UNIQUE(run_id, kind, content_hash)
  ) STRICT;

  CREATE TABLE reports (
    run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
    record_json TEXT NOT NULL,
    json_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
    markdown_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE worktrees (
    worktree_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('probe', 'execution')),
    path TEXT NOT NULL,
    branch TEXT,
    snapshot_hash TEXT NOT NULL,
    cleanup_status TEXT NOT NULL DEFAULT 'pending' CHECK (cleanup_status IN ('pending', 'removed', 'failed')),
    cleanup_error_code TEXT,
    created_at TEXT NOT NULL,
    cleaned_at TEXT
  ) STRICT;

  CREATE TABLE structured_logs (
    log_id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(run_id) ON DELETE CASCADE,
    level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
    event_type TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  `,
  `
  CREATE TABLE probe_runs (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    probe_id TEXT NOT NULL,
    attempt INTEGER NOT NULL CHECK (attempt > 0),
    thread_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('completed', 'failed', 'timed_out', 'cancelled')),
    error_code TEXT,
    worktree_id TEXT REFERENCES worktrees(worktree_id),
    created_at TEXT NOT NULL,
    PRIMARY KEY(run_id, probe_id, attempt)
  ) STRICT;

  CREATE TABLE plan_artifacts (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    probe_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL REFERENCES snapshots(snapshot_hash),
    task_hash TEXT NOT NULL,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(run_id, probe_id)
  ) STRICT;

  CREATE TABLE comparison_candidates (
    comparison_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id) ON DELETE CASCADE,
    snapshot_hash TEXT NOT NULL REFERENCES snapshots(snapshot_hash),
    task_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE comparator_attempts (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL CHECK (attempt > 0),
    comparison_id TEXT REFERENCES comparison_candidates(comparison_id),
    state TEXT NOT NULL CHECK (state IN ('completed', 'failed', 'refused', 'timed_out', 'cancelled')),
    response_id TEXT,
    model TEXT NOT NULL,
    error_code TEXT,
    usage_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(run_id, attempt)
  ) STRICT;

  CREATE TABLE decision_points (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    decision_id TEXT NOT NULL,
    comparison_id TEXT NOT NULL REFERENCES comparison_candidates(comparison_id),
    status TEXT NOT NULL CHECK (status IN ('unresolved', 'resolved', 'deferred')),
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(run_id, decision_id)
  ) STRICT;

  CREATE TABLE human_decisions (
    run_id TEXT NOT NULL,
    decision_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE REFERENCES idempotency_keys(idempotency_key),
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(run_id, decision_id),
    FOREIGN KEY(run_id, decision_id) REFERENCES decision_points(run_id, decision_id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX probe_runs_run_idx ON probe_runs(run_id, probe_id, attempt);
  CREATE INDEX decision_points_run_status_idx ON decision_points(run_id, status, decision_id);
  `,
  `
  CREATE TABLE execution_runs (
    execution_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    thread_id TEXT,
    contract_id TEXT NOT NULL REFERENCES contracts(contract_id),
    state TEXT NOT NULL CHECK (state IN ('not_started', 'starting', 'running', 'pausing', 'paused', 'completed', 'failed', 'cancelled')),
    worktree_id TEXT NOT NULL UNIQUE REFERENCES worktrees(worktree_id),
    last_error_code TEXT,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE deviations (
    deviation_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    execution_id TEXT NOT NULL REFERENCES execution_runs(execution_id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('observed', 'pausing', 'paused', 'rejected', 'amendment_required', 'resolved')),
    category TEXT NOT NULL,
    contract_clause TEXT NOT NULL,
    evidence_refs_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    record_json TEXT NOT NULL
  ) STRICT;

  CREATE INDEX execution_runs_run_idx ON execution_runs(run_id, created_at, execution_id);
  CREATE INDEX deviations_run_idx ON deviations(run_id, observed_at, deviation_id);
  `,
] as const;

export function migrate(database: DatabaseSync, appliedAt: string): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(BOOTSTRAP);
    const rows = database.prepare("SELECT version FROM schema_migrations").all() as Array<{
      version: number;
    }>;
    const applied = new Set(rows.map((row) => row.version));
    for (const [index, sql] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (applied.has(version)) continue;
      database.exec(sql);
      database
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(version, appliedAt);
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
