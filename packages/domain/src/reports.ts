import { RunReportSchema, type RunReport } from "./schemas.js";

function markdownText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/([\\`*_[\]{}<>#|])/gu, "\\$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function list(values: readonly string[], empty = "None"): string {
  if (values.length === 0) return `- ${empty}`;
  return values.map((value) => `- ${markdownText(value)}`).join("\n");
}

export function serializeRunReportJson(report: RunReport): string {
  return `${JSON.stringify(RunReportSchema.parse(report), null, 2)}\n`;
}

export function renderRunReportMarkdown(report: RunReport): string {
  const parsed = RunReportSchema.parse(report);
  const contract =
    parsed.contractId === null
      ? "Not approved"
      : `${markdownText(parsed.contractId)} (${parsed.contractHash ?? "missing hash"})`;
  const decisions = parsed.decisions.map(
    (decision) =>
      `${decision.decisionId}: ${decision.selectedOptionId ?? decision.freeformOverride ?? "unresolved"}`,
  );
  const actions = parsed.observedActions.map(
    (action) => `${action.kind}: ${action.summary} — ${action.outcome}`,
  );
  const checks = parsed.checks.map(
    (check) =>
      `${check.command} — ${check.outcome}${check.reason === null ? "" : ` (${check.reason})`}`,
  );
  const deviations = parsed.deviations.map(
    (deviation) =>
      `${deviation.category}: ${deviation.summary}${
        deviation.resolution === null ? "" : ` — ${deviation.resolution}`
      }`,
  );

  return [
    `# PromptTripwire run ${markdownText(parsed.runId)}`,
    "",
    `- State: ${parsed.state}`,
    `- Snapshot: ${parsed.snapshotHash ?? "Not available"}`,
    `- Task: ${parsed.taskHash}`,
    `- Contract: ${contract}`,
    `- Generated: ${markdownText(parsed.generatedAt)}`,
    "",
    "## Models and threads",
    "",
    list([...parsed.modelIds, ...parsed.threadIds]),
    "",
    "## Decisions",
    "",
    list(decisions),
    "",
    "## Observed actions",
    "",
    list(actions),
    "",
    "## Diff",
    "",
    `- Within contract: ${String(parsed.diffSummary.withinContract)}`,
    list(parsed.diffSummary.changedPaths),
    "",
    "## Checks",
    "",
    list(checks),
    "",
    "## Deviations",
    "",
    list(deviations),
    "",
    "## Remaining unknowns",
    "",
    list(parsed.remainingUnknowns),
    "",
  ].join("\n");
}
