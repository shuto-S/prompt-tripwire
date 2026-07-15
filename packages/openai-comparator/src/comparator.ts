import {
  canonicalHash,
  ComparisonCandidateContentSchema,
  ComparisonCandidateSchema,
  PlanArtifactSchema,
  RepositorySnapshotSchema,
  type ComparisonCandidateContent,
  type PlanArtifact,
} from "@prompt-tripwire/domain";
import { sanitizeForExport } from "@prompt-tripwire/policy";

import { ComparatorError, ComparatorRunError, type ComparatorErrorCode } from "./errors.js";
import type {
  ComparatorAttempt,
  ComparatorTransport,
  ComparatorTransportResult,
  ComparatorUsage,
  ComparePlansInput,
  ComparePlansResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const EMPTY_USAGE: ComparatorUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  reasoningTokens: null,
};

function validateInputs(input: ComparePlansInput): readonly PlanArtifact[] {
  const snapshot = RepositorySnapshotSchema.parse(input.snapshot);
  if (input.plans.length < 2 || input.plans.length > 3) {
    throw new ComparatorError(
      "COMPARATOR_INPUT_INVALID",
      "comparison requires two or three validated plans",
    );
  }
  const plans = input.plans.map((plan) => PlanArtifactSchema.parse(plan));
  if (new Set(plans.map((plan) => plan.probeId)).size !== plans.length) {
    throw new ComparatorError("COMPARATOR_INPUT_INVALID", "probe IDs must be distinct");
  }
  if (
    plans.some(
      (plan) => plan.snapshotHash !== snapshot.snapshotHash || plan.taskHash !== snapshot.taskHash,
    )
  ) {
    throw new ComparatorError(
      "COMPARATOR_INPUT_INVALID",
      "plans must match the approved snapshot and task",
    );
  }
  return plans;
}

function evidenceIds(plans: readonly PlanArtifact[]): ReadonlySet<string> {
  return new Set(plans.flatMap((plan) => plan.repositoryEvidence.map((evidence) => evidence.id)));
}

function validateReferences(
  content: ComparisonCandidateContent,
  plans: readonly PlanArtifact[],
): void {
  if (
    content.consensus.length === 0 &&
    content.divergences.length === 0 &&
    content.unknowns.length === 0
  ) {
    throw new ComparatorError(
      "COMPARATOR_RESPONSE_INVALID",
      "comparison response did not cover any plan behavior",
    );
  }
  const probes = new Set(plans.map((plan) => plan.probeId));
  const evidence = evidenceIds(plans);
  const subjects = [
    ...content.consensus,
    ...content.unknowns,
    ...content.divergences.map((divergence) => divergence.subject),
  ];
  const references = [
    ...subjects.flatMap((subject) => subject.evidenceRefs),
    ...content.divergences.flatMap((divergence) =>
      divergence.alternatives.flatMap((alternative) => alternative.evidenceRefs),
    ),
  ];
  const supported = content.divergences.flatMap((divergence) =>
    divergence.alternatives.flatMap((alternative) => alternative.supportedByProbeIds),
  );
  if (references.some((reference) => !evidence.has(reference))) {
    throw new ComparatorError(
      "COMPARATOR_RESPONSE_INVALID",
      "comparison referenced unknown repository evidence",
    );
  }
  if (supported.some((probeId) => !probes.has(probeId))) {
    throw new ComparatorError(
      "COMPARATOR_RESPONSE_INVALID",
      "comparison referenced an unknown probe",
    );
  }
  if (
    content.divergences.some((divergence) =>
      divergence.alternatives.some((alternative) => alternative.supportedByProbeIds.length === 0),
    )
  ) {
    throw new ComparatorError(
      "COMPARATOR_RESPONSE_INVALID",
      "every alternative requires probe support",
    );
  }
}

