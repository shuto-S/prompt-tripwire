import type { PlanArtifact, RepositorySnapshot } from "@prompt-tripwire/domain";
import type {
  CleanupResult,
  DisposableWorktree,
  PreparedRepositorySnapshot,
} from "@prompt-tripwire/git-snapshot";

export type JsonRpcId = string | number;

export interface JsonRpcTransportClose {
  readonly expected: boolean;
  readonly code: string;
}

export interface JsonRpcTransport {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onClose(listener: (event: JsonRpcTransportClose) => void): () => void;
  close(): Promise<void>;
}

export interface ApprovalObservation {
  readonly requestId: JsonRpcId;
  readonly method: string;
  readonly itemId: string | null;
  readonly decision: "accept_static_read" | "decline" | "deny_permissions";
  readonly reasonCode: string;
}

export interface NormalizedAppServerEvent {
  readonly eventId: string;
  readonly method: string;
  readonly threadId: string | null;
  readonly turnId: string | null;
  readonly itemId: string | null;
  readonly itemType: string | null;
  readonly status: string | null;
}

export interface ModelDescriptor {
  readonly id: string;
  readonly model: string;
  readonly isDefault: boolean;
  readonly defaultReasoningEffort: string;
  readonly supportedReasoningEfforts: readonly string[];
}

export interface PlanProbeInput {
  readonly probeId: string;
  readonly cwd: string;
  readonly snapshot: RepositorySnapshot;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface PlanProbeResult {
  readonly probeId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly artifact: PlanArtifact;
  readonly approvals: readonly ApprovalObservation[];
  readonly events: readonly NormalizedAppServerEvent[];
}

export interface ProbeAttemptResult {
  readonly probeId: string;
  readonly attempt: number;
  readonly state: "completed" | "failed" | "timed_out" | "cancelled";
  readonly threadId: string | null;
  readonly artifact: PlanArtifact | null;
  readonly errorCode: string | null;
  readonly errorReason: string | null;
  readonly approvals: readonly ApprovalObservation[];
  readonly events: readonly NormalizedAppServerEvent[];
}

export interface ProbeWorktreeResult {
  readonly probeId: string;
  readonly attempt: number;
  readonly worktree: DisposableWorktree;
  readonly cleanup: CleanupResult;
}

export interface ProbeBatchResult {
  readonly snapshotHash: string;
  readonly taskHash: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly attempts: readonly ProbeAttemptResult[];
  readonly plans: readonly PlanArtifact[];
  readonly worktrees: readonly ProbeWorktreeResult[];
  readonly degraded: boolean;
  readonly blocked: boolean;
  readonly blockingReason: "INSUFFICIENT_VALID_PROBES" | "PROBE_CONTAINMENT_VIOLATION" | null;
}

export interface RunProbeBatchInput {
  readonly prepared: PreparedRepositorySnapshot;
  readonly timeoutMs?: number;
  readonly temporaryParent?: string;
  readonly probeCount?: 1 | 2 | 3;
  readonly maxAttempts?: 1 | 2;
  readonly signal?: AbortSignal;
}
