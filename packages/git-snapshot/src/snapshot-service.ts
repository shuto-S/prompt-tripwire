import { createHash } from "node:crypto";

import {
  canonicalHash,
  createRepositorySnapshot,
  detectSnapshotDrift,
  type CodexCompatibilityAttestation,
  type ModelConfiguration,
  type RepositorySnapshot,
  type SnapshotDriftReason,
} from "@prompt-tripwire/domain";

import {
  configurationHash,
  DEFAULT_CONFIG_PATHS,
  instructionHash,
  type SnapshotContentMode,
} from "./approved-files.js";
import { GitSnapshotError } from "./errors.js";
import { fingerprintCheckout, fingerprintsMatch } from "./fingerprint.js";
import { runGit } from "./git.js";
import { inspectRepository, type RepositoryInspection } from "./inspection.js";

export type DirtyChoice = "committed_only" | "include_patch" | "cancel";

export interface PrepareSnapshotRequest {
  readonly repositoryPath: string;
  readonly task: string;
  readonly model: ModelConfiguration;
  readonly codexVersion?: string;
  readonly compatibilityAttestation?: CodexCompatibilityAttestation;
  readonly promptTripwireVersion: string;
  readonly dirtyChoice?: DirtyChoice;
  readonly effectiveConfig?: unknown;
  readonly configPaths?: readonly string[];
  readonly externalInstructionHashes?: Readonly<Record<string, string>>;
  readonly createdAt?: string;
}

export interface PreparedSnapshotParameters {
  readonly repositoryPath: string;
  readonly task: string;
  readonly model: ModelConfiguration;
  readonly codexVersion: string;
  readonly compatibilityAttestation?: CodexCompatibilityAttestation;
  readonly promptTripwireVersion: string;
  readonly contentMode: SnapshotContentMode;
  readonly effectiveConfigHash: string;
  readonly configPaths: readonly string[];
  readonly externalInstructionHashes: Readonly<Record<string, string>>;
}

export interface PreparedRepositorySnapshot {
  readonly snapshot: RepositorySnapshot;
  readonly patch: Buffer | null;
  readonly inspection: RepositoryInspection;
  readonly excludedUntrackedFileCount: number;
  readonly parameters: PreparedSnapshotParameters;
}

export interface SnapshotFreshness {
  readonly stale: boolean;
  readonly reasons: readonly SnapshotDriftReason[];
  readonly current: PreparedRepositorySnapshot;
}

function bufferSha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function inspectionIdentity(inspection: RepositoryInspection): string {
  return canonicalHash({
    branch: inspection.branch,
    changes: inspection.changes,
    commitSha: inspection.commitSha,
    submodules: inspection.submodules,
    workingDirectoryRelative: inspection.workingDirectoryRelative,
  });
}

async function approvedPatch(
  inspection: RepositoryInspection,
  mode: SnapshotContentMode,
): Promise<Buffer | null> {
  if (mode === "committed_only" || inspection.trackedChangeCount === 0) return null;
  if (inspection.hasUnrepresentableSubmoduleChange) {
    throw new GitSnapshotError(
      "UNREPRESENTABLE_SUBMODULE_CHANGE",
      "snapshot",
      "The dirty submodule state cannot be represented by an approved patch.",
    );
  }
  const result = await runGit(inspection.repositoryPath, [
    "diff",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--no-textconv",
    inspection.commitSha,
    "--",
    ".",
  ]);
  return result.stdout.length === 0 ? null : result.stdout;
}

function selectedMode(
  inspection: RepositoryInspection,
  choice: DirtyChoice | undefined,
): SnapshotContentMode {
  if (choice === "cancel") {
    throw new GitSnapshotError(
      "SNAPSHOT_CANCELLED",
      "snapshot",
      "Snapshot creation was cancelled.",
    );
  }
  if (inspection.isDirty && choice === undefined) {
    throw new GitSnapshotError(
      "DIRTY_CHOICE_REQUIRED",
      "snapshot",
      "The repository is dirty and requires an explicit snapshot choice.",
    );
  }
  return choice === "include_patch" ? "include_patch" : "committed_only";
}

async function prepareWithParameters(
  parameters: PreparedSnapshotParameters,
  createdAt: string,
  suppliedInspection?: RepositoryInspection,
): Promise<PreparedRepositorySnapshot> {
  const inspection = suppliedInspection ?? (await inspectRepository(parameters.repositoryPath));
  const beforeFingerprint = await fingerprintCheckout(inspection.repositoryPath);
  const patch = await approvedPatch(inspection, parameters.contentMode);
  const [instructions, config] = await Promise.all([
    instructionHash(
      inspection.repositoryPath,
      inspection.commitSha,
      inspection.workingDirectoryRelative,
      parameters.contentMode,
      parameters.externalInstructionHashes,
    ),
    configurationHash(
      inspection.repositoryPath,
      inspection.commitSha,
      parameters.contentMode,
      parameters.configPaths,
      parameters.effectiveConfigHash,
    ),
  ]);
  const snapshot = createRepositorySnapshot({
    repositoryPath: inspection.repositoryPath,
    commitSha: inspection.commitSha,
    branch: inspection.branch,
    submodules: inspection.submodules,
    dirtyPatchHash: patch === null ? null : bufferSha256(patch),
    instructionHash: instructions,
    configHash: config,
    task: parameters.task,
    model: parameters.model,
    codexVersion: parameters.codexVersion,
    ...(parameters.compatibilityAttestation === undefined
      ? {}
      : { compatibilityAttestation: parameters.compatibilityAttestation }),
    promptTripwireVersion: parameters.promptTripwireVersion,
    createdAt,
  });
  const [afterFingerprint, finalInspection] = await Promise.all([
    fingerprintCheckout(inspection.repositoryPath),
    inspectRepository(parameters.repositoryPath),
  ]);
  if (
    !fingerprintsMatch(beforeFingerprint, afterFingerprint) ||
    inspectionIdentity(inspection) !== inspectionIdentity(finalInspection)
  ) {
    throw new GitSnapshotError(
      "SNAPSHOT_SOURCE_CHANGED",
      "snapshot",
      "The repository changed while the approved snapshot was being calculated.",
    );
  }
  return Object.freeze({
    snapshot,
    patch,
    inspection,
    excludedUntrackedFileCount: inspection.untrackedFileCount,
    parameters,
  });
}

