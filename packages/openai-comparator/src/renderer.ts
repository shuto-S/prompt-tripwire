import type { DecisionPoint, ExecutionContract } from "@prompt-tripwire/domain";

import { createReviewRound } from "./normalizer.js";

function linesForDecision(decision: DecisionPoint, index: number): string[] {
  const lines = [
    `Decision ${String(index + 1)} [${decision.impact.toUpperCase()} / ${decision.category}]`,
    `Status: ${decision.status}`,
    decision.question,
    `Why: ${decision.reason}`,
  ];
  for (const [optionIndex, option] of decision.options.entries()) {
    lines.push(`  ${String(optionIndex + 1)}. ${option.label} — ${option.description}`);
    if (option.effects.length > 0) lines.push(`     Effects: ${option.effects.join("; ")}`);
    if (option.supportedByProbeIds.length > 0) {
      lines.push(`     Probe support: ${option.supportedByProbeIds.join(", ")}`);
    }
    if (option.evidenceRefs.length > 0) {
      lines.push(`     Evidence: ${option.evidenceRefs.join(", ")}`);
    }
  }
  if (decision.deterministicTriggers.length > 0) {
    lines.push(`  Required by policy: ${decision.deterministicTriggers.join(", ")}`);
  }
  lines.push("  Free-form override: allowed", "  Actions: select / free-form / defer / cancel");
  return lines;
}

export function renderDecisionCards(
  decisions: readonly DecisionPoint[],
  resolvedDecisionIds: ReadonlySet<string> = new Set(),
): string {
  const round = createReviewRound(decisions, resolvedDecisionIds);
  const lines = round.decisions.flatMap((decision, index) => [
    ...linesForDecision(decision, index),
    "",
  ]);
  lines.push(`Unresolved decisions: ${String(round.unresolvedCount)}`);
  if (round.remainingCount > 0) {
    lines.push(`Remaining after this round: ${String(round.remainingCount)}`);
  }
  lines.push(
    round.executionAllowed
      ? "All blocking decisions are resolved. Review the contract preview."
      : "Execution disabled until every blocking decision is resolved.",
  );
  return `${lines.join("\n")}\n`;
}

export function renderContractPreview(contract: ExecutionContract): string {
  return [
    "Execution contract preview",
    `Contract: ${contract.contractId}`,
    `Content hash: ${contract.contentHash}`,
    `Snapshot: ${contract.snapshotHash}`,
    `Task: ${contract.taskHash}`,
    `Allowed paths: ${contract.allowedPaths.join(", ") || "none"}`,
    `Required checks: ${contract.requiredChecks.join(", ") || "none"}`,
    `Human decisions: ${String(contract.humanDecisions.length)}`,
    "Status: unapproved — explicit approval is required before execution.",
    "",
  ].join("\n");
}
