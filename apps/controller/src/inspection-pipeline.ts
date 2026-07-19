import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AppServerError,
  CodexAppServerClient,
  ProbeCoordinator,
  ProcessJsonRpcTransport,
  type ProbeBatchResult,
  type RunProbeBatchInput,
} from "@prompt-tripwire/codex-app-server";
import type { DecisionPoint } from "@prompt-tripwire/domain";
import {
  AppServerComparatorTransport,
  AppServerReviewTranslationTransport,
  ComparatorRunError,
  PlanComparator,
  ReviewPresentationTranslator,
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
  readonly presentationTranslator?: ReviewPresentationTranslator;
  readonly comparatorModel?: "gpt-5.6-sol" | "gpt-5.6-terra";
  readonly comparatorReasoningEffort?: "low" | "medium" | "high";
  readonly probeTimeoutMs?: number;
  readonly comparatorTimeoutMs?: number;
  readonly translationTimeoutMs?: number;
  readonly now?: () => string;
}

const TRANSLATION_ERROR_CODES = new Set([
  "TRANSLATION_CANCELLED",
  "TRANSLATION_TIMEOUT",
  "TRANSLATION_TOOL_VIOLATION",
  "INVALID_TRANSLATION_ARTIFACT",
  "TRANSLATION_RESPONSE_INVALID",
  "PROTOCOL_VALIDATION_FAILED",
  "APP_SERVER_DISCONNECTED",
]);

function translationErrorCode(error: unknown): string {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return "TRANSLATION_FAILED";
  }
  const code = error.code;
  return typeof code === "string" && TRANSLATION_ERROR_CODES.has(code)
    ? code
    : "TRANSLATION_FAILED";
}

async function saveReviewPresentation(
  context: InspectionContext,
  translator: ReviewPresentationTranslator | undefined,
  decisions: readonly DecisionPoint[],
  model: "gpt-5.6-sol" | "gpt-5.6-terra",
  reasoningEffort: "low" | "medium" | "high",
  timeoutMs: number | undefined,
  createdAt: string,
): Promise<void> {
  if (translator === undefined) return;
  try {
    const result = await translator.translate({
      task: context.preparedSnapshot.snapshot.task,
      taskHash: context.preparedSnapshot.snapshot.taskHash,
      decisions,
      model,
      reasoningEffort,
      signal: context.signal,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    context.store.saveReviewPresentation({
      runId: context.run.runId,
      taskHash: context.preparedSnapshot.snapshot.taskHash,
      status: "available",
      content: result.content,
      model: result.model,
      errorCode: null,
      createdAt,
    });
    return;
  } catch (error) {
    throwIfAborted(context.signal);
    context.store.saveReviewPresentation({
      runId: context.run.runId,
      taskHash: context.preparedSnapshot.snapshot.taskHash,
      status: "unavailable",
      content: null,
      model,
      errorCode: translationErrorCode(error),
      createdAt,
    });
    return;
  }
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
      task: context.preparedSnapshot.snapshot.task,
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
    await saveReviewPresentation(
      context,
      this.options.presentationTranslator,
      decisions,
      model,
      reasoningEffort,
      this.options.translationTimeoutMs,
      createdAt,
    );
    throwIfAborted(context.signal);
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
  readonly comparatorModel?: "gpt-5.6-sol" | "gpt-5.6-terra";
  readonly comparatorReasoningEffort?: "low" | "medium" | "high";
}

export class DefaultInspectionPort implements InspectionPort {
  constructor(private readonly options: DefaultInspectionPortOptions = {}) {}

  async inspect(context: InspectionContext): Promise<InspectionResult> {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "prompt-tripwire-app-server-"));
    let client: CodexAppServerClient | null = null;
    try {
      await chmod(runtimeRoot, 0o700);
      const shellStartupDirectory = join(runtimeRoot, "zsh-startup");
      await mkdir(shellStartupDirectory, { mode: 0o700 });
      const transport = ProcessJsonRpcTransport.start({
        cwd: runtimeRoot,
        shellStartupDirectory,
        ...(this.options.codexPath === undefined ? {} : { codexPath: this.options.codexPath }),
      });
      client = new CodexAppServerClient(transport);
      await client.initialize();
      const comparatorTransport = new AppServerComparatorTransport(client, {
        temporaryParent: runtimeRoot,
      });
      const presentationTransport = new AppServerReviewTranslationTransport(client, {
        temporaryParent: runtimeRoot,
      });
      return await new InspectionPipeline({
        probes: new ProbeCoordinator(client),
        comparator: new PlanComparator(comparatorTransport),
        presentationTranslator: new ReviewPresentationTranslator(presentationTransport),
        ...(this.options.comparatorModel === undefined
          ? {}
          : { comparatorModel: this.options.comparatorModel }),
        ...(this.options.comparatorReasoningEffort === undefined
          ? {}
          : { comparatorReasoningEffort: this.options.comparatorReasoningEffort }),
      }).inspect(context);
    } finally {
      try {
        await client?.close();
      } finally {
        await rm(runtimeRoot, { recursive: true, force: true });
      }
    }
  }
}
