import {
  DecisionPointSchema,
  ReviewPresentationContentSchema,
  Sha256Schema,
  type DecisionPoint,
  type ReviewPresentationContent,
} from "@prompt-tripwire/domain";
import { sanitizeForExport } from "@prompt-tripwire/policy";

import type {
  ReviewTranslationTransport,
  TranslateReviewInput,
  TranslateReviewResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;

export class ReviewTranslationError extends Error {
  readonly code: "TRANSLATION_CANCELLED" | "TRANSLATION_TIMEOUT" | "TRANSLATION_RESPONSE_INVALID";

  constructor(code: ReviewTranslationError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReviewTranslationError";
    this.code = code;
  }
}

function validateDecisionBinding(
  source: readonly DecisionPoint[],
  output: ReviewPresentationContent,
): ReviewPresentationContent {
  if (output.decisions.length !== source.length) {
    throw new ReviewTranslationError(
      "TRANSLATION_RESPONSE_INVALID",
      "review translation changed the decision count",
    );
  }
  const byDecisionId = new Map(output.decisions.map((decision) => [decision.decisionId, decision]));
  if (byDecisionId.size !== output.decisions.length) {
    throw new ReviewTranslationError(
      "TRANSLATION_RESPONSE_INVALID",
      "review translation returned duplicate decision IDs",
    );
  }
  const decisions = source.map((sourceDecision) => {
    const translated = byDecisionId.get(sourceDecision.decisionId);
    if (translated === undefined || translated.options.length !== sourceDecision.options.length) {
      throw new ReviewTranslationError(
        "TRANSLATION_RESPONSE_INVALID",
        "review translation changed a decision binding",
      );
    }
    const byOptionId = new Map(translated.options.map((option) => [option.optionId, option]));
    if (byOptionId.size !== translated.options.length) {
      throw new ReviewTranslationError(
        "TRANSLATION_RESPONSE_INVALID",
        "review translation returned duplicate option IDs",
      );
    }
    const options = sourceDecision.options.map((sourceOption) => {
      const translatedOption = byOptionId.get(sourceOption.id);
      if (
        translatedOption === undefined ||
        translatedOption.effects.length !== sourceOption.effects.length
      ) {
        throw new ReviewTranslationError(
          "TRANSLATION_RESPONSE_INVALID",
          "review translation changed an option binding",
        );
      }
      return translatedOption;
    });
    return { ...translated, options };
  });
  return ReviewPresentationContentSchema.parse({ task: output.task, decisions });
}

export class ReviewPresentationTranslator {
  constructor(private readonly transport: ReviewTranslationTransport) {}

  async translate(input: TranslateReviewInput): Promise<TranslateReviewResult> {
    Sha256Schema.parse(input.taskHash);
    const decisions = input.decisions.map((decision) => DecisionPointSchema.parse(decision));
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort();
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal =
      input.signal === undefined ? timeout.signal : AbortSignal.any([input.signal, timeout.signal]);
    try {
      const result = await this.transport.translate(
        {
          task: input.task,
          decisions,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
        },
        { signal },
      );
      if (input.signal?.aborted === true) {
        throw new ReviewTranslationError(
          "TRANSLATION_CANCELLED",
          "review translation was cancelled",
        );
      }
      if (timeout.signal.aborted) {
        throw new ReviewTranslationError("TRANSLATION_TIMEOUT", "review translation timed out");
      }
      const sanitized = sanitizeForExport(result.output);
      if (!sanitized.allowed || sanitized.redactionCount > 0) {
        throw new ReviewTranslationError(
          "TRANSLATION_RESPONSE_INVALID",
          "review translation contained secret-like or unsupported content",
        );
      }
      const parsed = ReviewPresentationContentSchema.safeParse(sanitized.value);
      if (!parsed.success) {
        throw new ReviewTranslationError(
          "TRANSLATION_RESPONSE_INVALID",
          "review translation did not match the presentation schema",
          { cause: parsed.error },
        );
      }
      return {
        content: validateDecisionBinding(decisions, parsed.data),
        model: result.model,
        threadId: result.threadId,
        turnId: result.turnId,
        usage: result.usage,
      };
    } catch (error) {
      if (error instanceof ReviewTranslationError) throw error;
      if (input.signal?.aborted === true) {
        throw new ReviewTranslationError(
          "TRANSLATION_CANCELLED",
          "review translation was cancelled",
          { cause: error },
        );
      }
      if (timeout.signal.aborted) {
        throw new ReviewTranslationError("TRANSLATION_TIMEOUT", "review translation timed out", {
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
