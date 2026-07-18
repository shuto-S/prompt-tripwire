import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  approveExecutionContract,
  canonicalHash,
  ComparisonCandidateSchema,
  DecisionPointSchema,
  DeviationRecordSchema,
  ExecutionContractSchema,
  ExecutionRecordSchema,
  HumanDecisionSchema,
  PlanArtifactSchema,
  renderRunReportMarkdown,
  RepositorySnapshotSchema,
  RunRecordSchema,
  RunReportSchema,
  startExecution,
  transitionRun,
  verifyExecutionContract,
  verifyRepositorySnapshot,
  type ExecutionContract,
  type DeviationRecord,
  type DecisionPoint,
  type ExecutionRecord,
  type HumanDecision,
  type PlanArtifact,
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
  AmendPausedContractPersistenceInput,
  ArtifactMetadata,
  CancelRunPersistenceInput,
  ComparatorAttemptRecordInput,
  DeferDecisionInput,
  DeferDecisionResult,
  FinalDecisionContractFactory,
  IngestEventInput,
  PersistedComparison,
  PersistedPlanArtifact,
  PersistedRun,
  PersistedWorktree,
  PersistenceOptions,
  ProbeRunRecordInput,
  RecordHumanDecisionInput,
  RecordHumanDecisionOutcomeInput,
  RecordHumanDecisionResult,
  ReopenReviewPersistenceInput,
  SaveComparisonInput,
  SaveDecisionPointsInput,
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

interface PlanArtifactRow {
  readonly run_id: string;
  readonly record_json: string;
  readonly created_at: string;
}

interface ComparisonRow {
  readonly comparison_id: string;
  readonly record_json: string;
  readonly model: string;
  readonly reasoning_effort: string;
  readonly created_at: string;
}

interface ComparatorAttemptRow {
  readonly attempt: number;
  readonly state: ComparatorAttemptRecordInput["state"];
  readonly response_id: string | null;
  readonly thread_id: string | null;
  readonly turn_id: string | null;
  readonly model: string;
  readonly error_code: string | null;
  readonly usage_json: string;
}

interface DecisionPointRow {
  readonly record_json: string;
}

interface ProbeRunRow {
  readonly run_id: string;
  readonly probe_id: string;
  readonly attempt: number;
  readonly thread_id: string | null;
  readonly state: ProbeRunRecordInput["state"];
  readonly error_code: string | null;
  readonly worktree_id: string | null;
  readonly created_at: string;
}

interface PreparedHumanDecision {
  readonly current: RunRecord;
  readonly resolved: DecisionPoint;
  readonly reviewRun: RunRecord;
}

const TERMINAL_RETENTION_STATES = new Set<RunState>(["completed", "failed", "cancelled"]);
const REVIEWABLE_STATES = new Set<RunState>(["needs_review", "ready_for_approval", "paused"]);
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

function sanitizeStructured(value: unknown, label: string): unknown {
  const sanitized = sanitizeForExport(value);
  if (!sanitized.allowed) {
    throw new PersistenceError("REDACTION_FAILED", `${label}: ${sanitized.reason}`);
  }
  return sanitized.value;
}

