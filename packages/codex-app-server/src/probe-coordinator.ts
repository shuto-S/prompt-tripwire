import {
  cleanupDisposableWorktree,
  createDisposableWorktree,
  type DisposableWorktree,
} from "@prompt-tripwire/git-snapshot";

import { AppServerError } from "./errors.js";
import type {
  PlanProbeInput,
  PlanProbeResult,
  ProbeAttemptResult,
  ProbeBatchResult,
  ProbeWorktreeResult,
  RunProbeBatchInput,
} from "./types.js";

export interface PlanProbeRunner {
  runPlanProbe(input: PlanProbeInput): Promise<PlanProbeResult>;
}

function probeErrorCode(error: unknown): string {
  return error instanceof AppServerError ? error.code : "PROBE_FAILED";
}

function failedAttempt(probeId: string, attempt: number, error: unknown): ProbeAttemptResult {
  const errorCode = probeErrorCode(error);
  return {
    probeId,
    attempt,
    state:
      errorCode === "PROBE_TIMEOUT"
        ? "timed_out"
        : errorCode === "PROBE_CANCELLED"
          ? "cancelled"
          : "failed",
    threadId: null,
    artifact: null,
    errorCode,
    errorReason: error instanceof AppServerError ? error.message : "probe attempt failed",
    approvals: [],
    events: [],
  };
}

function completedAttempt(result: PlanProbeResult, attempt: number): ProbeAttemptResult {
  return {
    probeId: result.probeId,
    attempt,
    state: "completed",
    threadId: result.threadId,
    artifact: result.artifact,
    errorCode: null,
    errorReason: null,
    approvals: result.approvals,
    events: result.events,
  };
}

function byProbeAndAttempt(
  left: { readonly probeId: string; readonly attempt: number },
  right: { readonly probeId: string; readonly attempt: number },
): number {
  return left.probeId.localeCompare(right.probeId) || left.attempt - right.attempt;
}

export class ProbeCoordinator {
  constructor(private readonly runner: PlanProbeRunner) {}

  async run(input: RunProbeBatchInput): Promise<ProbeBatchResult> {
    const probeCount = input.probeCount ?? 3;
    const maxAttempts = input.maxAttempts ?? 2;
    const worktreeResults: ProbeWorktreeResult[] = [];
    let creationTail: Promise<void> = Promise.resolve();

    const createWorktree = (): Promise<DisposableWorktree> => {
      const created = creationTail.then(
        async () =>
          await createDisposableWorktree(input.prepared, {
            kind: "probe",
            ...(input.temporaryParent === undefined
              ? {}
              : { temporaryParent: input.temporaryParent }),
          }),
      );
      creationTail = created.then(
        () => undefined,
        () => undefined,
      );
      return created;
    };

    const attemptGroups = await Promise.all(
      Array.from({ length: probeCount }, async (_, index) => {
        const probeId = `probe_${String(index + 1)}_${input.prepared.snapshot.snapshotHash.slice(0, 12)}`;
        const attempts: ProbeAttemptResult[] = [];
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (input.signal?.aborted === true) {
            attempts.push(
              failedAttempt(
                probeId,
                attempt,
                new AppServerError("PROBE_CANCELLED", "probe batch was cancelled"),
              ),
            );
            break;
          }
          let worktree: DisposableWorktree;
          try {
            worktree = await createWorktree();
          } catch (error) {
            attempts.push(failedAttempt(probeId, attempt, error));
            continue;
          }

          let result: ProbeAttemptResult;
          try {
            const completed = await this.runner.runPlanProbe({
              probeId,
              cwd: worktree.cwd,
              snapshot: input.prepared.snapshot,
              model: input.prepared.snapshot.model.id,
              reasoningEffort: input.prepared.snapshot.model.reasoningEffort,
              ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            });
            result = completedAttempt(completed, attempt);
          } catch (error) {
            result = failedAttempt(probeId, attempt, error);
          }

          const cleanup = await cleanupDisposableWorktree(worktree);
          worktreeResults.push({ probeId, attempt, worktree, cleanup });
          if (!cleanup.success) {
            result = failedAttempt(
              probeId,
              attempt,
              new AppServerError(
                "PROBE_CONTAINMENT_VIOLATION",
                "probe worktree cleanup could not be verified",
              ),
            );
          }
          attempts.push(result);
          if (result.state === "completed") break;
        }
        return attempts;
      }),
    );

    const attempts = attemptGroups.flat().sort(byProbeAndAttempt);
    const worktrees = worktreeResults.sort(byProbeAndAttempt);
    const cleanupFailed = worktrees.some((result) => !result.cleanup.success);
    const plans = cleanupFailed
      ? []
      : attempts.flatMap((attempt) =>
          attempt.state === "completed" && attempt.artifact !== null ? [attempt.artifact] : [],
        );
    const blocked = cleanupFailed || plans.length < 2;

    return {
      snapshotHash: input.prepared.snapshot.snapshotHash,
      taskHash: input.prepared.snapshot.taskHash,
      model: input.prepared.snapshot.model.id,
      reasoningEffort: input.prepared.snapshot.model.reasoningEffort,
      attempts,
      plans,
      worktrees,
      degraded: !blocked && plans.length === 2,
      blocked,
      blockingReason: cleanupFailed
        ? "PROBE_CONTAINMENT_VIOLATION"
        : blocked
          ? "INSUFFICIENT_VALID_PROBES"
          : null,
    };
  }
}
