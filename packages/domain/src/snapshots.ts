import {
  canonicalHash,
  deepFreeze,
  DISPLAY_ONLY_KEYS,
  normalizeLineEndings,
  sha256,
} from "./canonical.js";
import {
  RepositorySnapshotInputSchema,
  RepositorySnapshotSchema,
  type RepositorySnapshot,
  type RepositorySnapshotInput,
} from "./schemas.js";

const SNAPSHOT_OMIT_KEYS = new Set([...DISPLAY_ONLY_KEYS, "snapshotHash"]);

export function repositorySnapshotHash(value: Omit<RepositorySnapshot, "snapshotHash">): string {
  return canonicalHash(value, { omitKeys: SNAPSHOT_OMIT_KEYS });
}

export function createRepositorySnapshot(input: RepositorySnapshotInput): RepositorySnapshot {
  const parsed = RepositorySnapshotInputSchema.parse(input);
  const task = normalizeLineEndings(parsed.task);
  const withTaskHash = { ...parsed, task, taskHash: sha256(task) };
  const snapshot = RepositorySnapshotSchema.parse({
    ...withTaskHash,
    snapshotHash: repositorySnapshotHash(withTaskHash),
  });
  return deepFreeze(snapshot);
}

export function verifyRepositorySnapshot(snapshot: RepositorySnapshot): boolean {
  const parsed = RepositorySnapshotSchema.parse(snapshot);
  const { snapshotHash, ...withoutSnapshotHash } = parsed;
  return (
    parsed.taskHash === sha256(parsed.task) &&
    snapshotHash === repositorySnapshotHash(withoutSnapshotHash)
  );
}

export const SnapshotDriftReason = {
  RepositoryPath: "repository_path",
  Commit: "commit",
  Branch: "branch",
  Submodules: "submodules",
  DirtyPatch: "dirty_patch",
  Task: "task",
  Instructions: "instructions",
  Config: "config",
  Model: "model",
  CodexVersion: "codex_version",
  PromptTripwireVersion: "prompt_tripwire_version",
  SnapshotHash: "snapshot_hash",
} as const;

export type SnapshotDriftReason = (typeof SnapshotDriftReason)[keyof typeof SnapshotDriftReason];

export function detectSnapshotDrift(
  approved: RepositorySnapshot,
  current: RepositorySnapshot,
): SnapshotDriftReason[] {
  const before = RepositorySnapshotSchema.parse(approved);
  const after = RepositorySnapshotSchema.parse(current);
  const reasons: SnapshotDriftReason[] = [];
  if (before.repositoryPath !== after.repositoryPath) {
    reasons.push(SnapshotDriftReason.RepositoryPath);
  }
  if (before.commitSha !== after.commitSha) reasons.push(SnapshotDriftReason.Commit);
  if (before.branch !== after.branch) reasons.push(SnapshotDriftReason.Branch);
  if (canonicalHash(before.submodules) !== canonicalHash(after.submodules)) {
    reasons.push(SnapshotDriftReason.Submodules);
  }
  if (before.dirtyPatchHash !== after.dirtyPatchHash) reasons.push(SnapshotDriftReason.DirtyPatch);
  if (before.task !== after.task || before.taskHash !== after.taskHash) {
    reasons.push(SnapshotDriftReason.Task);
  }
  if (before.instructionHash !== after.instructionHash)
    reasons.push(SnapshotDriftReason.Instructions);
  if (before.configHash !== after.configHash) reasons.push(SnapshotDriftReason.Config);
  if (
    before.model.id !== after.model.id ||
    before.model.reasoningEffort !== after.model.reasoningEffort
  ) {
    reasons.push(SnapshotDriftReason.Model);
  }
  if (before.codexVersion !== after.codexVersion) {
    reasons.push(SnapshotDriftReason.CodexVersion);
  }
  if (before.promptTripwireVersion !== after.promptTripwireVersion) {
    reasons.push(SnapshotDriftReason.PromptTripwireVersion);
  }
  if (reasons.length === 0 && before.snapshotHash !== after.snapshotHash) {
    reasons.push(SnapshotDriftReason.SnapshotHash);
  }
  return reasons;
}
