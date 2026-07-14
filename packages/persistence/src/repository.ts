import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  approveExecutionContract,
  canonicalHash,
  ExecutionContractSchema,
  renderRunReportMarkdown,
  RepositorySnapshotSchema,
  RunRecordSchema,
  RunReportSchema,
  startExecution,
  transitionRun,
  verifyExecutionContract,
  verifyRepositorySnapshot,
  type ExecutionContract,
  type RepositorySnapshot,
  type RunRecord,
  type RunReport,
  type RunState,
} from "@prompt-tripwire/domain";
import { sanitizeForExport } from "@prompt-tripwire/policy";

import { PrivateArtifactStore, type ArtifactWrite } from "./artifacts.js";
import { PersistenceError } from "./errors.js";
import { migrate } from "./migrations.js";
import { assertSupportedSqliteRuntime } from "./runtime.js";
import type {
  ApprovalInput,
  ApprovalResult,
  ArtifactMetadata,
  IngestEventInput,
  PersistedRun,
  PersistedWorktree,
  PersistenceOptions,
  StartExecutionPersistenceInput,
  StartExecutionPersistenceResult,
  StoredEvent,
  StoredReport,
  StructuredLog,
  WorktreeCleanupInput,
  WorktreeRecordInput,
} from "./types.js";

interface RunRow {
  readonly record_json: string;
  readonly created_at: string;
  readonly retain_until: string | null;
  readonly pinned: number;
}

interface ContractRow {
  readonly record_json: string;
}

interface IdempotencyRow {
  readonly operation: string;
  readonly request_hash: string;
  readonly result_json: string;
}

interface EventRow {
  readonly event_id: string;
  readonly run_id: string;
  readonly event_type: string;
  readonly payload_json: string;
  readonly occurred_at: string;
  readonly run_version_after: number;
}

interface ArtifactRow {
  readonly artifact_id: string;
  readonly run_id: string;
  readonly kind: string;
  readonly content_hash: string;
  readonly relative_path: string;
  readonly byte_count: number;
  readonly created_at: string;
}

interface LogRow {
  readonly log_id: string;
  readonly run_id: string | null;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event_type: string;
  readonly fields_json: string;
  readonly created_at: string;
}

const TERMINAL_RETENTION_STATES = new Set<RunState>(["completed", "failed", "cancelled"]);
const DEFAULT_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const NO_OMITTED_FINGERPRINT_KEYS = new Set<string>();

function requestFingerprint(value: unknown): string {
  return canonicalHash(value, { omitKeys: NO_OMITTED_FINGERPRINT_KEYS });
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new PersistenceError("DATABASE_CORRUPTION", `invalid ${label} JSON`, { cause: error });
  }
}

function validateIdentifier(value: string, label: string): void {
  if (value.length === 0 || value.length > 256) {
    throw new TypeError(`${label} must be between 1 and 256 characters`);
  }
}

function retentionDeadline(timestamp: string): string | null {
  const value = Date.parse(timestamp);
  return Number.isFinite(value)
    ? new Date(value + DEFAULT_RETENTION_MILLISECONDS).toISOString()
    : null;
}

function artifactMetadata(
  runId: string,
  kind: string,
  write: ArtifactWrite,
  createdAt: string,
): ArtifactMetadata {
  return {
    artifactId: `artifact_${canonicalHash({ runId, kind, contentHash: write.contentHash }).slice(0, 24)}`,
    runId,
    kind,
    contentHash: write.contentHash,
    relativePath: write.relativePath,
    byteCount: write.byteCount,
    createdAt,
  };
}

function rowToArtifact(row: ArtifactRow): ArtifactMetadata {
  return {
    artifactId: row.artifact_id,
    runId: row.run_id,
    kind: row.kind,
    contentHash: row.content_hash,
    relativePath: row.relative_path,
    byteCount: row.byte_count,
    createdAt: row.created_at,
  };
}

export class SqlitePersistence {
  readonly artifactStore: PrivateArtifactStore;
  readonly databasePath: string;
  private readonly database: DatabaseSync;
  private readonly now: () => string;
  private closed = false;

