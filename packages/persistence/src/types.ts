import type {
  ComparisonCandidate,
  DecisionPoint,
  DeviationRecord,
  ExecutionRecord,
  ExecutionContract,
  HumanDecision,
  PlanArtifact,
  RepositorySnapshot,
  RunRecord,
  RunReport,
  RunState,
} from "@prompt-tripwire/domain";

export interface RetentionMetadata {
  readonly createdAt: string;
  readonly retainUntil: string | null;
  readonly pinned: boolean;
}

export interface PersistedRun {
  readonly run: RunRecord;
  readonly retention: RetentionMetadata;
}

export interface ArtifactMetadata {
  readonly artifactId: string;
  readonly runId: string;
  readonly kind: string;
  readonly contentHash: string;
  readonly relativePath: string;
  readonly byteCount: number;
  readonly createdAt: string;
}

export interface StoredEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly occurredAt: string;
  readonly runVersionAfter: number;
}

export interface StructuredLog {
  readonly logId: string;
  readonly runId: string | null;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly eventType: string;
  readonly fields: unknown;
  readonly createdAt: string;
}

export interface EventTransition {
  readonly expectedVersion: number;
  readonly nextState: Exclude<RunState, "running">;
}

export interface IngestEventInput {
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly occurredAt: string;
  readonly transition?: EventTransition;
}

export interface ApprovalInput {
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly contractId: string;
  readonly expectedVersion: number;
  readonly approvedAt: string;
}

export interface ApprovalResult {
  readonly run: RunRecord;
  readonly contract: ExecutionContract;
}

export interface CancelRunPersistenceInput {
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly expectedVersion: number;
  readonly cancelledAt: string;
}

export interface ReopenReviewPersistenceInput {
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly expectedVersion: number;
  readonly reopenedAt: string;
}

export interface AmendPausedContractPersistenceInput {
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly contract: ExecutionContract;
  readonly expectedVersion: number;
  readonly amendedAt: string;
}

export interface StartExecutionPersistenceInput {
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly contractId: string;
  readonly currentSnapshot: RepositorySnapshot;
  readonly expectedVersion: number;
  readonly startedAt: string;
}

export interface StartExecutionPersistenceResult {
  readonly run: RunRecord;
  readonly replayed: boolean;
}

export interface WorktreeRecordInput {
  readonly worktreeId: string;
  readonly runId: string;
  readonly kind: "probe" | "execution";
  readonly path: string;
  readonly branch: string | null;
  readonly snapshotHash: string;
  readonly createdAt: string;
}

export interface WorktreeCleanupInput {
  readonly worktreeId: string;
  readonly status: "removed" | "failed";
  readonly cleanedAt: string;
  readonly errorCode: string | null;
}

export interface PersistedWorktree extends WorktreeRecordInput {
  readonly cleanupStatus: "pending" | "removed" | "failed";
  readonly cleanupErrorCode: string | null;
  readonly cleanedAt: string | null;
}

export interface ExecutionRecordWrite {
  readonly record: ExecutionRecord;
  readonly recordedAt: string;
}

export interface DeviationRecordWrite {
  readonly record: DeviationRecord;
}

export interface StoredReport {
  readonly report: RunReport;
  readonly jsonArtifact: ArtifactMetadata;
  readonly markdownArtifact: ArtifactMetadata;
}

export interface ProbeRunRecordInput {
  readonly runId: string;
  readonly probeId: string;
  readonly attempt: number;
  readonly threadId: string | null;
  readonly state: "completed" | "failed" | "timed_out" | "cancelled";
  readonly errorCode: string | null;
  readonly worktreeId: string | null;
  readonly createdAt: string;
}

export interface ComparatorUsageRecord {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly reasoningTokens: number | null;
}

export interface ComparatorAttemptRecordInput {
  readonly attempt: number;
  readonly state: "completed" | "failed" | "refused" | "timed_out" | "cancelled";
  readonly responseId: string | null;
  readonly model: string;
  readonly errorCode: string | null;
  readonly usage: ComparatorUsageRecord;
}

export interface SaveComparisonInput {
  readonly runId: string;
  readonly candidate: ComparisonCandidate;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly attempts: readonly ComparatorAttemptRecordInput[];
  readonly createdAt: string;
}

export interface PersistedComparison {
  readonly candidate: ComparisonCandidate;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly attempts: readonly ComparatorAttemptRecordInput[];
  readonly createdAt: string;
}

export interface SaveDecisionPointsInput {
  readonly runId: string;
  readonly comparisonId: string;
  readonly decisions: readonly DecisionPoint[];
  readonly createdAt: string;
}

export interface RecordHumanDecisionInput {
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly decision: HumanDecision;
}

export interface RecordHumanDecisionResult {
  readonly run: RunRecord;
  readonly decision: DecisionPoint;
  readonly humanDecision: HumanDecision;
}

export interface DeferDecisionInput {
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly decisionId: string;
  readonly expectedVersion: number;
  readonly deferredAt: string;
}

export interface DeferDecisionResult {
  readonly run: RunRecord;
  readonly decision: DecisionPoint;
}

export interface PersistedPlanArtifact {
  readonly runId: string;
  readonly artifact: PlanArtifact;
  readonly createdAt: string;
}

export interface PersistenceOptions {
  readonly databasePath: string;
  readonly artifactRoot: string;
  readonly now?: () => string;
}
