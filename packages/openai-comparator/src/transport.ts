import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ComparisonCandidateContent, PlanArtifact } from "@prompt-tripwire/domain";

import type {
  ComparatorTransport,
  ComparatorTransportRequest,
  ComparatorTransportResult,
  ComparatorUsage,
} from "./types.js";
import { ComparatorTransportError } from "./errors.js";

const EMPTY_USAGE: ComparatorUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  reasoningTokens: null,
};

interface ComparisonFailureMetadata {
  readonly threadId: string;
  readonly turnId: string | null;
  readonly model: string;
  readonly usage: AppServerComparisonRunnerResult["usage"];
}

function failureMetadata(error: unknown): ComparisonFailureMetadata | null {
  if (error === null || typeof error !== "object" || !("metadata" in error)) return null;
  const metadata = error.metadata;
  if (metadata === null || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    (record.turnId !== null && typeof record.turnId !== "string") ||
    typeof record.model !== "string"
  ) {
    return null;
  }
  const usage = record.usage;
  let normalizedUsage: AppServerComparisonRunnerResult["usage"] = null;
  if (usage !== null) {
    if (typeof usage !== "object") return null;
    const usageRecord = usage as Record<string, unknown>;
    const values = [
      usageRecord.inputTokens,
      usageRecord.outputTokens,
      usageRecord.totalTokens,
      usageRecord.reasoningTokens,
    ];
    if (
      !values.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0)
    ) {
      return null;
    }
    normalizedUsage = {
      inputTokens: usageRecord.inputTokens as number,
      outputTokens: usageRecord.outputTokens as number,
      totalTokens: usageRecord.totalTokens as number,
      reasoningTokens: usageRecord.reasoningTokens as number,
    };
  }
  return {
    threadId: record.threadId,
    turnId: record.turnId,
    model: record.model,
    usage: normalizedUsage,
  };
}

export interface AppServerComparisonRunnerInput {
  readonly cwd: string;
  readonly task: string;
  readonly plans: readonly PlanArtifact[];
  readonly model: string;
  readonly reasoningEffort: string;
  readonly signal?: AbortSignal;
}

export interface AppServerComparisonRunnerResult {
  readonly threadId: string;
  readonly turnId: string;
  readonly model: string;
  readonly output: ComparisonCandidateContent;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly reasoningTokens: number;
  } | null;
}

export interface AppServerComparisonRunner {
  runComparison(input: AppServerComparisonRunnerInput): Promise<AppServerComparisonRunnerResult>;
}

export interface AppServerComparatorTransportOptions {
  readonly temporaryParent?: string;
}

export class AppServerComparatorTransport implements ComparatorTransport {
  constructor(
    private readonly runner: AppServerComparisonRunner,
    private readonly options: AppServerComparatorTransportOptions = {},
  ) {}

  async compare(
    request: ComparatorTransportRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<ComparatorTransportResult> {
    const root = await mkdtemp(
      join(this.options.temporaryParent ?? tmpdir(), "prompt-tripwire-comparator-"),
    );
    try {
      await chmod(root, 0o700);
      try {
        const result = await this.runner.runComparison({
          cwd: root,
          task: request.task,
          plans: request.plans,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          signal: options.signal,
        });
        return {
          responseId: null,
          threadId: result.threadId,
          turnId: result.turnId,
          model: result.model,
          output: result.output,
          refused: false,
          usage: result.usage ?? EMPTY_USAGE,
        };
      } catch (error) {
        const metadata = failureMetadata(error);
        if (metadata === null) throw error;
        throw new ComparatorTransportError(error, {
          responseId: null,
          threadId: metadata.threadId,
          turnId: metadata.turnId,
          model: metadata.model,
          output: null,
          refused: false,
          usage: metadata.usage ?? EMPTY_USAGE,
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
