import type {
  ComparisonCandidate,
  ComparisonCandidateContent,
  DecisionPoint,
  ExecutionContract,
  HumanDecision,
  PlanArtifact,
  RepositorySnapshot,
} from "@prompt-tripwire/domain";

export interface ComparatorUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly reasoningTokens: number | null;
}

export interface ComparatorTransportRequest {
  readonly task: string;
  readonly plans: readonly PlanArtifact[];
  readonly model: string;
  readonly reasoningEffort: string;
}

export interface ComparatorTransportResult {
  readonly responseId: string | null;
  readonly threadId: string | null;
  readonly turnId: string | null;
  readonly model: string;
  readonly output: ComparisonCandidateContent | null;
  readonly refused: boolean;
  readonly usage: ComparatorUsage;
}

export interface ComparatorTransport {
  compare(
    request: ComparatorTransportRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<ComparatorTransportResult>;
}

export interface ComparePlansInput {
  readonly snapshot: RepositorySnapshot;
  readonly plans: readonly PlanArtifact[];
  readonly model: "gpt-5.6-sol" | "gpt-5.6-terra";
  readonly reasoningEffort: "low" | "medium" | "high";
  readonly timeoutMs?: number;
  readonly maxAttempts?: 1 | 2;
  readonly signal?: AbortSignal;
}

export interface ComparatorAttempt {
  readonly attempt: number;
  readonly state: "completed" | "failed" | "refused" | "timed_out" | "cancelled";
  readonly responseId: string | null;
  readonly threadId: string | null;
  readonly turnId: string | null;
  readonly model: string;
  readonly errorCode: string | null;
  readonly usage: ComparatorUsage;
}

export interface ComparePlansResult {
  readonly candidate: ComparisonCandidate;
  readonly attempts: readonly ComparatorAttempt[];
  readonly model: string;
  readonly reasoningEffort: string;
  readonly usage: ComparatorUsage;
}

export interface ReviewBundle {
  readonly candidate: ComparisonCandidate;
  readonly decisions: readonly DecisionPoint[];
  readonly plans: readonly PlanArtifact[];
  readonly model: string;
  readonly reasoningEffort: string;
  readonly usage: ComparatorUsage;
  readonly degraded: boolean;
}

export interface DecisionReviewRound {
  readonly decisions: readonly DecisionPoint[];
  readonly remainingCount: number;
  readonly unresolvedCount: number;
  readonly executionAllowed: boolean;
}

export interface ContractPreviewInput {
  readonly runId: string;
  readonly snapshot: RepositorySnapshot;
  readonly plans: readonly PlanArtifact[];
  readonly comparison: ComparisonCandidate;
  readonly decisions: readonly DecisionPoint[];
  readonly humanDecisions: readonly HumanDecision[];
  readonly comparatorModel: string;
  readonly policyVersion?: string;
  readonly createdAt: string;
  readonly version?: number;
}

export interface ContractPreview {
  readonly contract: ExecutionContract;
  readonly selectedDecisionCount: number;
}