function bindCandidate(input: ComparePlansInput, plans: readonly PlanArtifact[], output: unknown) {
  const sanitized = sanitizeForExport(output);
  if (!sanitized.allowed || sanitized.redactionCount > 0) {
    throw new ComparatorError(
      "COMPARATOR_RESPONSE_INVALID",
      "comparison response contained secret-like or unsupported content",
    );
  }
  const content = ComparisonCandidateContentSchema.parse(sanitized.value);
  validateReferences(content, plans);
  const planIds = plans.map((plan) => plan.probeId).sort();
  const comparisonId = `comparison_${canonicalHash({
    snapshotHash: input.snapshot.snapshotHash,
    taskHash: input.snapshot.taskHash,
    planIds,
    content,
  }).slice(0, 24)}`;
  return ComparisonCandidateSchema.parse({
    comparisonId,
    snapshotHash: input.snapshot.snapshotHash,
    taskHash: input.snapshot.taskHash,
    planIds,
    ...content,
  });
}

function attemptFailure(
  attempt: number,
  model: string,
  code: ComparatorErrorCode,
  response: ComparatorTransportResult | null,
): ComparatorAttempt {
  return {
    attempt,
    state:
      code === "COMPARATOR_TIMEOUT"
        ? "timed_out"
        : code === "COMPARATOR_CANCELLED"
          ? "cancelled"
          : code === "COMPARATOR_REFUSAL"
            ? "refused"
            : "failed",
    responseId: response?.responseId ?? null,
    threadId: response?.threadId ?? null,
    turnId: response?.turnId ?? null,
    model: response?.model ?? model,
    errorCode: code,
    usage: response?.usage ?? EMPTY_USAGE,
  };
}

function comparatorFailure(error: unknown, timedOut: boolean, cancelled: boolean): ComparatorError {
  if (cancelled) return new ComparatorError("COMPARATOR_CANCELLED", "comparison was cancelled");
  if (timedOut) return new ComparatorError("COMPARATOR_TIMEOUT", "comparison timed out");
  if (error instanceof ComparatorError) return error;
  return new ComparatorError("COMPARATOR_PARSE_FAILED", "comparison response could not be parsed", {
    cause: error,
  });
}

export class PlanComparator {
  constructor(private readonly transport: ComparatorTransport) {}

  async compare(input: ComparePlansInput): Promise<ComparePlansResult> {
    const plans = validateInputs(input);
    const attempts: ComparatorAttempt[] = [];
    const maxAttempts = input.maxAttempts ?? 2;
    let lastError: ComparatorError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const timeout = new AbortController();
      const timer = setTimeout(() => {
        timeout.abort();
      }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const combined =
        input.signal === undefined
          ? timeout.signal
          : AbortSignal.any([input.signal, timeout.signal]);
      let response: ComparatorTransportResult | null = null;
      try {
        response = await this.transport.compare(
          {
            task: input.snapshot.task,
            plans,
            model: input.model,
            reasoningEffort: input.reasoningEffort,
          },
          { signal: combined },
        );
        if (response.refused) {
          throw new ComparatorError("COMPARATOR_REFUSAL", "comparison model refused the request");
        }
        if (response.output === null) {
          throw new ComparatorError(
            "COMPARATOR_PARSE_FAILED",
            "comparison response contained no parsed output",
          );
        }
        const candidate = bindCandidate(input, plans, response.output);
        attempts.push({
          attempt,
          state: "completed",
          responseId: response.responseId,
          threadId: response.threadId,
          turnId: response.turnId,
          model: response.model,
          errorCode: null,
          usage: response.usage,
        });
        return {
          candidate,
          attempts,
          model: response.model,
          reasoningEffort: input.reasoningEffort,
          usage: response.usage,
        };
      } catch (error) {
        lastError = comparatorFailure(
          error,
          timeout.signal.aborted,
          input.signal?.aborted === true,
        );
        attempts.push(attemptFailure(attempt, input.model, lastError.code, response));
        if (lastError.code === "COMPARATOR_CANCELLED") {
          throw new ComparatorRunError(lastError, attempts);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ComparatorRunError(
      lastError ?? new ComparatorError("COMPARATOR_PARSE_FAILED", "comparison failed"),
      attempts,
    );
  }
}
