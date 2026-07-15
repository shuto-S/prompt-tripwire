import {
  ExecutionContractSchema,
  RepositorySnapshotSchema,
  RunRecordSchema,
  type ExecutionContract,
  type RepositorySnapshot,
  type RunRecord,
  type RunState,
} from "./schemas.js";
import { verifyExecutionContract } from "./contracts.js";
import { verifyRepositorySnapshot } from "./snapshots.js";

export type DomainErrorCode =
  | "CONFLICTING_VERSION"
  | "INVALID_TRANSITION"
  | "STALE_SNAPSHOT"
  | "UNAPPROVED_CONTRACT"
  | "CONTRACT_MISMATCH"
  | "UNRESOLVED_DECISIONS";

export class DomainInvariantError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainInvariantError";
    this.code = code;
  }
}

const ALLOWED_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  created: ["snapshotting", "cancelled", "failed"],
  snapshotting: ["probing", "stale", "cancelled", "failed"],
  probing: ["comparing", "needs_review", "cancelled", "failed", "stale"],
  comparing: ["needs_review", "ready_for_approval", "cancelled", "failed", "stale"],
  needs_review: ["ready_for_approval", "cancelled", "failed", "stale"],
  ready_for_approval: ["approved", "needs_review", "cancelled", "failed", "stale"],
  approved: ["running", "cancelled", "failed", "stale"],
  running: ["pausing", "completed", "cancelled", "failed", "stale"],
  pausing: ["paused", "cancelled", "failed"],
  paused: ["needs_review", "cancelled", "failed", "stale"],
  completed: [],
  failed: [],
  cancelled: [],
  stale: [],
};

function applyTransition(run: RunRecord, nextState: RunState, updatedAt: string): RunRecord {
  return RunRecordSchema.parse({
    ...run,
    state: nextState,
    version: run.version + 1,
    updatedAt,
  });
}

export function transitionRun(
  run: RunRecord,
  nextState: Exclude<RunState, "running">,
  expectedVersion: number,
  updatedAt: string,
): RunRecord {
  const parsed = RunRecordSchema.parse(run);
  if (parsed.version !== expectedVersion) {
    throw new DomainInvariantError(
      "CONFLICTING_VERSION",
      `expected run version ${String(expectedVersion)}, found ${String(parsed.version)}`,
    );
  }
  if (!ALLOWED_TRANSITIONS[parsed.state].includes(nextState)) {
    throw new DomainInvariantError(
      "INVALID_TRANSITION",
      `cannot transition run from ${parsed.state} to ${nextState}`,
    );
  }
  return applyTransition(parsed, nextState, updatedAt);
}

export interface StartExecutionInput {
  readonly run: RunRecord;
  readonly contract: ExecutionContract;
  readonly currentSnapshot: RepositorySnapshot;
  readonly expectedVersion: number;
  readonly updatedAt: string;
}

export function startExecution(input: StartExecutionInput): RunRecord {
  const run = RunRecordSchema.parse(input.run);
  const contract = ExecutionContractSchema.parse(input.contract);
  const snapshot = RepositorySnapshotSchema.parse(input.currentSnapshot);
  if (run.version !== input.expectedVersion) {
    throw new DomainInvariantError(
      "CONFLICTING_VERSION",
      `expected run version ${String(input.expectedVersion)}, found ${String(run.version)}`,
    );
  }
  if (run.state !== "approved") {
    throw new DomainInvariantError(
      "INVALID_TRANSITION",
      `execution requires approved run state, found ${run.state}`,
    );
  }
  if (contract.approvedAt === null) {
    throw new DomainInvariantError("UNAPPROVED_CONTRACT", "execution contract is not approved");
  }
  if (run.blockingDecisionIds.length > 0) {
    throw new DomainInvariantError("UNRESOLVED_DECISIONS", "blocking decisions remain unresolved");
  }
  if (!verifyExecutionContract(contract)) {
    throw new DomainInvariantError("CONTRACT_MISMATCH", "contract content hash mismatch");
  }
  if (!verifyRepositorySnapshot(snapshot)) {
    throw new DomainInvariantError("STALE_SNAPSHOT", "current snapshot hash is invalid");
  }
  if (
    run.activeContractId !== contract.contractId ||
    run.snapshotHash !== snapshot.snapshotHash ||
    contract.snapshotHash !== snapshot.snapshotHash ||
    run.taskHash !== snapshot.taskHash ||
    contract.taskHash !== snapshot.taskHash
  ) {
    throw new DomainInvariantError(
      "STALE_SNAPSHOT",
      "run or contract is not bound to the current snapshot/task",
    );
  }
  return applyTransition(run, "running", input.updatedAt);
}

export function markRunStale(
  run: RunRecord,
  expectedVersion: number,
  updatedAt: string,
): RunRecord {
  return transitionRun(run, "stale", expectedVersion, updatedAt);
}
