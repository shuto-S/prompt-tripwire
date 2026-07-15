import {
  canonicalHash,
  ComparisonCandidateSchema,
  PlanArtifactSchema,
  RepositorySnapshotSchema,
  type ComparisonCandidate,
  type PlanArtifact,
  type RepositorySnapshot,
} from "@prompt-tripwire/domain";

export function createManualComparisonFallback(
  snapshot: RepositorySnapshot,
  plans: readonly PlanArtifact[],
  failureCode: string,
): ComparisonCandidate {
  const parsedSnapshot = RepositorySnapshotSchema.parse(snapshot);
  const parsedPlans = plans.map((plan) => PlanArtifactSchema.parse(plan));
  if (parsedPlans.length < 2 || parsedPlans.length > 3) {
    throw new TypeError("manual comparison fallback requires two or three plans");
  }
  if (
    parsedPlans.some(
      (plan) =>
        plan.snapshotHash !== parsedSnapshot.snapshotHash ||
        plan.taskHash !== parsedSnapshot.taskHash,
    )
  ) {
    throw new TypeError("manual comparison fallback plans do not match the snapshot");
  }
  const planIds = parsedPlans.map((plan) => plan.probeId).sort();
  const content = {
    consensus: [],
    divergences: [],
    unknowns: [
      {
        id: `comparison_unavailable_${canonicalHash({ failureCode, planIds }).slice(0, 16)}`,
        summary: `Structured comparison was unavailable (${failureCode}).`,
        affectedBehaviors: ["No model-derived consensus or divergence may be treated as approved."],
        affectedFiles: [],
        affectedData: [],
        affectedApis: [],
        affectedCommands: [],
        affectedExternalSystems: [],
        evidenceRefs: [],
      },
    ],
  };
  const comparisonId = `comparison_${canonicalHash({
    snapshotHash: parsedSnapshot.snapshotHash,
    taskHash: parsedSnapshot.taskHash,
    planIds,
    content,
  }).slice(0, 24)}`;
  return ComparisonCandidateSchema.parse({
    comparisonId,
    snapshotHash: parsedSnapshot.snapshotHash,
    taskHash: parsedSnapshot.taskHash,
    planIds,
    ...content,
  });
}