function validateComparatorAttempt(
  value: ComparatorAttemptRecordInput,
): ComparatorAttemptRecordInput {
  if (!Number.isInteger(value.attempt) || value.attempt < 1) {
    throw new TypeError("comparator attempt must be a positive integer");
  }
  if (
    !(["completed", "failed", "refused", "timed_out", "cancelled"] as const).includes(value.state)
  ) {
    throw new TypeError("invalid comparator attempt state");
  }
  if (value.model.length === 0) throw new TypeError("comparator model is required");
  if (value.threadId !== null) validateIdentifier(value.threadId, "comparator threadId");
  if (value.turnId !== null) validateIdentifier(value.turnId, "comparator turnId");
  for (const count of Object.values(value.usage)) {
    if (count !== null && (!Number.isInteger(count) || count < 0)) {
      throw new TypeError("comparator usage counts must be non-negative integers or null");
    }
  }
  return {
    attempt: value.attempt,
    state: value.state,
    responseId: value.responseId,
    threadId: value.threadId,
    turnId: value.turnId,
    model: value.model,
    errorCode: value.errorCode,
    usage: { ...value.usage },
  };
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

  claimReviewCapability(runId: string, issuedAt = this.now()): number {
    validateIdentifier(runId, "runId");
    return this.transaction(() => {
      const persisted = this.getRun(runId);
      if (persisted.retention.pinned) {
        throw new PersistenceError(
          "RUN_ARCHIVED",
          "archived runs cannot issue review capabilities",
        );
      }
      if (!REVIEWABLE_STATES.has(persisted.run.state)) {
        throw new PersistenceError("RUN_NOT_REVIEWABLE", "run cannot issue a review capability");
      }
      const row = this.database
        .prepare(
          `INSERT INTO review_capability_leases(run_id, generation, issued_at)
           VALUES (?, 1, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             generation = review_capability_leases.generation + 1,
             issued_at = excluded.issued_at
           RETURNING generation`,
        )
        .get(runId, issuedAt) as { generation: number } | undefined;
      if (row === undefined || !Number.isSafeInteger(row.generation) || row.generation < 1) {
        throw new PersistenceError(
          "DATABASE_CORRUPTION",
          "review capability generation is invalid",
        );
      }
      return row.generation;
    });
  }

  isReviewCapabilityCurrent(runId: string, generation: number): boolean {
    validateIdentifier(runId, "runId");
    this.validateReviewCapabilityGeneration(generation);
    const row = this.database
      .prepare(
        `SELECT review_capability_leases.generation AS generation
         FROM runs
         LEFT JOIN review_capability_leases USING (run_id)
         WHERE runs.run_id = ?`,
      )
      .get(runId) as { generation: number | null } | undefined;
    if (row === undefined) throw new PersistenceError("NOT_FOUND", `run ${runId} was not found`);
    return row.generation === generation;
  }

  transitionRun(
    runId: string,
    nextState: Exclude<RunState, "running">,
    expectedVersion: number,
    updatedAt = this.now(),
    lastErrorCode?: string | null,
    requireUnpinned = false,
    reviewCapabilityGeneration?: number,
  ): RunRecord {
    return this.transaction(() => {
      this.assertUnpinned(runId, requireUnpinned);
      this.assertReviewCapabilityCurrent(runId, reviewCapabilityGeneration);
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

  recordProbeRun(input: ProbeRunRecordInput): void {
    this.getRun(input.runId);
    validateIdentifier(input.probeId, "probeId");
    if (!Number.isInteger(input.attempt) || input.attempt < 1) {
      throw new TypeError("probe attempt must be a positive integer");
    }
    this.database
      .prepare(
        `INSERT INTO probe_runs(
          run_id, probe_id, attempt, thread_id, state, error_code, worktree_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.probeId,
        input.attempt,
        input.threadId,
        input.state,
        input.errorCode,
        input.worktreeId,
        input.createdAt,
      );
  }

  listProbeRuns(runId: string): ProbeRunRecordInput[] {
    this.getRun(runId);
    const rows = this.database
      .prepare(
        `SELECT run_id, probe_id, attempt, thread_id, state, error_code, worktree_id, created_at
         FROM probe_runs WHERE run_id = ? ORDER BY probe_id, attempt`,
      )
      .all(runId) as unknown as ProbeRunRow[];
    return rows.map((row) => ({
      runId: row.run_id,
      probeId: row.probe_id,
      attempt: row.attempt,
      threadId: row.thread_id,
      state: row.state,
      errorCode: row.error_code,
      worktreeId: row.worktree_id,
      createdAt: row.created_at,
    }));
  }

  savePlanArtifact(
    runId: string,
    artifact: PlanArtifact,
    createdAt = this.now(),
  ): PersistedPlanArtifact {
    const parsed = PlanArtifactSchema.parse(sanitizeStructured(artifact, "plan artifact"));
    const run = this.getRun(runId).run;
    if (run.snapshotHash !== parsed.snapshotHash || run.taskHash !== parsed.taskHash) {
      throw new PersistenceError(
        "DATABASE_CORRUPTION",
        "plan artifact does not match the run snapshot and task",
      );
    }
    this.getSnapshot(parsed.snapshotHash);
    this.database
      .prepare(
        `INSERT INTO plan_artifacts(
          run_id, probe_id, thread_id, snapshot_hash, task_hash, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        parsed.probeId,
        parsed.threadId,
        parsed.snapshotHash,
        parsed.taskHash,
        JSON.stringify(parsed),
        createdAt,
      );
    return { runId, artifact: parsed, createdAt };
  }

  listPlanArtifacts(runId: string): PersistedPlanArtifact[] {
    this.getRun(runId);
    const rows = this.database
      .prepare(
        `SELECT run_id, record_json, created_at FROM plan_artifacts
         WHERE run_id = ? ORDER BY probe_id`,
      )
      .all(runId) as unknown as PlanArtifactRow[];
    return rows.map((row) => ({
      runId: row.run_id,
      artifact: PlanArtifactSchema.parse(parseJson(row.record_json, "plan artifact")),
      createdAt: row.created_at,
    }));
  }

  saveComparison(input: SaveComparisonInput): PersistedComparison {
    const candidate = ComparisonCandidateSchema.parse(input.candidate);
    const safe = sanitizeForExport(candidate);
    if (!safe.allowed || safe.redactionCount > 0) {
      throw new PersistenceError(
        "REDACTION_FAILED",
        "comparison candidate contained secret-like or unsupported content",
      );
    }
    const run = this.getRun(input.runId).run;
    if (run.snapshotHash !== candidate.snapshotHash || run.taskHash !== candidate.taskHash) {
      throw new PersistenceError(
        "DATABASE_CORRUPTION",
        "comparison candidate does not match the run snapshot and task",
      );
    }
    const planIds = this.listPlanArtifacts(input.runId)
      .map((item) => item.artifact.probeId)
      .sort();
    if (canonicalHash(planIds) !== canonicalHash([...candidate.planIds].sort())) {
      throw new PersistenceError(
        "DATABASE_CORRUPTION",
        "comparison candidate does not reference every persisted plan",
      );
    }
    if (input.model.length === 0 || input.reasoningEffort.length === 0) {
      throw new TypeError("comparator model and reasoning effort are required");
    }
    const attempts = input.attempts.map(validateComparatorAttempt);
    if (
      attempts.length === 0 ||
      new Set(attempts.map((item) => item.attempt)).size !== attempts.length
    ) {
      throw new TypeError("comparison attempts must be non-empty and unique");
    }
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO comparison_candidates(
            comparison_id, run_id, snapshot_hash, task_hash, model, reasoning_effort,
            record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          candidate.comparisonId,
          input.runId,
          candidate.snapshotHash,
          candidate.taskHash,
          input.model,
          input.reasoningEffort,
          JSON.stringify(candidate),
          input.createdAt,
        );
      const statement = this.database.prepare(
        `INSERT INTO comparator_attempts(
          run_id, attempt, comparison_id, state, response_id, thread_id, turn_id,
          model, error_code, usage_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const attempt of attempts) {
        statement.run(
          input.runId,
          attempt.attempt,
          candidate.comparisonId,
          attempt.state,
          attempt.responseId,
          attempt.threadId,
          attempt.turnId,
          attempt.model,
          attempt.errorCode,
          JSON.stringify(attempt.usage),
          input.createdAt,
        );
      }
    });
    return {
      candidate,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      attempts,
      createdAt: input.createdAt,
    };
  }

  getComparison(runId: string): PersistedComparison {
    this.getRun(runId);
    const row = this.database
      .prepare(
        `SELECT comparison_id, record_json, model, reasoning_effort, created_at
         FROM comparison_candidates WHERE run_id = ?`,
      )
      .get(runId) as ComparisonRow | undefined;
    if (!row) throw new PersistenceError("NOT_FOUND", `comparison for run ${runId} was not found`);
    const attempts = this.database
      .prepare(
        `SELECT attempt, state, response_id, thread_id, turn_id, model, error_code, usage_json
         FROM comparator_attempts WHERE run_id = ? ORDER BY attempt`,
      )
      .all(runId) as unknown as ComparatorAttemptRow[];
    return {
      candidate: ComparisonCandidateSchema.parse(parseJson(row.record_json, "comparison")),
      model: row.model,
      reasoningEffort: row.reasoning_effort,
      attempts: attempts.map((attempt) =>
        validateComparatorAttempt({
          attempt: attempt.attempt,
          state: attempt.state,
          responseId: attempt.response_id,
          threadId: attempt.thread_id,
          turnId: attempt.turn_id,
          model: attempt.model,
          errorCode: attempt.error_code,
          usage: parseJson(
            attempt.usage_json,
            "comparator usage",
          ) as ComparatorAttemptRecordInput["usage"],
        }),
      ),
      createdAt: row.created_at,
    };
  }

  saveDecisionPoints(input: SaveDecisionPointsInput): DecisionPoint[] {
    const comparison = this.getComparison(input.runId);
    if (comparison.candidate.comparisonId !== input.comparisonId) {
      throw new PersistenceError("DATABASE_CORRUPTION", "decisions reference another comparison");
    }
    const decisions = input.decisions.map((decision) =>
      DecisionPointSchema.parse(sanitizeStructured(decision, "decision point")),
    );
    if (new Set(decisions.map((decision) => decision.decisionId)).size !== decisions.length) {
      throw new TypeError("decision IDs must be unique");
    }
    this.transaction(() => {
      const statement = this.database.prepare(
        `INSERT INTO decision_points(
          run_id, decision_id, comparison_id, status, record_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const decision of decisions) {
        statement.run(
          input.runId,
          decision.decisionId,
          input.comparisonId,
          decision.status,
          JSON.stringify(decision),
          input.createdAt,
          input.createdAt,
        );
      }
    });
    return decisions;
  }

  listDecisionPoints(runId: string): DecisionPoint[] {
    this.getRun(runId);
    const rows = this.database
      .prepare(
        `SELECT record_json FROM decision_points
         WHERE run_id = ? ORDER BY decision_id`,
      )
      .all(runId) as unknown as DecisionPointRow[];
    return rows.map((row) =>
      DecisionPointSchema.parse(parseJson(row.record_json, "decision point")),
    );
  }

  recordHumanDecision(input: RecordHumanDecisionInput): RecordHumanDecisionResult {
    return this.recordHumanDecisionOutcome({ ...input, outcome: "review_only" });
  }

  recordHumanDecisionOutcome(
    input: RecordHumanDecisionOutcomeInput,
    createContract?: FinalDecisionContractFactory,
  ): RecordHumanDecisionResult {
    validateIdentifier(input.idempotencyKey, "idempotencyKey");
    if (!(["review_only", "ready_with_contract", "cancelled"] as const).includes(input.outcome)) {
      throw new TypeError("human decision outcome is invalid");
    }
    const humanDecision = HumanDecisionSchema.parse(
      sanitizeStructured(input.decision, "human decision"),
    );
    const operation = "record_human_decision";
    const requestHash = requestFingerprint({
      runId: input.runId,
      decision: {
        decisionId: humanDecision.decisionId,
        selectedOptionId: humanDecision.selectedOptionId,
        freeformOverride: humanDecision.freeformOverride,
        rationale: humanDecision.rationale,
        expectedRunVersion: humanDecision.expectedRunVersion,
      },
    });
    return this.transaction(() => {
      this.assertUnpinned(input.runId, input.requireUnpinned === true);
      this.assertReviewCapabilityCurrent(input.runId, input.reviewCapabilityGeneration);
      const prior = this.idempotentResult(input.idempotencyKey, operation, requestHash);
      if (prior !== null)
        return this.parseHumanDecisionResult(parseJson(prior, "human decision result"));
      const prepared = this.prepareHumanDecision(input.runId, humanDecision);
      let contract: ExecutionContract | null = null;
      let run = prepared.reviewRun;
      if (input.outcome === "ready_with_contract") {
        if (
          prepared.current.blockingDecisionIds.length !== 1 ||
          prepared.current.blockingDecisionIds[0] !== humanDecision.decisionId ||
          prepared.reviewRun.blockingDecisionIds.length !== 0
        ) {
          throw new PersistenceError(
            "CONFLICTING_VERSION",
            "the selected decision is not the final blocking decision",
          );
        }
        if (createContract === undefined) {
          throw new TypeError("ready_with_contract requires a contract factory");
        }
        const decisions = this.listDecisionPoints(input.runId).map((decision) =>
          decision.decisionId === prepared.resolved.decisionId ? prepared.resolved : decision,
        );
        const humanDecisions = [...this.listHumanDecisions(input.runId), humanDecision].sort(
          (left, right) => left.decisionId.localeCompare(right.decisionId),
        );
        if (
          decisions.some((decision) => decision.status !== "resolved") ||
          decisions.some(
            (decision) =>
              !humanDecisions.some(
                (humanDecisionEntry) => humanDecisionEntry.decisionId === decision.decisionId,
              ),
          )
        ) {
          throw new PersistenceError(
            "DATABASE_CORRUPTION",
            "final review state does not contain one answer for every decision",
          );
        }
        const nextContractVersion = this.nextContractVersion(input.runId);
        contract = ExecutionContractSchema.parse(
          createContract({
            run: prepared.reviewRun,
            decisions,
            humanDecisions,
            nextContractVersion,
          }),
        );
        if (
          contract.runId !== input.runId ||
          contract.snapshotHash !== prepared.reviewRun.snapshotHash ||
          contract.taskHash !== prepared.reviewRun.taskHash ||
          contract.version !== nextContractVersion ||
          contract.approvedAt !== null ||
          !verifyExecutionContract(contract) ||
          JSON.stringify(contract.humanDecisions) !== JSON.stringify(humanDecisions)
        ) {
          throw new PersistenceError(
            "DATABASE_CORRUPTION",
            "final review contract does not match the resolved review state",
          );
        }
        const transitioned = transitionRun(
          prepared.reviewRun,
          "ready_for_approval",
          prepared.reviewRun.version,
          humanDecision.decidedAt,
        );
        run = RunRecordSchema.parse({
          ...transitioned,
          activeContractId: contract.contractId,
        });
      } else if (input.outcome === "cancelled") {
        if (
          humanDecision.selectedOptionId === null ||
          (!humanDecision.selectedOptionId.endsWith("_cancel") &&
            !humanDecision.selectedOptionId.endsWith("_rerun"))
        ) {
          throw new TypeError("cancelled outcome requires a cancellation option");
        }
        run = RunRecordSchema.parse({
          ...transitionRun(
            prepared.reviewRun,
            "cancelled",
            prepared.reviewRun.version,
            humanDecision.decidedAt,
          ),
          lastErrorCode: "USER_CANCELLED",
        });
      }
      const result = {
        run,
        decision: prepared.resolved,
        humanDecision,
      };
      this.insertIdempotency(
        input.idempotencyKey,
        input.runId,
        operation,
        requestHash,
        JSON.stringify(result),
        humanDecision.decidedAt,
      );
      this.writeHumanDecision(input, humanDecision, prepared.resolved);
      if (contract !== null) this.insertContract(contract);
      this.updateRun(prepared.current.version, run);
      return result;
    });
  }

  listHumanDecisions(runId: string): HumanDecision[] {
    this.getRun(runId);
    const rows = this.database
      .prepare(
        `SELECT record_json FROM human_decisions
         WHERE run_id = ? ORDER BY decision_id`,
      )
      .all(runId) as unknown as DecisionPointRow[];
    return rows.map((row) =>
      HumanDecisionSchema.parse(parseJson(row.record_json, "human decision")),
    );
  }

  deferDecision(input: DeferDecisionInput): DeferDecisionResult {
    validateIdentifier(input.idempotencyKey, "idempotencyKey");
    const operation = "defer_decision";
    const requestHash = requestFingerprint({
      runId: input.runId,
      decisionId: input.decisionId,
      expectedVersion: input.expectedVersion,
    });
    return this.transaction(() => {
      this.assertUnpinned(input.runId, input.requireUnpinned === true);
      this.assertReviewCapabilityCurrent(input.runId, input.reviewCapabilityGeneration);
      const prior = this.idempotentResult(input.idempotencyKey, operation, requestHash);
      if (prior !== null) {
        return this.parseDeferDecisionResult(parseJson(prior, "defer result"));
      }
      const current = this.getRun(input.runId).run;
      if (current.state !== "needs_review" || current.version !== input.expectedVersion) {
        throw new PersistenceError("CONFLICTING_VERSION", "run review version changed");
      }
      const row = this.database
        .prepare("SELECT record_json FROM decision_points WHERE run_id = ? AND decision_id = ?")
        .get(input.runId, input.decisionId) as DecisionPointRow | undefined;
      if (!row) {
        throw new PersistenceError("NOT_FOUND", `decision ${input.decisionId} was not found`);
      }
      const currentDecision = DecisionPointSchema.parse(
        parseJson(row.record_json, "decision point"),
      );
      if (currentDecision.status !== "unresolved") {
        throw new PersistenceError("CONFLICTING_VERSION", "decision cannot be deferred again");
      }
      const decision = DecisionPointSchema.parse({ ...currentDecision, status: "deferred" });
      const run = RunRecordSchema.parse({
        ...current,
        version: current.version + 1,
        updatedAt: input.deferredAt,
      });
      const result = { run, decision };
      this.insertIdempotency(
        input.idempotencyKey,
        input.runId,
        operation,
        requestHash,
        JSON.stringify(result),
        input.deferredAt,
      );
      this.database
        .prepare(
          `UPDATE decision_points SET status = ?, record_json = ?, updated_at = ?
           WHERE run_id = ? AND decision_id = ? AND status = 'unresolved'`,
        )
        .run(
          decision.status,
          JSON.stringify(decision),
          input.deferredAt,
          input.runId,
          input.decisionId,
        );
      this.updateRun(current.version, run);
      return result;
    });
  }

  saveContractAndReady(
    runId: string,
    contract: ExecutionContract,
    expectedVersion: number,
    updatedAt = this.now(),
    requireUnpinned = false,
    reviewCapabilityGeneration?: number,
  ): RunRecord {
    const parsed = ExecutionContractSchema.parse(contract);
    if (parsed.runId !== runId || parsed.approvedAt !== null || !verifyExecutionContract(parsed)) {
      throw new PersistenceError(
        "DATABASE_CORRUPTION",
        "contract is not an unapproved contract for run",
      );
    }
    return this.transaction(() => {
      this.assertUnpinned(runId, requireUnpinned);
      this.assertReviewCapabilityCurrent(runId, reviewCapabilityGeneration);
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

  amendPausedContract(input: AmendPausedContractPersistenceInput): RunRecord {
    validateIdentifier(input.idempotencyKey, "idempotencyKey");
    const parsed = ExecutionContractSchema.parse(input.contract);
    const operation = "amend_paused_contract";
    const requestHash = requestFingerprint({
      runId: input.runId,
      contractId: parsed.contractId,
      contentHash: parsed.contentHash,
      expectedVersion: input.expectedVersion,
    });
    return this.transaction(() => {
      const prior = this.idempotentResult(input.idempotencyKey, operation, requestHash);
      if (prior !== null) return RunRecordSchema.parse(parseJson(prior, "amendment result"));
      const current = this.getRun(input.runId).run;
      if (current.state !== "paused" || current.version !== input.expectedVersion) {
        throw new PersistenceError("CONFLICTING_VERSION", "run is not paused at this version");
      }
      if (current.activeContractId === null) {
        throw new PersistenceError("DATABASE_CORRUPTION", "paused run has no active contract");
      }
      const previous = this.getContract(current.activeContractId);
      if (
        parsed.runId !== current.runId ||
        parsed.snapshotHash !== current.snapshotHash ||
        parsed.taskHash !== current.taskHash ||
        parsed.approvedAt !== null ||
        parsed.version !== previous.version + 1 ||
        !verifyExecutionContract(parsed)
      ) {
        throw new PersistenceError("DATABASE_CORRUPTION", "amended contract is not valid for run");
      }
      const reviewing = transitionRun(current, "needs_review", current.version, input.amendedAt);
      const cleared = RunRecordSchema.parse({
        ...reviewing,
        activeContractId: null,
        blockingDecisionIds: [],
      });
      const ready = transitionRun(cleared, "ready_for_approval", cleared.version, input.amendedAt);
      const result = RunRecordSchema.parse({ ...ready, activeContractId: parsed.contractId });
      this.insertContract(parsed);
      this.updateRun(current.version, result);
      this.insertIdempotency(
        input.idempotencyKey,
        input.runId,
        operation,
        requestHash,
        JSON.stringify(result),
        input.amendedAt,
      );
      return result;
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

  nextContractVersion(runId: string): number {
    this.getRun(runId);
    const row = this.database
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM contracts WHERE run_id = ?")
      .get(runId) as { version: number };
    return row.version + 1;
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
      this.assertUnpinned(input.runId, input.requireUnpinned === true);
      this.assertReviewCapabilityCurrent(input.runId, input.reviewCapabilityGeneration);
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
        input.runId,
        operation,
        requestHash,
        JSON.stringify(result),
        input.approvedAt,
      );
      return result;
    });
  }

  cancelRun(input: CancelRunPersistenceInput): RunRecord {
    validateIdentifier(input.idempotencyKey, "idempotencyKey");
    const operation = "cancel_run";
    const requestHash = requestFingerprint({
      runId: input.runId,
      expectedVersion: input.expectedVersion,
    });
    return this.transaction(() => {
      this.assertUnpinned(input.runId, input.requireUnpinned === true);
      this.assertReviewCapabilityCurrent(input.runId, input.reviewCapabilityGeneration);
      const prior = this.idempotentResult(input.idempotencyKey, operation, requestHash);
      if (prior !== null) return RunRecordSchema.parse(parseJson(prior, "cancel result"));
      const current = this.getRun(input.runId).run;
      if (current.version !== input.expectedVersion) {
        throw new PersistenceError("CONFLICTING_VERSION", "run version changed before cancel");
      }
      const run = ["completed", "failed", "cancelled", "stale"].includes(current.state)
        ? current
        : RunRecordSchema.parse({
            ...transitionRun(current, "cancelled", input.expectedVersion, input.cancelledAt),
            lastErrorCode: "USER_CANCELLED",
          });
      if (run !== current) this.updateRun(current.version, run);
      this.insertIdempotency(
        input.idempotencyKey,
        input.runId,
        operation,
        requestHash,
        JSON.stringify(run),
        input.cancelledAt,
      );
      return run;
    });
  }

  reopenReview(input: ReopenReviewPersistenceInput): RunRecord {
    validateIdentifier(input.idempotencyKey, "idempotencyKey");
    const operation = "reopen_review";
    const requestHash = requestFingerprint({
      runId: input.runId,
      expectedVersion: input.expectedVersion,
    });
    return this.transaction(() => {
      this.assertUnpinned(input.runId, input.requireUnpinned === true);
      this.assertReviewCapabilityCurrent(input.runId, input.reviewCapabilityGeneration);
      const prior = this.idempotentResult(input.idempotencyKey, operation, requestHash);
      if (prior !== null) return RunRecordSchema.parse(parseJson(prior, "reopen result"));
      const current = this.getRun(input.runId).run;
      if (current.state !== "ready_for_approval" || current.version !== input.expectedVersion) {
        throw new PersistenceError(
          "CONFLICTING_VERSION",
          "contract is not editable at this version",
        );
      }
      const decisions = this.listDecisionPoints(input.runId);
      if (decisions.length === 0) {
        throw new PersistenceError("NOT_FOUND", "run has no decisions to edit");
      }
      const transitioned = transitionRun(
        current,
        "needs_review",
        input.expectedVersion,
        input.reopenedAt,
      );
      const run = RunRecordSchema.parse({
        ...transitioned,
        activeContractId: null,
        blockingDecisionIds: decisions.map((decision) => decision.decisionId),
      });
      const updateDecision = this.database.prepare(
        `UPDATE decision_points SET status = 'unresolved', record_json = ?, updated_at = ?
         WHERE run_id = ? AND decision_id = ?`,
      );
      for (const decision of decisions) {
        const unresolved = DecisionPointSchema.parse({ ...decision, status: "unresolved" });
        updateDecision.run(
          JSON.stringify(unresolved),
          input.reopenedAt,
          input.runId,
          decision.decisionId,
        );
      }
      this.database.prepare("DELETE FROM human_decisions WHERE run_id = ?").run(input.runId);
      this.updateRun(current.version, run);
      this.insertIdempotency(
        input.idempotencyKey,
        input.runId,
        operation,
        requestHash,
        JSON.stringify(run),
        input.reopenedAt,
      );
      return run;
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
        input.runId,
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
        input.runId,
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
        const executionRows = this.database
          .prepare(
            `SELECT record_json FROM execution_runs
             WHERE run_id = ? AND state IN ('starting', 'running', 'pausing')`,
          )
          .all(current.runId) as Array<{ record_json: string }>;
        for (const executionRow of executionRows) {
          const execution = ExecutionRecordSchema.parse(
            parseJson(executionRow.record_json, "execution"),
          );
          this.updateExecution(
            { ...execution, state: "paused", lastErrorCode: "CONTROLLER_RESTART" },
            recoveredAt,
          );
        }
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

  deleteRun(runId: string): void {
    const persisted = this.getRun(runId);
    if (persisted.run.state === "running" || persisted.run.state === "pausing") {
      throw new PersistenceError("RUN_NOT_DELETABLE", "active execution cannot be deleted");
    }
    if (this.listWorktrees(runId).some((worktree) => worktree.cleanupStatus === "pending")) {
      throw new PersistenceError(
        "RUN_NOT_DELETABLE",
        "run with a pending worktree cannot be deleted",
      );
    }
    const artifacts = this.database
      .prepare("SELECT relative_path FROM artifacts WHERE run_id = ?")
      .all(runId) as Array<{ relative_path: string }>;
    const snapshotHash = persisted.run.snapshotHash;
    this.transaction(() => {
      const result = this.database.prepare("DELETE FROM runs WHERE run_id = ?").run(runId);
      if (Number(result.changes) !== 1) {
        throw new PersistenceError("NOT_FOUND", `run ${runId} was not found`);
      }
      if (snapshotHash !== null) {
        this.database
          .prepare(
            `DELETE FROM snapshots
             WHERE snapshot_hash = ?
               AND NOT EXISTS (
                 SELECT 1 FROM run_snapshots WHERE run_snapshots.snapshot_hash = snapshots.snapshot_hash
               )`,
          )
          .run(snapshotHash);
      }
    });
    for (const artifact of artifacts) {
      const remaining = this.database
        .prepare("SELECT 1 FROM artifacts WHERE relative_path = ? LIMIT 1")
        .get(artifact.relative_path);
      if (remaining === undefined) this.artifactStore.remove(artifact.relative_path);
    }
  }

  deleteExpiredRuns(expiredAt = this.now()): string[] {
    const rows = this.database
      .prepare(
        `SELECT run_id FROM runs
         WHERE pinned = 0 AND retain_until IS NOT NULL AND retain_until <= ?
         ORDER BY retain_until, run_id`,
      )
      .all(expiredAt) as Array<{ run_id: string }>;
    const deleted: string[] = [];
    for (const row of rows) {
      this.deleteRun(row.run_id);
      deleted.push(row.run_id);
    }
    return deleted;
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

  listWorktrees(runId: string): PersistedWorktree[] {
    const rows = this.database
      .prepare(
        `SELECT worktree_id FROM worktrees WHERE run_id = ? ORDER BY created_at, worktree_id`,
      )
      .all(runId) as Array<{ worktree_id: string }>;
    return rows.map((row) => this.getWorktree(row.worktree_id));
  }

  recordExecution(record: ExecutionRecord, recordedAt = this.now()): ExecutionRecord {
    const parsed = ExecutionRecordSchema.parse(record);
    this.database
      .prepare(
        `INSERT INTO execution_runs(
          execution_id, run_id, thread_id, contract_id, state, worktree_id, last_error_code,
          record_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.executionId,
        parsed.runId,
        parsed.threadId,
        parsed.contractId,
        parsed.state,
        parsed.worktreeId,
        parsed.lastErrorCode,
        JSON.stringify(parsed),
        recordedAt,
        recordedAt,
      );
    return parsed;
  }

  updateExecution(record: ExecutionRecord, updatedAt = this.now()): ExecutionRecord {
    const parsed = ExecutionRecordSchema.parse(record);
    const result = this.database
      .prepare(
        `UPDATE execution_runs
         SET thread_id = ?, state = ?, last_error_code = ?, record_json = ?, updated_at = ?
         WHERE execution_id = ? AND run_id = ? AND contract_id = ? AND worktree_id = ?`,
      )
      .run(
        parsed.threadId,
        parsed.state,
        parsed.lastErrorCode,
        JSON.stringify(parsed),
        updatedAt,
        parsed.executionId,
        parsed.runId,
        parsed.contractId,
        parsed.worktreeId,
      );
    if (Number(result.changes) !== 1) {
      throw new PersistenceError("NOT_FOUND", `execution ${parsed.executionId} was not found`);
    }
    return parsed;
  }

  getExecution(executionId: string): ExecutionRecord {
    const row = this.database
      .prepare("SELECT record_json FROM execution_runs WHERE execution_id = ?")
      .get(executionId) as { record_json: string } | undefined;
    if (row === undefined) {
      throw new PersistenceError("NOT_FOUND", `execution ${executionId} was not found`);
    }
    return ExecutionRecordSchema.parse(parseJson(row.record_json, "execution"));
  }

  listExecutions(runId: string): ExecutionRecord[] {
    const rows = this.database
      .prepare(
        "SELECT record_json FROM execution_runs WHERE run_id = ? ORDER BY created_at, execution_id",
      )
      .all(runId) as Array<{ record_json: string }>;
    return rows.map((row) => ExecutionRecordSchema.parse(parseJson(row.record_json, "execution")));
  }

  recordDeviation(record: DeviationRecord): DeviationRecord {
    const parsed = DeviationRecordSchema.parse(record);
    this.database
      .prepare(
        `INSERT INTO deviations(
          deviation_id, run_id, execution_id, state, category, contract_clause,
          evidence_refs_json, observed_at, record_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(deviation_id) DO NOTHING`,
      )
      .run(
        parsed.deviationId,
        parsed.runId,
        parsed.executionId,
        parsed.state,
        parsed.category,
        parsed.contractClause,
        JSON.stringify(parsed.evidenceRefs),
        parsed.observedAt,
        JSON.stringify(parsed),
      );
    return parsed;
  }

  listDeviations(runId: string): DeviationRecord[] {
    const rows = this.database
      .prepare(
        "SELECT record_json FROM deviations WHERE run_id = ? ORDER BY observed_at, deviation_id",
      )
      .all(runId) as Array<{ record_json: string }>;
    return rows.map((row) => DeviationRecordSchema.parse(parseJson(row.record_json, "deviation")));
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
    runId: string,
    operation: string,
    requestHash: string,
    resultJson: string,
    createdAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO idempotency_keys(
          idempotency_key, run_id, operation, request_hash, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(key, runId, operation, requestHash, resultJson, createdAt);
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

  private parseHumanDecisionResult(value: unknown): RecordHumanDecisionResult {
    if (value === null || typeof value !== "object") {
      throw new PersistenceError("DATABASE_CORRUPTION", "invalid human decision result");
    }
    const record = value as Record<string, unknown>;
    return {
      run: RunRecordSchema.parse(record.run),
      decision: DecisionPointSchema.parse(record.decision),
      humanDecision: HumanDecisionSchema.parse(record.humanDecision),
    };
  }

  private prepareHumanDecision(runId: string, humanDecision: HumanDecision): PreparedHumanDecision {
    const current = this.getRun(runId).run;
    if (current.state !== "needs_review") {
      throw new PersistenceError("CONFLICTING_VERSION", "run is not awaiting human review");
    }
    if (current.version !== humanDecision.expectedRunVersion) {
      throw new PersistenceError(
        "CONFLICTING_VERSION",
        `run ${runId} no longer has version ${String(humanDecision.expectedRunVersion)}`,
      );
    }
    const row = this.database
      .prepare("SELECT record_json FROM decision_points WHERE run_id = ? AND decision_id = ?")
      .get(runId, humanDecision.decisionId) as DecisionPointRow | undefined;
    if (!row) {
      throw new PersistenceError("NOT_FOUND", `decision ${humanDecision.decisionId} was not found`);
    }
    const decision = DecisionPointSchema.parse(parseJson(row.record_json, "decision point"));
    if (decision.status === "resolved") {
      throw new PersistenceError("CONFLICTING_VERSION", "decision was already resolved");
    }
    if (
      humanDecision.selectedOptionId !== null &&
      !decision.options.some((option) => option.id === humanDecision.selectedOptionId)
    ) {
      throw new TypeError("selected option does not belong to the decision");
    }
    if (humanDecision.freeformOverride !== null && !decision.freeformAllowed) {
      throw new TypeError("free-form override is not allowed for the decision");
    }
    const resolved = DecisionPointSchema.parse({ ...decision, status: "resolved" });
    const reviewRun = RunRecordSchema.parse({
      ...current,
      version: current.version + 1,
      blockingDecisionIds: current.blockingDecisionIds.filter(
        (decisionId) => decisionId !== decision.decisionId,
      ),
      updatedAt: humanDecision.decidedAt,
    });
    return { current, resolved, reviewRun };
  }

  private writeHumanDecision(
    input: RecordHumanDecisionInput,
    humanDecision: HumanDecision,
    resolved: DecisionPoint,
  ): void {
    this.database
      .prepare(
        `INSERT INTO human_decisions(
          run_id, decision_id, idempotency_key, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        resolved.decisionId,
        input.idempotencyKey,
        JSON.stringify(humanDecision),
        humanDecision.decidedAt,
      );
    this.database
      .prepare(
        `UPDATE decision_points SET status = ?, record_json = ?, updated_at = ?
         WHERE run_id = ? AND decision_id = ? AND status IN ('unresolved', 'deferred')`,
      )
      .run(
        resolved.status,
        JSON.stringify(resolved),
        humanDecision.decidedAt,
        input.runId,
        resolved.decisionId,
      );
  }

  private parseDeferDecisionResult(value: unknown): DeferDecisionResult {
    if (value === null || typeof value !== "object") {
      throw new PersistenceError("DATABASE_CORRUPTION", "invalid defer decision result");
    }
    const record = value as Record<string, unknown>;
    return {
      run: RunRecordSchema.parse(record.run),
      decision: DecisionPointSchema.parse(record.decision),
    };
  }

  private assertUnpinned(runId: string, required: boolean): void {
    if (!required) return;
    const row = this.database.prepare("SELECT pinned FROM runs WHERE run_id = ?").get(runId) as
      { pinned: number } | undefined;
    if (row === undefined) throw new PersistenceError("NOT_FOUND", `run ${runId} was not found`);
    if (row.pinned === 1) {
      throw new PersistenceError("RUN_ARCHIVED", "archived runs reject review mutations");
    }
  }

  private validateReviewCapabilityGeneration(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new TypeError("review capability generation must be a positive safe integer");
    }
  }

  private assertReviewCapabilityCurrent(runId: string, generation?: number): void {
    if (generation === undefined) return;
    if (!this.isReviewCapabilityCurrent(runId, generation)) {
      throw new PersistenceError("CAPABILITY_REVOKED", "review capability was superseded");
    }
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