  constructor(options: PersistenceOptions) {
    assertSupportedSqliteRuntime();
    this.databasePath = resolve(options.databasePath);
    this.now = options.now ?? (() => new Date().toISOString());
    mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.databasePath), 0o700);
    this.artifactStore = new PrivateArtifactStore(options.artifactRoot);
    this.database = new DatabaseSync(this.databasePath, {
      allowExtension: false,
      defensive: true,
      timeout: 5_000,
    });
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA trusted_schema = OFF");
    this.database.exec("PRAGMA synchronous = FULL");
    this.database.exec("PRAGMA journal_mode = WAL");
    migrate(this.database, this.now());
    this.hardenDatabaseFiles();
  }

  close(): void {
    if (this.closed) return;
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.database.close();
    this.closed = true;
    this.hardenDatabaseFiles();
  }

  createRun(run: RunRecord, createdAt = this.now()): PersistedRun {
    const parsed = RunRecordSchema.parse(run);
    const retainUntil = TERMINAL_RETENTION_STATES.has(parsed.state)
      ? retentionDeadline(parsed.updatedAt)
      : null;
    this.database
      .prepare(
        `INSERT INTO runs(
          run_id, state, version, snapshot_hash, task_hash, active_contract_id,
          blocking_decision_ids_json, last_error_code, record_json, created_at,
          updated_at, retain_until, pinned
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        parsed.runId,
        parsed.state,
        parsed.version,
        parsed.snapshotHash,
        parsed.taskHash,
        parsed.activeContractId,
        JSON.stringify(parsed.blockingDecisionIds),
        parsed.lastErrorCode,
        JSON.stringify(parsed),
        createdAt,
        parsed.updatedAt,
        retainUntil,
      );
    return { run: parsed, retention: { createdAt, retainUntil, pinned: false } };
  }

  getRun(runId: string): PersistedRun {
    validateIdentifier(runId, "runId");
    const row = this.database
      .prepare("SELECT record_json, created_at, retain_until, pinned FROM runs WHERE run_id = ?")
      .get(runId) as RunRow | undefined;
    if (!row) throw new PersistenceError("NOT_FOUND", `run ${runId} was not found`);
    return {
      run: RunRecordSchema.parse(parseJson(row.record_json, "run")),
      retention: {
        createdAt: row.created_at,
        retainUntil: row.retain_until,
        pinned: row.pinned === 1,
      },
    };
  }

  listRuns(): PersistedRun[] {
    const rows = this.database
      .prepare(
        "SELECT record_json, created_at, retain_until, pinned FROM runs ORDER BY updated_at DESC, run_id",
      )
      .all() as unknown as RunRow[];
    return rows.map((row) => ({
      run: RunRecordSchema.parse(parseJson(row.record_json, "run")),
      retention: {
        createdAt: row.created_at,
        retainUntil: row.retain_until,
        pinned: row.pinned === 1,
      },
    }));
  }

  transitionRun(
    runId: string,
    nextState: Exclude<RunState, "running">,
    expectedVersion: number,
    updatedAt = this.now(),
    lastErrorCode?: string | null,
  ): RunRecord {
    return this.transaction(() => {
      const current = this.getRun(runId).run;
      const transitioned = transitionRun(current, nextState, expectedVersion, updatedAt);
      const next =
        lastErrorCode === undefined
          ? transitioned
          : RunRecordSchema.parse({ ...transitioned, lastErrorCode });
      this.updateRun(current.version, next);
      return next;
    });
  }

  saveSnapshot(runId: string, snapshot: RepositorySnapshot): RepositorySnapshot {
    const parsed = RepositorySnapshotSchema.parse(snapshot);
    if (!verifyRepositorySnapshot(parsed)) {
      throw new PersistenceError("DATABASE_CORRUPTION", "snapshot content hash is invalid");
    }
    const run = this.getRun(runId).run;
    if (run.taskHash !== parsed.taskHash) {
      throw new PersistenceError("DATABASE_CORRUPTION", "snapshot task hash does not match run");
    }
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO snapshots(snapshot_hash, record_json, created_at) VALUES (?, ?, ?)
           ON CONFLICT(snapshot_hash) DO NOTHING`,
        )
        .run(parsed.snapshotHash, JSON.stringify(parsed), parsed.createdAt);
      this.database
        .prepare("INSERT INTO run_snapshots(run_id, snapshot_hash) VALUES (?, ?)")
        .run(runId, parsed.snapshotHash);
    });
    this.getSnapshot(parsed.snapshotHash);
    return parsed;
  }

  setBlockingDecisionsAndTransition(
    runId: string,
    blockingDecisionIds: readonly string[],
    expectedVersion: number,
    nextState: "comparing" | "needs_review",
    updatedAt = this.now(),
  ): RunRecord {
    return this.transaction(() => {
      const current = this.getRun(runId).run;
      const transitioned = transitionRun(current, nextState, expectedVersion, updatedAt);
      const next = RunRecordSchema.parse({
        ...transitioned,
        blockingDecisionIds: [...new Set(blockingDecisionIds)].sort(),
      });
      this.updateRun(current.version, next);
      return next;
    });
  }

  getSnapshot(snapshotHash: string): RepositorySnapshot {
    const row = this.database
      .prepare("SELECT record_json FROM snapshots WHERE snapshot_hash = ?")
      .get(snapshotHash) as { record_json: string } | undefined;
    if (!row) throw new PersistenceError("NOT_FOUND", `snapshot ${snapshotHash} was not found`);
    const snapshot = RepositorySnapshotSchema.parse(parseJson(row.record_json, "snapshot"));
    if (!verifyRepositorySnapshot(snapshot)) {
      throw new PersistenceError("DATABASE_CORRUPTION", "stored snapshot content hash is invalid");
    }
    return snapshot;
  }

  saveContractAndReady(
    runId: string,
    contract: ExecutionContract,
    expectedVersion: number,
    updatedAt = this.now(),
  ): RunRecord {
    const parsed = ExecutionContractSchema.parse(contract);
    if (parsed.runId !== runId || parsed.approvedAt !== null || !verifyExecutionContract(parsed)) {
      throw new PersistenceError(
        "DATABASE_CORRUPTION",
        "contract is not an unapproved contract for run",
      );
    }
    return this.transaction(() => {
      const current = this.getRun(runId).run;
      if (
        current.snapshotHash !== parsed.snapshotHash ||
        current.taskHash !== parsed.taskHash ||
        current.blockingDecisionIds.length > 0
      ) {
        throw new PersistenceError("DATABASE_CORRUPTION", "contract does not match review state");
      }
      const transitioned = transitionRun(current, "ready_for_approval", expectedVersion, updatedAt);
      const next = RunRecordSchema.parse({
        ...transitioned,
        activeContractId: parsed.contractId,
      });
      this.insertContract(parsed);
      this.updateRun(current.version, next);
      return next;
    });
  }

  getContract(contractId: string): ExecutionContract {
    validateIdentifier(contractId, "contractId");
    const row = this.database
      .prepare("SELECT record_json FROM contracts WHERE contract_id = ?")
      .get(contractId) as ContractRow | undefined;
    if (!row) throw new PersistenceError("NOT_FOUND", `contract ${contractId} was not found`);
    const contract = ExecutionContractSchema.parse(parseJson(row.record_json, "contract"));
    if (!verifyExecutionContract(contract)) {
      throw new PersistenceError("DATABASE_CORRUPTION", "stored contract content hash is invalid");
    }
    return contract;
  }

  approveContract(input: ApprovalInput): ApprovalResult {
    validateIdentifier(input.idempotencyKey, "idempotencyKey");
    const operation = "approve_contract";
    const requestHash = requestFingerprint({
      runId: input.runId,
      contractId: input.contractId,
      expectedVersion: input.expectedVersion,
    });
    return this.transaction(() => {
      const prior = this.idempotentResult(input.idempotencyKey, operation, requestHash);
      if (prior !== null) {
        const value = parseJson(prior, "approval result") as Record<string, unknown>;
        const contract = ExecutionContractSchema.parse(value.contract);
        if (!verifyExecutionContract(contract)) {
          throw new PersistenceError("DATABASE_CORRUPTION", "invalid stored approval contract");
        }
        return {
          run: RunRecordSchema.parse(value.run),
          contract,
        };
      }
      const current = this.getRun(input.runId).run;
      if (current.activeContractId !== input.contractId) {
        throw new PersistenceError("DATABASE_CORRUPTION", "contract is not active for run");
      }
      const contract = approveExecutionContract(
        this.getContract(input.contractId),
        input.approvedAt,
      );
      const next = transitionRun(current, "approved", input.expectedVersion, input.approvedAt);
      this.database
        .prepare("UPDATE contracts SET approved_at = ?, record_json = ? WHERE contract_id = ?")
        .run(input.approvedAt, JSON.stringify(contract), contract.contractId);
      this.updateRun(current.version, next);
      const result = { run: next, contract };
      this.insertIdempotency(
        input.idempotencyKey,
        operation,
        requestHash,
        JSON.stringify(result),
        input.approvedAt,
      );
      return result;
    });
  }

  startExecution(input: StartExecutionPersistenceInput): StartExecutionPersistenceResult {
    validateIdentifier(input.idempotencyKey, "idempotencyKey");
    const operation = "start_execution";
    const requestHash = requestFingerprint({
      runId: input.runId,
      contractId: input.contractId,
      snapshotHash: input.currentSnapshot.snapshotHash,
      expectedVersion: input.expectedVersion,
    });
    return this.transaction(() => {
      const prior = this.idempotentResult(input.idempotencyKey, operation, requestHash);
      if (prior !== null) {
        RunRecordSchema.parse(parseJson(prior, "execution result"));
        return { run: this.getRun(input.runId).run, replayed: true };
      }
      const current = this.getRun(input.runId).run;
      const next = startExecution({
        run: current,
        contract: this.getContract(input.contractId),
        currentSnapshot: input.currentSnapshot,
        expectedVersion: input.expectedVersion,
        updatedAt: input.startedAt,
      });
      this.updateRun(current.version, next);
      this.insertIdempotency(
        input.idempotencyKey,
        operation,
        requestHash,
        JSON.stringify(next),
        input.startedAt,
      );
      return { run: next, replayed: false };
    });
  }

  ingestEvent(input: IngestEventInput): StoredEvent {
    validateIdentifier(input.idempotencyKey, "idempotencyKey");
    if (!/^[a-z0-9_.:-]{1,128}$/u.test(input.eventType)) {
      throw new TypeError("eventType must be a stable lowercase identifier");
    }
    const sanitized = sanitizeForExport(input.payload);
    if (!sanitized.allowed) throw new PersistenceError("REDACTION_FAILED", sanitized.reason);
    const operation = "ingest_event";
    const requestHash = requestFingerprint({
      runId: input.runId,
      eventType: input.eventType,
      payload: sanitized.value,
      transition: input.transition ?? null,
    });
    return this.transaction(() => {
      const prior = this.idempotentResult(input.idempotencyKey, operation, requestHash);
      if (prior !== null) return this.parseStoredEvent(parseJson(prior, "event result"));
      const current = this.getRun(input.runId).run;
      const next =
        input.transition === undefined
          ? current
          : transitionRun(
              current,
              input.transition.nextState,
              input.transition.expectedVersion,
              input.occurredAt,
            );
      if (next !== current) this.updateRun(current.version, next);
      const event: StoredEvent = {
        eventId: `event_${canonicalHash({ key: input.idempotencyKey, requestHash }).slice(0, 24)}`,
        runId: input.runId,
        eventType: input.eventType,
        payload: sanitized.value,
        occurredAt: input.occurredAt,
        runVersionAfter: next.version,
      };
      this.insertIdempotency(
        input.idempotencyKey,
        operation,
        requestHash,
        JSON.stringify(event),
        input.occurredAt,
      );
      this.database
        .prepare(
          `INSERT INTO events(
            event_id, run_id, idempotency_key, event_type, payload_json, occurred_at, run_version_after
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.eventId,
          event.runId,
          input.idempotencyKey,
          event.eventType,
          sanitized.json,
          event.occurredAt,
          event.runVersionAfter,
        );
      return event;
    });
  }

  listEvents(runId: string): StoredEvent[] {
    const rows = this.database
      .prepare(
        `SELECT event_id, run_id, event_type, payload_json, occurred_at, run_version_after
         FROM events WHERE run_id = ? ORDER BY occurred_at, event_id`,
      )
      .all(runId) as unknown as EventRow[];
    return rows.map((row) => ({
      eventId: row.event_id,
      runId: row.run_id,
      eventType: row.event_type,
      payload: parseJson(row.payload_json, "event payload"),
      occurredAt: row.occurred_at,
      runVersionAfter: row.run_version_after,
    }));
  }

  recoverInterruptedRuns(recoveredAt = this.now()): RunRecord[] {
    return this.transaction(() => {
      const candidates = this.database
        .prepare(
          "SELECT record_json, created_at, retain_until, pinned FROM runs WHERE state IN ('running', 'pausing') ORDER BY run_id",
        )
        .all() as unknown as RunRow[];
      return candidates.map((row) => {
        const current = RunRecordSchema.parse(parseJson(row.record_json, "run"));
        const pausing =
          current.state === "running"
            ? transitionRun(current, "pausing", current.version, recoveredAt)
            : current;
        const paused = transitionRun(pausing, "paused", pausing.version, recoveredAt);
        const recovered = RunRecordSchema.parse({
          ...paused,
          lastErrorCode: "CONTROLLER_RESTART",
        });
        this.updateRun(current.version, recovered);
        return recovered;
      });
    });
  }

  setPinned(runId: string, pinned: boolean): PersistedRun {
    const result = this.database
      .prepare("UPDATE runs SET pinned = ? WHERE run_id = ?")
      .run(pinned ? 1 : 0, runId);
    if (Number(result.changes) !== 1) {
      throw new PersistenceError("NOT_FOUND", `run ${runId} was not found`);
    }
    return this.getRun(runId);
  }

  recordWorktree(input: WorktreeRecordInput): void {
    this.database
      .prepare(
        `INSERT INTO worktrees(
          worktree_id, run_id, kind, path, branch, snapshot_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.worktreeId,
        input.runId,
        input.kind,
        input.path,
        input.branch,
        input.snapshotHash,
        input.createdAt,
      );
  }

  recordWorktreeCleanup(input: WorktreeCleanupInput): void {
    const result = this.database
      .prepare(
        `UPDATE worktrees
         SET cleanup_status = ?, cleaned_at = ?, cleanup_error_code = ?
         WHERE worktree_id = ? AND cleanup_status = 'pending'`,
      )
      .run(input.status, input.cleanedAt, input.errorCode, input.worktreeId);
    if (Number(result.changes) !== 1) {
      throw new PersistenceError("NOT_FOUND", "pending worktree cleanup record was not found");
    }
  }

  getWorktree(worktreeId: string): PersistedWorktree {
    const row = this.database
      .prepare(
        `SELECT worktree_id, run_id, kind, path, branch, snapshot_hash, cleanup_status,
                cleanup_error_code, created_at, cleaned_at
         FROM worktrees WHERE worktree_id = ?`,
      )
      .get(worktreeId) as
      | {
          worktree_id: string;
          run_id: string;
          kind: "probe" | "execution";
          path: string;
          branch: string | null;
          snapshot_hash: string;
          cleanup_status: "pending" | "removed" | "failed";
          cleanup_error_code: string | null;
          created_at: string;
          cleaned_at: string | null;
        }
      | undefined;
    if (!row) throw new PersistenceError("NOT_FOUND", `worktree ${worktreeId} was not found`);
    return {
      worktreeId: row.worktree_id,
      runId: row.run_id,
      kind: row.kind,
      path: row.path,
      branch: row.branch,
      snapshotHash: row.snapshot_hash,
      createdAt: row.created_at,
      cleanupStatus: row.cleanup_status,
      cleanupErrorCode: row.cleanup_error_code,
      cleanedAt: row.cleaned_at,
    };
  }

  recordLog(
    level: "debug" | "info" | "warn" | "error",
    eventType: string,
    fields: unknown,
    runId: string | null = null,
    createdAt = this.now(),
  ): string {
    if (!/^[a-z0-9_.:-]{1,128}$/u.test(eventType)) {
      throw new TypeError("eventType must be a stable lowercase identifier");
    }
    const sanitized = sanitizeForExport(fields);
    if (!sanitized.allowed) throw new PersistenceError("REDACTION_FAILED", sanitized.reason);
    const logId = `log_${randomUUID()}`;
    this.database
      .prepare(
        `INSERT INTO structured_logs(log_id, run_id, level, event_type, fields_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(logId, runId, level, eventType, sanitized.json, createdAt);
    return logId;
  }

  listLogs(runId?: string): StructuredLog[] {
    const statement =
      runId === undefined
        ? this.database.prepare(
            `SELECT log_id, run_id, level, event_type, fields_json, created_at
             FROM structured_logs ORDER BY created_at, log_id`,
          )
        : this.database.prepare(
            `SELECT log_id, run_id, level, event_type, fields_json, created_at
             FROM structured_logs WHERE run_id = ? ORDER BY created_at, log_id`,
          );
    const rows = (runId === undefined
      ? statement.all()
      : statement.all(runId)) as unknown as LogRow[];
    return rows.map((row) => ({
      logId: row.log_id,
      runId: row.run_id,
      level: row.level,
      eventType: row.event_type,
      fields: parseJson(row.fields_json, "structured log fields"),
      createdAt: row.created_at,
    }));
  }

  saveReport(report: RunReport): StoredReport {
    const parsed = RunReportSchema.parse(report);
    this.getRun(parsed.runId);
    const sanitized = sanitizeForExport(parsed);
    if (!sanitized.allowed) throw new PersistenceError("REDACTION_FAILED", sanitized.reason);
    const safeReport = RunReportSchema.parse(sanitized.value);
    const jsonWrite = this.artifactStore.putJson(safeReport);
    const markdownWrite = this.artifactStore.putMarkdown(renderRunReportMarkdown(safeReport));
    const jsonArtifact = artifactMetadata(
      parsed.runId,
      "run_report_json",
      jsonWrite,
      parsed.generatedAt,
    );
    const markdownArtifact = artifactMetadata(
      parsed.runId,
      "run_report_markdown",
      markdownWrite,
      parsed.generatedAt,
    );
    this.transaction(() => {
      this.upsertArtifact(jsonArtifact);
      this.upsertArtifact(markdownArtifact);
      this.database
        .prepare(
          `INSERT INTO reports(run_id, record_json, json_artifact_id, markdown_artifact_id, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             record_json = excluded.record_json,
             json_artifact_id = excluded.json_artifact_id,
             markdown_artifact_id = excluded.markdown_artifact_id,
             updated_at = excluded.updated_at`,
        )
        .run(
          parsed.runId,
          JSON.stringify(safeReport),
          jsonArtifact.artifactId,
          markdownArtifact.artifactId,
          parsed.generatedAt,
        );
    });
    return { report: safeReport, jsonArtifact, markdownArtifact };
  }

  getReport(runId: string): StoredReport {
    const row = this.database
      .prepare(
        `SELECT record_json, json_artifact_id, markdown_artifact_id
         FROM reports WHERE run_id = ?`,
      )
      .get(runId) as
      { record_json: string; json_artifact_id: string; markdown_artifact_id: string } | undefined;
    if (!row) throw new PersistenceError("NOT_FOUND", `report for run ${runId} was not found`);
    return {
      report: RunReportSchema.parse(parseJson(row.record_json, "report")),
      jsonArtifact: this.getArtifact(row.json_artifact_id),
      markdownArtifact: this.getArtifact(row.markdown_artifact_id),
    };
  }

  readArtifact(artifactId: string): Buffer {
    const metadata = this.getArtifact(artifactId);
    return this.artifactStore.read(metadata);
  }

  private getArtifact(artifactId: string): ArtifactMetadata {
    const row = this.database
      .prepare(
        `SELECT artifact_id, run_id, kind, content_hash, relative_path, byte_count, created_at
         FROM artifacts WHERE artifact_id = ?`,
      )
      .get(artifactId) as ArtifactRow | undefined;
    if (!row) throw new PersistenceError("NOT_FOUND", `artifact ${artifactId} was not found`);
    return rowToArtifact(row);
  }

  private insertContract(contract: ExecutionContract): void {
    this.database
      .prepare(
        `INSERT INTO contracts(
          contract_id, run_id, version, content_hash, approved_at, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        contract.contractId,
        contract.runId,
        contract.version,
        contract.contentHash,
        contract.approvedAt,
        JSON.stringify(contract),
        contract.createdAt,
      );
  }

  private updateRun(expectedVersion: number, run: RunRecord): void {
    const retainUntil = TERMINAL_RETENTION_STATES.has(run.state)
      ? retentionDeadline(run.updatedAt)
      : null;
    const result = this.database
      .prepare(
        `UPDATE runs SET
          state = ?, version = ?, snapshot_hash = ?, task_hash = ?, active_contract_id = ?,
          blocking_decision_ids_json = ?, last_error_code = ?, record_json = ?, updated_at = ?,
          retain_until = COALESCE(retain_until, ?)
         WHERE run_id = ? AND version = ?`,
      )
      .run(
        run.state,
        run.version,
        run.snapshotHash,
        run.taskHash,
        run.activeContractId,
        JSON.stringify(run.blockingDecisionIds),
        run.lastErrorCode,
        JSON.stringify(run),
        run.updatedAt,
        retainUntil,
        run.runId,
        expectedVersion,
      );
    if (Number(result.changes) !== 1) {
      throw new PersistenceError(
        "CONFLICTING_VERSION",
        `run ${run.runId} no longer has version ${String(expectedVersion)}`,
      );
    }
  }

  private idempotentResult(key: string, operation: string, requestHash: string): string | null {
    const row = this.database
      .prepare(
        "SELECT operation, request_hash, result_json FROM idempotency_keys WHERE idempotency_key = ?",
      )
      .get(key) as IdempotencyRow | undefined;
    if (!row) return null;
    if (row.operation !== operation || row.request_hash !== requestHash) {
      throw new PersistenceError(
        "CONFLICTING_IDEMPOTENCY_KEY",
        "idempotency key was reused for a different request",
      );
    }
    return row.result_json;
  }

  private insertIdempotency(
    key: string,
    operation: string,
    requestHash: string,
    resultJson: string,
    createdAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO idempotency_keys(
          idempotency_key, operation, request_hash, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(key, operation, requestHash, resultJson, createdAt);
  }

  private parseStoredEvent(value: unknown): StoredEvent {
    if (value === null || typeof value !== "object") {
      throw new PersistenceError("DATABASE_CORRUPTION", "invalid event result");
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.eventId !== "string" ||
      typeof record.runId !== "string" ||
      typeof record.eventType !== "string" ||
      typeof record.occurredAt !== "string" ||
      typeof record.runVersionAfter !== "number"
    ) {
      throw new PersistenceError("DATABASE_CORRUPTION", "invalid event result");
    }
    return {
      eventId: record.eventId,
      runId: record.runId,
      eventType: record.eventType,
      payload: record.payload,
      occurredAt: record.occurredAt,
      runVersionAfter: record.runVersionAfter,
    };
  }

  private upsertArtifact(metadata: ArtifactMetadata): void {
    this.database
      .prepare(
        `INSERT INTO artifacts(
          artifact_id, run_id, kind, content_hash, relative_path, byte_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(artifact_id) DO UPDATE SET
          relative_path = excluded.relative_path,
          byte_count = excluded.byte_count`,
      )
      .run(
        metadata.artifactId,
        metadata.runId,
        metadata.kind,
        metadata.contentHash,
        metadata.relativePath,
        metadata.byteCount,
        metadata.createdAt,
      );
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private hardenDatabaseFiles(): void {
    for (const path of [
      this.databasePath,
      `${this.databasePath}-wal`,
      `${this.databasePath}-shm`,
    ]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }
}
