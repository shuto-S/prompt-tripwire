export interface SnapshotSummaryDto {
  readonly repositoryPath: string;
  readonly commitSha: string;
  readonly branch: string | null;
  readonly task: string;
  readonly modelId: string;
}

export interface DecisionOptionDto {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly effects: readonly string[];
  readonly supportedByProbeIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface DecisionCardDto {
  readonly decisionId: string;
  readonly category: string;
  readonly question: string;
  readonly reason: string;
  readonly impact: "low" | "medium" | "high";
  readonly options: readonly DecisionOptionDto[];
  readonly freeformAllowed: boolean;
  readonly defaultOptionId: string | null;
  readonly deterministicTriggers: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly status: "unresolved" | "deferred";
}

export interface ContractPreviewDto {
  readonly contractId: string;
  readonly contentHash: string;
  readonly approvedGoal: string;
  readonly approvedBehaviors: readonly string[];
  readonly allowedPaths: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly stopConditions: readonly string[];
  readonly approvedAt: string | null;
}

export interface DeviationDto {
  readonly deviationId: string;
  readonly category: string;
  readonly summary: string;
  readonly resolution: string | null;
  readonly evidenceRefs: readonly string[];
}

export interface RunReviewDto {
  readonly mode: "live" | "recorded";
  readonly runId: string;
  readonly state: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly lastErrorCode: string | null;
  readonly snapshot: SnapshotSummaryDto | null;
  readonly decisions: readonly DecisionCardDto[];
  readonly remainingDecisionCount: number;
  readonly resolvedDecisionCount: number;
  readonly contract: ContractPreviewDto | null;
  readonly deviations: readonly DeviationDto[];
}

export interface RunEventDto {
  readonly runId: string;
  readonly state: string;
  readonly version: number;
  readonly blockingDecisionCount: number;
  readonly updatedAt: string;
}

export interface MutationResponseDto {
  readonly runId: string;
  readonly state: string;
  readonly version: number;
}

export interface PlanEvidenceDto {
  readonly [key: string]: unknown;
  readonly probeId: string;
}

export interface ReviewEvidenceDto {
  readonly plans: readonly PlanEvidenceDto[];
  readonly comparison: Record<string, unknown>;
}
