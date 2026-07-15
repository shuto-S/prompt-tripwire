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

const EMPTY_USAGE: ComparatorUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  reasoningTokens: null,
};

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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
