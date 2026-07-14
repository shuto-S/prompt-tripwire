import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import {
  DomainInvariantError,
  RunRecordSchema,
  RunReportSchema,
  type RunRecord,
  type RunReport,
} from "@prompt-tripwire/domain";
import { prepareRepositorySnapshot } from "@prompt-tripwire/git-snapshot";
import { PersistenceError, type SqlitePersistence } from "@prompt-tripwire/persistence";

import { ControllerError } from "./errors.js";
import { withTimeout } from "./timeout.js";
import type {
  ControllerOptions,
  ControllerStatus,
  InspectInput,
  ReportInput,
  RunInput,
} from "./types.js";

const DEFAULT_INSPECTION_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30 * 60 * 1_000;

function errorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "UNEXPECTED_ERROR";
}

function terminal(state: RunRecord["state"]): boolean {
  return ["completed", "failed", "cancelled", "stale"].includes(state);
}

export class LocalController {
  private readonly store: SqlitePersistence;
  private readonly options: ControllerOptions;
  private readonly now: () => string;
  private readonly activeExecutionIds = new Set<string>();
  private started = false;

  constructor(options: ControllerOptions) {
    this.options = options;
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  start(): readonly RunRecord[] {
    if (this.started) return [];
    const recovered = this.store.recoverInterruptedRuns(this.now());
    for (const run of recovered) {
      this.store.recordLog(
        "warn",
        "controller.restart_recovered",
        { runVersion: run.version, state: run.state },
        run.runId,
        this.now(),
      );
    }
    this.started = true;
    return recovered;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    for (const runId of [...this.activeExecutionIds]) {
      try {
        await this.options.executionPort?.interrupt(runId);
        const current = this.store.getRun(runId).run;
        if (current.state === "running") {
          const pausing = this.store.transitionRun(
            runId,
            "pausing",
            current.version,
            this.now(),
            "CONTROLLER_STOP",
          );
          this.store.transitionRun(runId, "paused", pausing.version, this.now(), "CONTROLLER_STOP");
        }
      } catch {
        // Restart recovery will conservatively pause any remaining running record.
      }
    }
    this.activeExecutionIds.clear();
    this.store.close();
    this.started = false;
  }

  async inspect(input: InspectInput): Promise<RunRecord> {
    this.assertStarted();
    const inspectionPort = this.options.inspectionPort;
    if (inspectionPort === undefined) {
      throw new ControllerError(
        "INSPECTION_NOT_CONFIGURED",
        "the read-only inspection adapter is not configured",
      );
    }
    const prepared = await (this.options.prepareSnapshot ?? prepareRepositorySnapshot)(input);
    const runId = input.runId ?? `run_${randomUUID()}`;
    const initial = RunRecordSchema.parse({
      runId,
      state: "created",
      version: 0,
      snapshotHash: prepared.snapshot.snapshotHash,
      taskHash: prepared.snapshot.taskHash,
      activeContractId: null,
      blockingDecisionIds: [],
      lastErrorCode: null,
      updatedAt: this.now(),
    });
    this.store.createRun(initial, initial.updatedAt);

    try {
      const snapshottingEvent = this.store.ingestEvent({
        idempotencyKey: `${runId}:snapshotting`,
        runId,
        eventType: "run.snapshotting",
        payload: { snapshotHash: prepared.snapshot.snapshotHash },
        occurredAt: this.now(),
        transition: { expectedVersion: initial.version, nextState: "snapshotting" },
      });
      this.store.saveSnapshot(runId, prepared.snapshot);
      const probingEvent = this.store.ingestEvent({
        idempotencyKey: `${runId}:probing`,
        runId,
        eventType: "run.probing",
        payload: {
          excludedUntrackedFileCount: prepared.excludedUntrackedFileCount,
          snapshotEventId: snapshottingEvent.eventId,
        },
        occurredAt: this.now(),
        transition: { expectedVersion: snapshottingEvent.runVersionAfter, nextState: "probing" },
      });
      const result = await withTimeout(
        this.options.inspectionTimeoutMs ?? DEFAULT_INSPECTION_TIMEOUT_MS,
        async (signal) =>
          await inspectionPort.inspect({
            run: this.store.getRun(runId).run,
            preparedSnapshot: prepared,
            store: this.store,
            signal,
          }),
      );
      const comparing = this.store.setBlockingDecisionsAndTransition(
        runId,
        result.blockingDecisionIds,
        probingEvent.runVersionAfter,
        "comparing",
        this.now(),
      );
      if (result.blockingDecisionIds.length > 0) {
        if (result.contract !== null) {
          throw new TypeError("inspection cannot emit a contract while decisions are unresolved");
        }
        return this.store.transitionRun(runId, "needs_review", comparing.version, this.now());
      }
      if (result.contract === null) {
        throw new TypeError("inspection without blockers must emit an execution contract");
      }
      return this.store.saveContractAndReady(runId, result.contract, comparing.version, this.now());
    } catch (error) {
      this.failActiveRun(runId, errorCode(error));
      throw error;
    }
  }

  async run(input: RunInput): Promise<RunRecord> {
    this.assertStarted();
    const executionPort = this.options.executionPort;
    if (executionPort === undefined) {
      throw new ControllerError(
        "EXECUTION_NOT_CONFIGURED",
        "the isolated execution adapter is not configured",
      );
    }
    const contract = this.store.getContract(input.contractId);
    let started;
    try {
      started = this.store.startExecution({
        idempotencyKey: input.idempotencyKey,
        runId: contract.runId,
        contractId: input.contractId,
        currentSnapshot: input.currentSnapshot,
        expectedVersion: input.expectedVersion,
        startedAt: this.now(),
      });
    } catch (error) {
      if (error instanceof DomainInvariantError && error.code === "STALE_SNAPSHOT") {
        const current = this.store.getRun(contract.runId).run;
        if (current.state === "approved") {
          this.store.transitionRun(
            current.runId,
            "stale",
            current.version,
            this.now(),
            "STALE_SNAPSHOT",
          );
        }
      }
      throw error;
    }
    if (started.replayed) return started.run;

    const runId = started.run.runId;
    this.activeExecutionIds.add(runId);
    try {
      const result = await withTimeout(
        this.options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
        async (signal) =>
          await executionPort.start({
            run: started.run,
            contract,
            snapshot: input.currentSnapshot,
            store: this.store,
            signal,
          }),
      );
      const current = this.store.getRun(runId).run;
      if (current.state !== "running") return current;
      if (result.outcome === "completed") {
        return this.store.transitionRun(
          runId,
          "completed",
          current.version,
          this.now(),
          result.errorCode,
        );
      }
      if (result.outcome === "failed") {
        return this.store.transitionRun(
          runId,
          "failed",
          current.version,
          this.now(),
          result.errorCode ?? "EXECUTION_FAILED",
        );
      }
      const pausing = this.store.transitionRun(
        runId,
        "pausing",
        current.version,
        this.now(),
        result.errorCode,
      );
      return this.store.transitionRun(
        runId,
        "paused",
        pausing.version,
        this.now(),
        result.errorCode,
      );
    } catch (error) {
      const code = errorCode(error);
      const observed = this.store.getRun(runId).run;
      if (observed.state !== "running") return observed;
      if (code === "OPERATION_TIMEOUT") {
        await executionPort.interrupt(runId);
        const pausing = this.store.transitionRun(
          runId,
          "pausing",
          observed.version,
          this.now(),
          code,
        );
        return this.store.transitionRun(runId, "paused", pausing.version, this.now(), code);
      }
      this.failActiveRun(runId, code);
      throw error;
    } finally {
      this.activeExecutionIds.delete(runId);
    }
  }

  async cancel(runId: string): Promise<RunRecord> {
    this.assertStarted();
    const current = this.store.getRun(runId).run;
    if (terminal(current.state)) return current;
    if (current.state === "running" || current.state === "pausing") {
      const cancelled = this.store.transitionRun(
        runId,
        "cancelled",
        current.version,
        this.now(),
        "USER_CANCELLED",
      );
      await this.options.executionPort?.interrupt(runId);
      return cancelled;
    }
    return this.store.transitionRun(
      runId,
      "cancelled",
      current.version,
      this.now(),
      "USER_CANCELLED",
    );
  }

  status(runId: string): ControllerStatus {
    this.assertStarted();
    let hasReport = true;
    try {
      this.store.getReport(runId);
    } catch (error) {
      if (error instanceof PersistenceError && error.code === "NOT_FOUND") hasReport = false;
      else throw error;
    }
    return {
      run: this.store.getRun(runId).run,
      eventCount: this.store.listEvents(runId).length,
      hasReport,
    };
  }

  report(input: ReportInput): RunReport {
    this.assertStarted();
    if (input.report !== undefined) return this.store.saveReport(input.report).report;
    const run = this.store.getRun(input.runId).run;
    const contract =
      run.activeContractId === null ? null : this.store.getContract(run.activeContractId);
    const report = RunReportSchema.parse({
      reportVersion: 1,
      runId: run.runId,
      state: run.state,
      snapshotHash: run.snapshotHash,
      taskHash: run.taskHash,
      contractId: contract?.contractId ?? null,
      contractHash: contract?.contentHash ?? null,
      threadIds: [],
      modelIds:
        contract === null ? [] : [contract.modelVersions.codex, contract.modelVersions.comparator],
      decisions: contract?.humanDecisions ?? [],
      observedActions: [],
      diffSummary: { changedPaths: [], withinContract: null, evidenceRefs: [] },
      checks: [],
      deviations: [],
      remainingUnknowns: contract?.unresolvedNonBlockingUnknowns ?? [],
      generatedAt: this.now(),
    });
    return this.store.saveReport(report).report;
  }

  exportReport(runId: string, format: "json" | "markdown", outputPath: string): void {
    this.assertStarted();
    let stored;
    try {
      stored = this.store.getReport(runId);
    } catch (error) {
      if (!(error instanceof PersistenceError) || error.code !== "NOT_FOUND") throw error;
      this.report({ runId });
      stored = this.store.getReport(runId);
    }
    const artifact = format === "json" ? stored.jsonArtifact : stored.markdownArtifact;
    writeFileSync(outputPath, this.store.readArtifact(artifact.artifactId), {
      flag: "wx",
      mode: 0o600,
    });
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new ControllerError("CONTROLLER_NOT_STARTED", "controller.start() is required");
    }
  }

  private failActiveRun(runId: string, code: string): void {
    try {
      const current = this.store.getRun(runId).run;
      if (!terminal(current.state)) {
        this.store.transitionRun(runId, "failed", current.version, this.now(), code);
      }
      this.store.recordLog("error", "controller.operation_failed", { code }, runId, this.now());
    } catch {
      // The original error remains authoritative; restart recovery handles running state.
    }
  }
}
