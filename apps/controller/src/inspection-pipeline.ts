import {
  AppServerError,
  CodexAppServerClient,
  ProbeCoordinator,
  ProcessJsonRpcTransport,
  type ProbeBatchResult,
  type RunProbeBatchInput,
} from "@prompt-tripwire/codex-app-server";
import {
  ComparatorRunError,
  OpenAiResponsesTransport,
  PlanComparator,
  createContractPreview,
  createManualComparisonFallback,
  normalizeReview,
  type ComparatorAttempt,
  type ComparatorUsage,
} from "@prompt-tripwire/openai-comparator";

import { ControllerError } from "./errors.js";
import type { InspectionContext, InspectionPort, InspectionResult } from "./types.js";

const EMPTY_USAGE: ComparatorUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  reasoningTokens: null,
};

export interface ProbeBatchRunner {
  run(input: RunProbeBatchInput): Promise<ProbeBatchResult>;
}

export interface InspectionPipelineOptions {
  readonly probes: ProbeBatchRunner;
  readonly comparator: PlanComparator;
  readonly comparatorModel?: "gpt-5.6-sol" | "gpt-5.6-terra";
  readonly comparatorReasoningEffort?: "low" | "medium" | "high";
  readonly probeTimeoutMs?: number;
  readonly comparatorTimeoutMs?: number;
  readonly now?: () => string;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new ControllerError("OPERATION_TIMEOUT", "inspection was cancelled");
}

function recordProbeBatch(context: InspectionContext, batch: ProbeBatchResult): void {
  const worktrees = new Map<string, (typeof batch.worktrees)[number]>();
  for (const item of batch.worktrees) {
    const key = `${item.probeId}:${String(item.attempt)}`;
    worktrees.set(key, item);
    context.store.recordWorktree({
      worktreeId: item.worktree.worktreeId,
      runId: context.run.runId,
      kind: "probe",
      path: item.worktree.path,
      branch: item.worktree.branch,
      snapshotHash: item.worktree.snapshotHash,
      createdAt: item.worktree.createdAt,
    });
    context.store.recordWorktreeCleanup({
      worktreeId: item.worktree.worktreeId,
      status: item.cleanup.success ? "removed" : "failed",
      cleanedAt: new Date().toISOString(),
      errorCode: item.cleanup.failures[0]?.code ?? null,
    });
  }
  for (const attempt of batch.attempts) {
    const worktree = worktrees.get(`${attempt.probeId}:${String(attempt.attempt)}`)?.worktree;
    context.store.recordProbeRun({
      runId: context.run.runId,
      probeId: attempt.probeId,
      attempt: attempt.attempt,
      threadId: attempt.threadId,
      state: attempt.state,
      errorCode: attempt.errorCode,
      worktreeId: worktree?.worktreeId ?? null,
      createdAt: worktree?.createdAt ?? new Date().toISOString(),
    });
  }
}

export class InspectionPipeline implements InspectionPort {
  private readonly now: () => string;

  constructor(private readonly options: InspectionPipelineOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async inspect(context: InspectionContext): Promise<InspectionResult> {
    throwIfAborted(context.signal);
    const batch = await this.options.probes.run({
      prepared: context.preparedSnapshot,
      probeCount: 3,
      maxAttempts: 2,
      signal: context.signal,
      ...(this.options.probeTimeoutMs === undefined
        ? {}
        : { timeoutMs: this.options.probeTimeoutMs }),
    });
    recordProbeBatch(context, batch);
    throwIfAborted(context.signal);
    if (batch.blocked) {
      throw new AppServerError(
        batch.blockingReason ?? "INSUFFICIENT_VALID_PROBES",
        "fewer than two validated planning probes remained",
      );
    }
    const plans = batch.plans.map(
      (plan) => context.store.savePlanArtifact(context.run.runId, plan, this.now()).artifact,
    );

    const model = this.options.comparatorModel ?? "gpt-5.6-terra";
    const reasoningEffort = this.options.comparatorReasoningEffort ?? "low";
    let candidate;
    let attempts: readonly ComparatorAttempt[];
    let usage: ComparatorUsage;
    let actualModel: string = model;
    try {
      const result = await this.options.comparator.compare({
        snapshot: context.preparedSnapshot.snapshot,
        plans,
        model,
        reasoningEffort,
        signal: context.signal,
        ...(this.options.comparatorTimeoutMs === undefined
          ? {}
          : { timeoutMs: this.options.comparatorTimeoutMs }),
      });
      candidate = result.candidate;
      attempts = result.attempts;
      usage = result.usage;
      actualModel = result.model;
    } catch (error) {
      if (!(error instanceof ComparatorRunError) || error.code === "COMPARATOR_CANCELLED") {
        throw error;
      }
      candidate = createManualComparisonFallback(
        context.preparedSnapshot.snapshot,
        plans,
        error.code,
      );
      attempts = error.attempts;
      usage = EMPTY_USAGE;
    }
    const createdAt = this.now();
    context.store.saveComparison({
      runId: context.run.runId,
      candidate,
      model: actualModel,
      reasoningEffort,
      attempts,
      createdAt,
    });
    const review = normalizeReview({
      candidate,
      plans,
      model: actualModel,
      reasoningEffort,
      usage,
      degraded: batch.degraded,
    });
    const decisions = context.store.saveDecisionPoints({
      runId: context.run.runId,
      comparisonId: candidate.comparisonId,
      decisions: review.decisions,
      createdAt,
    });
    if (decisions.length > 0) {
      return {
        blockingDecisionIds: decisions.map((decision) => decision.decisionId),
        contract: null,
      };
    }
    const contract = createContractPreview({
      runId: context.run.runId,
      snapshot: context.preparedSnapshot.snapshot,
      plans,
      comparison: candidate,
      decisions,
      humanDecisions: [],
      comparatorModel: actualModel,
      createdAt,
    }).contract;
    return { blockingDecisionIds: [], contract };
  }
}

export interface DefaultInspectionPortOptions {
  readonly codexPath?: string;
  readonly openAiApiKey?: string;
  readonly comparatorModel?: "gpt-5.6-sol" | "gpt-5.6-terra";
  readonly comparatorReasoningEffort?: "low" | "medium" | "high";
}

export class DefaultInspectionPort implements InspectionPort {
  constructor(private readonly options: DefaultInspectionPortOptions = {}) {}

  async inspect(context: InspectionContext): Promise<InspectionResult> {
    const transport = ProcessJsonRpcTransport.start({
      cwd: context.preparedSnapshot.snapshot.repositoryPath,
      ...(this.options.codexPath === undefined ? {} : { codexPath: this.options.codexPath }),
    });
    const client = new CodexAppServerClient(transport);
    try {
      await client.initialize();
      const comparatorTransport = new OpenAiResponsesTransport(
        this.options.openAiApiKey === undefined ? {} : { apiKey: this.options.openAiApiKey },
      );
      return await new InspectionPipeline({
        probes: new ProbeCoordinator(client),
        comparator: new PlanComparator(comparatorTransport),
        ...(this.options.comparatorModel === undefined
          ? {}
          : { comparatorModel: this.options.comparatorModel }),
        ...(this.options.comparatorReasoningEffort === undefined
          ? {}
          : { comparatorReasoningEffort: this.options.comparatorReasoningEffort }),
      }).inspect(context);
    } finally {
      await client.close();
    }
  }
}
