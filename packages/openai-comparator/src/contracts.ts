import {
  DecisionPointSchema,
  HumanDecisionSchema,
  createExecutionContract,
  type DecisionPoint,
  type HumanDecision,
  type PlanArtifact,
} from "@prompt-tripwire/domain";

import type { ContractPreview, ContractPreviewInput } from "./types.js";

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function shared(values: readonly (readonly string[])[]): string[] {
  const first = values[0];
  if (first === undefined) return [];
  const rest = values.slice(1);
  return unique(first.filter((value) => rest.every((items) => items.includes(value))));
}

function selectedSummary(decision: DecisionPoint, answer: HumanDecision): string {
  if (answer.freeformOverride !== null) {
    return `${decision.question} Free-form decision: ${answer.freeformOverride}`;
  }
  const option = decision.options.find((candidate) => candidate.id === answer.selectedOptionId);
  if (option === undefined) throw new TypeError("human decision references an unknown option");
  return `${decision.question} Selected: ${option.label}. ${option.description}`;
}

function requiredChecks(plans: readonly PlanArtifact[]): string[] {
  return unique(
    plans.flatMap((plan) =>
      plan.commands.filter((command) =>
        /(?:\btest\b|\blint\b|\btypecheck\b|\bbuild\b|\bcheck\b)/iu.test(command),
      ),
    ),
  );
}

export function createContractPreview(input: ContractPreviewInput): ContractPreview {
  const decisions = input.decisions.map((decision) => DecisionPointSchema.parse(decision));
  const humanDecisions = input.humanDecisions.map((decision) =>
    HumanDecisionSchema.parse(decision),
  );
  const answers = new Map(humanDecisions.map((decision) => [decision.decisionId, decision]));
  if (
    input.comparison.snapshotHash !== input.snapshot.snapshotHash ||
    input.comparison.taskHash !== input.snapshot.taskHash ||
    input.plans.some(
      (plan) =>
        plan.snapshotHash !== input.snapshot.snapshotHash ||
        plan.taskHash !== input.snapshot.taskHash,
    ) ||
    unique(input.comparison.planIds).join("\0") !==
      unique(input.plans.map((plan) => plan.probeId)).join("\0")
  ) {
    throw new TypeError("contract preview inputs do not share one snapshot, task, and plan set");
  }
  if (decisions.some((decision) => decision.status !== "resolved")) {
    throw new TypeError("every blocking decision must be resolved before contract preview");
  }
  if (decisions.some((decision) => !answers.has(decision.decisionId))) {
    throw new TypeError("every blocking decision must be resolved before contract preview");
  }
  if (
    humanDecisions.some(
      (decision) => !decisions.some((item) => item.decisionId === decision.decisionId),
    )
  ) {
    throw new TypeError("human decision does not belong to this review");
  }
  const selected = decisions.map((decision) => {
    const answer = answers.get(decision.decisionId);
    if (answer === undefined) throw new TypeError("decision answer disappeared");
    return selectedSummary(decision, answer);
  });
  const contract = createExecutionContract({
    version: input.version ?? 1,
    runId: input.runId,
    snapshotHash: input.snapshot.snapshotHash,
    taskHash: input.snapshot.taskHash,
    approvedGoal: input.snapshot.task,
    approvedBehaviors: unique([
      ...input.comparison.consensus.map((subject) => subject.summary),
      ...selected,
    ]),
    approvedAssumptions: shared(input.plans.map((plan) => plan.assumptions)),
    allowedComponents: shared(input.plans.map((plan) => plan.components)),
    allowedPaths: shared(input.plans.map((plan) => plan.filesToChange)),
    protectedPaths: [".env", ".env.*", ".git/**", "**/.env", "**/.env.*"],
    allowedCommandClasses: ["static_read", "test", "lint", "typecheck", "build", "verification"],
    deniedCommandClasses: [
      "destructive",
      "permission",
      "secret_access",
      "remote_write",
      "deploy",
      "release",
      "migration",
    ],
    networkPolicy: { mode: "deny", hosts: [], actions: [] },
    dependencyPolicy: { mode: "deny", allowed: [] },
    dataPolicy: { mode: "deny", allowed: [] },
    externalEffectPolicy: { mode: "deny", allowed: [] },
    requiredChecks: requiredChecks(input.plans),
    stopConditions: [
      "snapshot or task hash changes",
      "an unresolved or unknown action is requested",
      "a file path falls outside the approved contract",
      "a permission, network, dependency, data, or external effect is not explicitly allowed",
    ],
    humanDecisions,
    unresolvedNonBlockingUnknowns: [],
    modelVersions: {
      codex: input.snapshot.model.id,
      comparator: input.comparatorModel,
      policy: input.policyVersion ?? "deterministic-v1",
    },
    createdAt: input.createdAt,
    approvedAt: null,
  });
  return { contract, selectedDecisionCount: humanDecisions.length };
}
