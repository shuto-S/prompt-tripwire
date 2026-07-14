import {
  canonicalHash,
  DecisionPointSchema,
  type ComparisonAlternative,
  type ComparisonDivergence,
  type ComparisonSubject,
  type DecisionCategory,
  type DecisionOption,
  type DecisionPoint,
  type PlanArtifact,
} from "@prompt-tripwire/domain";
import { evaluateDeterministicPolicy, type PolicyBlocker } from "@prompt-tripwire/policy";

import type { DecisionReviewRound, ReviewBundle } from "./types.js";

const CATEGORY_ORDER: readonly DecisionCategory[] = [
  "destructive",
  "production",
  "permission",
  "secret",
  "authentication",
  "billing",
  "network",
  "public_api",
  "persistent_data",
  "dependency",
  "compatibility",
  "scope",
  "behavior",
  "verification",
  "rollback",
  "unknown",
];

function stableDecisionId(kind: string, value: unknown): string {
  return `decision_${kind}_${canonicalHash(value).slice(0, 20)}`;
}

function optionFromAlternative(
  decisionId: string,
  alternative: ComparisonAlternative,
): DecisionOption {
  return {
    id: `option_${canonicalHash({ decisionId, alternativeId: alternative.id }).slice(0, 20)}`,
    label: alternative.label,
    description: alternative.description,
    effects: alternative.effects,
    supportedByProbeIds: alternative.supportedByProbeIds,
    evidenceRefs: alternative.evidenceRefs,
  };
}

function categoryForSubject(subject: ComparisonSubject): DecisionCategory {
  if (subject.affectedExternalSystems.length > 0) return "production";
  if (subject.affectedData.length > 0) return "persistent_data";
  if (subject.affectedApis.length > 0) return "public_api";
  if (subject.affectedCommands.length > 0) return "verification";
  if (subject.affectedFiles.length > 0) return "scope";
  return "behavior";
}

function divergenceDecision(divergence: ComparisonDivergence): DecisionPoint {
  const decisionId = stableDecisionId("divergence", divergence);
  return DecisionPointSchema.parse({
    decisionId,
    category: categoryForSubject(divergence.subject),
    question: divergence.suggestedQuestion,
    reason: divergence.subject.summary,
    impact: "medium",
    options: divergence.alternatives.map((alternative) =>
      optionFromAlternative(decisionId, alternative),
    ),
    freeformAllowed: true,
    defaultOptionId: null,
    deterministicTriggers: [],
    evidenceRefs: [
      ...new Set([
        ...divergence.subject.evidenceRefs,
        ...divergence.alternatives.flatMap((alternative) => alternative.evidenceRefs),
      ]),
    ],
    status: "unresolved",
  });
}

function policyDecision(blocker: PolicyBlocker, plans: readonly PlanArtifact[]): DecisionPoint {
  const decisionId = `decision_policy_${blocker.blockerId}`;
  const supportedByProbeIds = [
    ...new Set(
      blocker.evidenceRefs
        .map((reference) => reference.split(":")[0] ?? "")
        .filter((probeId) => plans.some((plan) => plan.probeId === probeId)),
    ),
  ];
  const probes =
    supportedByProbeIds.length > 0 ? supportedByProbeIds : plans.map((plan) => plan.probeId);
  return DecisionPointSchema.parse({
    decisionId,
    category: blocker.category,
    question: blocker.question,
    reason: blocker.description,
    impact: blocker.impact,
    options: [
      {
        id: `${decisionId}_deny`,
        label: "Do not allow",
        description: "Keep this effect outside the execution contract.",
        effects: ["Execution remains blocked for this effect."],
        supportedByProbeIds: probes,
        evidenceRefs: blocker.evidenceRefs,
      },
      {
        id: `${decisionId}_allow`,
        label: "Allow as stated",
        description: "Include the disclosed effect in the execution contract.",
        effects: [blocker.description],
        supportedByProbeIds: probes,
        evidenceRefs: blocker.evidenceRefs,
      },
    ],
    freeformAllowed: true,
    defaultOptionId: null,
    deterministicTriggers: [blocker.trigger],
    evidenceRefs: blocker.evidenceRefs,
    status: "unresolved",
  });
}