export async function prepareRepositorySnapshot(
  request: PrepareSnapshotRequest,
): Promise<PreparedRepositorySnapshot> {
  const codexVersion = request.compatibilityAttestation?.codexVersion ?? request.codexVersion;
  if (codexVersion === undefined) {
    throw new GitSnapshotError(
      "CODEX_COMPATIBILITY_REQUIRED",
      "snapshot",
      "A measured Codex compatibility attestation is required.",
    );
  }
  if (
    request.compatibilityAttestation !== undefined &&
    request.codexVersion !== undefined &&
    request.compatibilityAttestation.codexVersion !== request.codexVersion
  ) {
    throw new GitSnapshotError(
      "CODEX_COMPATIBILITY_MISMATCH",
      "snapshot",
      "The supplied Codex version did not match its compatibility attestation.",
    );
  }
  const inspection = await inspectRepository(request.repositoryPath);
  const contentMode = selectedMode(inspection, request.dirtyChoice);
  const parameters: PreparedSnapshotParameters = Object.freeze({
    repositoryPath: inspection.workingDirectory,
    task: request.task,
    model: Object.freeze({ ...request.model }),
    codexVersion,
    ...(request.compatibilityAttestation === undefined
      ? {}
      : { compatibilityAttestation: Object.freeze({ ...request.compatibilityAttestation }) }),
    promptTripwireVersion: request.promptTripwireVersion,
    contentMode,
    effectiveConfigHash: canonicalHash(request.effectiveConfig ?? {}),
    configPaths: Object.freeze(
      [...new Set([...DEFAULT_CONFIG_PATHS, ...(request.configPaths ?? [])])].sort(),
    ),
    externalInstructionHashes: Object.freeze(
      Object.fromEntries(
        Object.entries(request.externalInstructionHashes ?? {}).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ),
  });
  return await prepareWithParameters(
    parameters,
    request.createdAt ?? new Date().toISOString(),
    inspection,
  );
}

export interface SnapshotRecheckOverrides {
  readonly task?: string;
  readonly model?: ModelConfiguration;
  readonly codexVersion?: string;
  readonly compatibilityAttestation?: CodexCompatibilityAttestation;
  readonly promptTripwireVersion?: string;
  readonly effectiveConfig?: unknown;
  readonly externalInstructionHashes?: Readonly<Record<string, string>>;
}

export async function checkPreparedSnapshot(
  prepared: PreparedRepositorySnapshot,
  overrides: SnapshotRecheckOverrides = {},
): Promise<SnapshotFreshness> {
  const parameters: PreparedSnapshotParameters = {
    ...prepared.parameters,
    task: overrides.task ?? prepared.parameters.task,
    model: overrides.model === undefined ? prepared.parameters.model : { ...overrides.model },
    codexVersion: overrides.codexVersion ?? prepared.parameters.codexVersion,
    ...((overrides.compatibilityAttestation ?? prepared.parameters.compatibilityAttestation) ===
    undefined
      ? {}
      : {
          compatibilityAttestation:
            overrides.compatibilityAttestation ?? prepared.parameters.compatibilityAttestation,
        }),
    promptTripwireVersion:
      overrides.promptTripwireVersion ?? prepared.parameters.promptTripwireVersion,
    effectiveConfigHash:
      overrides.effectiveConfig === undefined
        ? prepared.parameters.effectiveConfigHash
        : canonicalHash(overrides.effectiveConfig),
    externalInstructionHashes:
      overrides.externalInstructionHashes === undefined
        ? prepared.parameters.externalInstructionHashes
        : Object.fromEntries(
            Object.entries(overrides.externalInstructionHashes).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
  };
  const current = await prepareWithParameters(parameters, new Date().toISOString());
  const reasons = detectSnapshotDrift(prepared.snapshot, current.snapshot);
  return {
    stale: reasons.length > 0 || prepared.snapshot.snapshotHash !== current.snapshot.snapshotHash,
    reasons,
    current,
  };
}

export function verifyPreparedPatch(prepared: PreparedRepositorySnapshot): boolean {
  return prepared.patch === null
    ? prepared.snapshot.dirtyPatchHash === null
    : bufferSha256(prepared.patch) === prepared.snapshot.dirtyPatchHash;
}
