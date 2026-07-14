import type {
  DecisionPoint,
  ExecutionContract,
  HumanDecision,
  RepositorySnapshot,
  RunRecord,
  RunReport,
} from "@prompt-tripwire/domain";
import type {
  PrepareSnapshotRequest,
  PreparedRepositorySnapshot,
} from "@prompt-tripwire/git-snapshot";
import type { SqlitePersistence } from "@prompt-tripwire/persistence";

export interface InspectionContext {
  readonly run: RunRecord;
  readonly preparedSnapshot: PreparedRepositorySnapshot;
  readonly store: SqlitePersistence;
  readonly signal: AbortSignal;
}

export interface InspectionResult {
  readonly blockingDecisionIds: readonly string[];
  readonly contract: ExecutionContract | null;
}

export interface InspectionPort {
  inspect(context: InspectionContext): Promise<InspectionResult>;
}

export interface ExecutionContext {
  readonly run: RunRecord;
  readonly contract: ExecutionContract;
  readonly snapshot: RepositorySnapshot;
  readonly store: SqlitePersistence;
  readonly signal: AbortSignal;
}

export interface ExecutionResult {
  readonly outcome: "completed" | "paused" | "failed";
  readonly errorCode: string | null;
}

export interface ExecutionPort {
  start(context: ExecutionContext): Promise<ExecutionResult>;
  interrupt(runId: string): Promise<void>;
}

export interface ControllerOptions {
  readonly store: SqlitePersistence;
  readonly inspectionPort?: InspectionPort;
  readonly executionPort?: ExecutionPort;
  readonly inspectionTimeoutMs?: number;
  readonly executionTimeoutMs?: number;
  readonly now?: () => string;
  readonly prepareSnapshot?: (
    request: PrepareSnapshotRequest,
  ) => Promise<PreparedRepositorySnapshot>;
}

export interface InspectInput extends PrepareSnapshotRequest {
  readonly runId?: string;
}

export interface RunInput {
  readonly contractId: string;
  readonly currentSnapshot: RepositorySnapshot;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export interface ControllerStatus {
  readonly run: RunRecord;
  readonly eventCount: number;
  readonly hasReport: boolean;
}

export interface ReportInput {
  readonly report?: RunReport;
  readonly runId: string;
}

export interface ReviewResult {
  readonly run: RunRecord;
  readonly decisions: readonly DecisionPoint[];
  readonly humanDecisions: readonly HumanDecision[];
  readonly contract: ExecutionContract | null;
}

export interface DecideInput {
  readonly runId: string;
  readonly decisionId: string;
  readonly selectedOptionId: string | null;
  readonly freeformOverride: string | null;
  readonly rationale?: string | null;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export interface DeferInput {
  readonly runId: string;
  readonly decisionId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export interface ApproveInput {
  readonly runId: string;
  readonly contractId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}