function unknownDecision(subject: ComparisonSubject): DecisionPoint {
  const decisionId = stableDecisionId("unknown", subject);
  return DecisionPointSchema.parse({
    decisionId,
    category: "unknown",
    question: `Resolve this unknown: ${subject.summary}`,
    reason: "The comparator could not establish one execution-safe interpretation.",
    impact: "high",
    options: [
      {
        id: `${decisionId}_clarify`,
        label: "Clarify scope",
        description: "Provide an explicit instruction before execution.",
        effects: subject.affectedBehaviors,
        supportedByProbeIds: [],
        evidenceRefs: subject.evidenceRefs,
      },
      {
        id: `${decisionId}_cancel`,
        label: "Cancel or narrow",
        description: "Do not execute the ambiguous scope.",
        effects: ["No execution contract is approved for this unknown."],
        supportedByProbeIds: [],
        evidenceRefs: subject.evidenceRefs,
      },
    ],
    freeformAllowed: true,
    defaultOptionId: null,
    deterministicTriggers: ["unknown"],
    evidenceRefs: subject.evidenceRefs,
    status: "unresolved",
  });
}

function degradedDecision(plans: readonly PlanArtifact[]): DecisionPoint {
  const decisionId = stableDecisionId("degraded", plans.map((plan) => plan.probeId).sort());
  return DecisionPointSchema.parse({
    decisionId,
    category: "unknown",
    question: "Continue after only two independent planning probes completed?",
    reason: "One probe failed after its retry, so three-way agreement could not be established.",
    impact: "high",
    options: [
      {
        id: `${decisionId}_rerun`,
        label: "Re-run inspection",
        description: "Do not approve this degraded comparison; obtain three fresh probes.",
        effects: ["No execution contract is created from this review."],
        supportedByProbeIds: plans.map((plan) => plan.probeId),
        evidenceRefs: [],
      },
      {
        id: `${decisionId}_manual`,
        label: "Review two-probe result",
        description: "Continue only after explicitly accepting reduced comparison coverage.",
        effects: ["The contract records that comparison coverage was degraded."],
        supportedByProbeIds: plans.map((plan) => plan.probeId),
        evidenceRefs: [],
      },
    ],
    freeformAllowed: true,
    defaultOptionId: null,
    deterministicTriggers: ["degraded_probe_set"],
    evidenceRefs: [],
    status: "unresolved",
  });
}

function compareDecisions(left: DecisionPoint, right: DecisionPoint): number {
  const category = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
  if (category !== 0) return category;
  if (left.impact !== right.impact) return left.impact === "high" ? -1 : 1;
  return left.decisionId.localeCompare(right.decisionId);
}

export function normalizeReview(bundle: Omit<ReviewBundle, "decisions">): ReviewBundle {
  const policy = evaluateDeterministicPolicy({ plans: bundle.plans }).map((blocker) =>
    policyDecision(blocker, bundle.plans),
  );
  const model = bundle.candidate.divergences.map(divergenceDecision);
  const unknowns = bundle.candidate.unknowns.map(unknownDecision);
  const degraded = bundle.degraded ? [degradedDecision(bundle.plans)] : [];
  const byId = new Map<string, DecisionPoint>();
  for (const decision of [...policy, ...model, ...unknowns, ...degraded])
    byId.set(decision.decisionId, decision);
  return {
    ...bundle,
    decisions: [...byId.values()].sort(compareDecisions),
  };
}

export function createReviewRound(
  decisions: readonly DecisionPoint[],
  resolvedDecisionIds: ReadonlySet<string> = new Set(),
): DecisionReviewRound {
  const unresolved = decisions
    .filter(
      (decision) => decision.status !== "resolved" && !resolvedDecisionIds.has(decision.decisionId),
    )
    .sort(compareDecisions);
  return {
    decisions: unresolved.slice(0, 3),
    remainingCount: Math.max(0, unresolved.length - 3),
    unresolvedCount: unresolved.length,
    executionAllowed: unresolved.length === 0,
  };
}
