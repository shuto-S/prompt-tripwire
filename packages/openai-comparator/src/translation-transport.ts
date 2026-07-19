import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DecisionPoint, ReviewPresentationContent } from "@prompt-tripwire/domain";

import type {
  ComparatorUsage,
  ReviewTranslationTransport,
  ReviewTranslationTransportRequest,
  ReviewTranslationTransportResult,
} from "./types.js";

const EMPTY_USAGE: ComparatorUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  reasoningTokens: null,
};

export interface AppServerReviewTranslationRunnerInput {
  readonly cwd: string;
  readonly task: string;
  readonly decisions: readonly DecisionPoint[];
  readonly model: string;
  readonly reasoningEffort: string;
  readonly signal?: AbortSignal;
}

export interface AppServerReviewTranslationRunnerResult {
  readonly threadId: string;
  readonly turnId: string;
  readonly model: string;
  readonly output: ReviewPresentationContent;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly reasoningTokens: number;
  } | null;
}

export interface AppServerReviewTranslationRunner {
  runReviewTranslation(
    input: AppServerReviewTranslationRunnerInput,
  ): Promise<AppServerReviewTranslationRunnerResult>;
}

export interface AppServerReviewTranslationTransportOptions {
  readonly temporaryParent?: string;
}

export class AppServerReviewTranslationTransport implements ReviewTranslationTransport {
  constructor(
    private readonly runner: AppServerReviewTranslationRunner,
    private readonly options: AppServerReviewTranslationTransportOptions = {},
  ) {}

  async translate(
    request: ReviewTranslationTransportRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<ReviewTranslationTransportResult> {
    const root = await mkdtemp(
      join(this.options.temporaryParent ?? tmpdir(), "prompt-tripwire-translation-"),
    );
    try {
      await chmod(root, 0o700);
      const result = await this.runner.runReviewTranslation({
        cwd: root,
        task: request.task,
        decisions: request.decisions,
        model: request.model,
        reasoningEffort: request.reasoningEffort,
        signal: options.signal,
      });
      return {
        threadId: result.threadId,
        turnId: result.turnId,
        model: result.model,
        output: result.output,
        usage: result.usage ?? EMPTY_USAGE,
      };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
