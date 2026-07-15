import type { DecisionPoint, ExecutionContract, RunRecord } from "@prompt-tripwire/domain";
import { renderContractPreview, renderDecisionCards } from "@prompt-tripwire/openai-comparator";
import type { StoredEvent } from "@prompt-tripwire/persistence";

function text(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function renderTerminalStatus(run: RunRecord, events: readonly StoredEvent[] = []): string {
  const lines = [
    `Run: ${text(run.runId)}`,
    `State: ${run.state}`,
    `Version: ${String(run.version)}`,
    `Snapshot: ${run.snapshotHash ?? "not captured"}`,
    `Contract: ${run.activeContractId ?? "not approved"}`,
    `Blocking decisions: ${String(run.blockingDecisionIds.length)}`,
  ];
  if (run.lastErrorCode !== null) lines.push(`Last error: ${text(run.lastErrorCode)}`);
  if (events.length > 0) {
    lines.push("Events:");
    for (const event of events)
      lines.push(`- ${text(event.eventType)} (${text(event.occurredAt)})`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderTerminalReview(
  run: RunRecord,
  decisions: readonly DecisionPoint[],
  contract: ExecutionContract | null,
): string {
  const sections = [renderTerminalStatus(run)];
  if (decisions.length > 0) sections.push(renderDecisionCards(decisions, new Set(), run.runId));
  if (contract !== null) sections.push(renderContractPreview(contract));
  if (decisions.length === 0 && contract === null) {
    sections.push("No persisted review artifacts are available.\n");
  }
  return sections.join("\n");
}
