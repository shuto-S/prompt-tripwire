import type {
  ExecutionContract,
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

export interface StoredReport {
  readonly report: RunReport;
  readonly jsonArtifact: ArtifactMetadata;
  readonly markdownArtifact: ArtifactMetadata;
}

export interface PersistenceOptions {
  readonly databasePath: string;
  readonly artifactRoot: string;
  readonly now?: () => string;
}
