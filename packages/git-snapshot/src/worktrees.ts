import { createHash, randomUUID } from "node:crypto";
import { access, chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import { fingerprintCheckout, fingerprintsMatch, type CheckoutFingerprint } from "./fingerprint.js";
import { GitSnapshotError } from "./errors.js";
import { runGit, textOutput } from "./git.js";
import { inspectRepository, type RepositoryInspection } from "./inspection.js";
import {
  checkPreparedSnapshot,
  verifyPreparedPatch,
  type PreparedRepositorySnapshot,
} from "./snapshot-service.js";

export type WorktreeKind = "probe" | "execution";

export interface CreateWorktreeOptions {
  readonly kind: WorktreeKind;
  readonly temporaryParent?: string;
}

export interface DisposableWorktree {
  readonly worktreeId: string;
  readonly kind: WorktreeKind;
  readonly sourceRepositoryPath: string;
  readonly path: string;
  readonly cwd: string;
  readonly temporaryRoot: string;
  readonly branch: string | null;
  readonly snapshotHash: string;
  readonly createdAt: string;
}

export interface CleanupFailure {
  readonly step: "worktree_remove" | "branch_delete" | "temporary_root_remove" | "source_verify";
  readonly code: string;
}

export interface CleanupResult {
  readonly success: boolean;
  readonly failures: readonly CleanupFailure[];
}

interface OriginalCheckoutState {
  readonly fingerprint: CheckoutFingerprint;
  readonly gitStateHash: string;
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function inspectionStateHash(inspection: RepositoryInspection): string {
  const value = JSON.stringify({
    branch: inspection.branch,
    changes: inspection.changes,
    commitSha: inspection.commitSha,
    submodules: inspection.submodules,
  });
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function captureOriginalCheckoutState(
  repositoryPath: string,
): Promise<OriginalCheckoutState> {
  const [fingerprint, inspection] = await Promise.all([
    fingerprintCheckout(repositoryPath),
    inspectRepository(repositoryPath),
  ]);
  return { fingerprint, gitStateHash: inspectionStateHash(inspection) };
}

function originalStatesMatch(before: OriginalCheckoutState, after: OriginalCheckoutState): boolean {
  return (
    fingerprintsMatch(before.fingerprint, after.fingerprint) &&
    before.gitStateHash === after.gitStateHash
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function applyApprovedPatch(
  worktreePath: string,
  prepared: PreparedRepositorySnapshot,
): Promise<void> {
  if (prepared.patch === null) return;
  try {
    await runGit(worktreePath, ["apply", "--check", "--binary", "--index", "-"], {
      input: prepared.patch,
    });
    await runGit(worktreePath, ["apply", "--binary", "--index", "-"], {
      input: prepared.patch,
    });
  } catch {
    throw new GitSnapshotError(
      "PATCH_APPLY_FAILED",
      "worktree-create",
      "The approved dirty patch could not be applied to the disposable worktree.",
    );
  }
  const actual = await runGit(worktreePath, [
    "diff",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--no-textconv",
    prepared.snapshot.commitSha,
    "--",
    ".",
  ]);
  if (hashBytes(actual.stdout) !== prepared.snapshot.dirtyPatchHash) {
    throw new GitSnapshotError(
      "PATCH_VERIFICATION_FAILED",
      "worktree-create",
      "The materialized worktree does not match the approved patch hash.",
    );
  }
}

async function materializeSubmodules(
  worktreePath: string,
  submodules: Readonly<Record<string, string>>,
): Promise<void> {
  if (Object.keys(submodules).length === 0) return;
  try {
    await runGit(worktreePath, ["submodule", "update", "--init", "--recursive", "--no-fetch"], {
      environment: { GIT_ALLOW_PROTOCOL: "file" },
    });
    for (const [path, expectedSha] of Object.entries(submodules)) {
      const actual = await runGit(join(worktreePath, ...path.split("/")), ["rev-parse", "HEAD"]);
      if (textOutput(actual).trim() !== expectedSha) {
        throw new GitSnapshotError(
          "SUBMODULE_MATERIALIZATION_FAILED",
          "worktree-create",
          "A submodule did not materialize at the approved commit.",
        );
      }
    }
  } catch (error) {
    if (error instanceof GitSnapshotError && error.code === "SUBMODULE_MATERIALIZATION_FAILED") {
      throw error;
    }
    throw new GitSnapshotError(
      "SUBMODULE_MATERIALIZATION_FAILED",
      "worktree-create",
      "Submodules could not be materialized without fetching from the network.",
    );
  }
}

async function cleanupInternal(worktree: DisposableWorktree): Promise<CleanupResult> {
  const failures: CleanupFailure[] = [];
  let before: OriginalCheckoutState | null = null;
  try {
    before = await captureOriginalCheckoutState(worktree.sourceRepositoryPath);
  } catch {
    failures.push({ step: "source_verify", code: "SOURCE_CAPTURE_FAILED" });
  }
  let worktreeRemoved = !(await pathExists(worktree.path));
  if (!worktreeRemoved) {
    try {
      await runGit(worktree.sourceRepositoryPath, ["worktree", "remove", "--force", worktree.path]);
      worktreeRemoved = true;
    } catch {
      failures.push({ step: "worktree_remove", code: "WORKTREE_REMOVE_FAILED" });
    }
  }
  if (worktreeRemoved && worktree.branch !== null) {
    try {
      await runGit(worktree.sourceRepositoryPath, ["branch", "-D", "--", worktree.branch]);
    } catch {
      failures.push({ step: "branch_delete", code: "BRANCH_DELETE_FAILED" });
    }
  }
  if (worktreeRemoved) {
    try {
      await rm(worktree.temporaryRoot, { recursive: true, force: true });
    } catch {
      failures.push({ step: "temporary_root_remove", code: "TEMPORARY_ROOT_REMOVE_FAILED" });
    }
  }
  if (before !== null) {
    try {
      const after = await captureOriginalCheckoutState(worktree.sourceRepositoryPath);
      if (!originalStatesMatch(before, after)) {
        failures.push({ step: "source_verify", code: "ORIGINAL_CHECKOUT_CHANGED" });
      }
    } catch {
      failures.push({ step: "source_verify", code: "SOURCE_VERIFY_FAILED" });
    }
  }
  return { success: failures.length === 0, failures };
}

export async function cleanupDisposableWorktree(
  worktree: DisposableWorktree,
): Promise<CleanupResult> {
  return await cleanupInternal(worktree);
}

export async function createDisposableWorktree(
  prepared: PreparedRepositorySnapshot,
  options: CreateWorktreeOptions,
): Promise<DisposableWorktree> {
  const freshness = await checkPreparedSnapshot(prepared);
  if (freshness.stale) {
    throw new GitSnapshotError(
      "STALE_SNAPSHOT",
      "worktree-create",
      "The approved repository snapshot is stale.",
    );
  }
  if (!verifyPreparedPatch(prepared)) {
    throw new GitSnapshotError(
      "PATCH_VERIFICATION_FAILED",
      "worktree-create",
      "The in-memory patch no longer matches the approved snapshot.",
    );
  }

  const sourceRepositoryPath = prepared.snapshot.repositoryPath;
  const before = await captureOriginalCheckoutState(sourceRepositoryPath);
  const worktreeId = randomUUID().replaceAll("-", "");
  const requestedTemporaryParent = options.temporaryParent ?? tmpdir();
  const temporaryParent = await realpath(requestedTemporaryParent);
  const relativeTemporaryParent = relative(sourceRepositoryPath, temporaryParent);
  if (
    relativeTemporaryParent === "" ||
    (!relativeTemporaryParent.startsWith(`..${sep}`) && relativeTemporaryParent !== "..")
  ) {
    throw new GitSnapshotError(
      "UNSAFE_TEMPORARY_ROOT",
      "worktree-create",
      "Disposable worktrees must be created outside the source repository.",
    );
  }
  const temporaryRoot = await mkdtemp(
    join(resolve(temporaryParent), `prompt-tripwire-${options.kind}-`),
  );
  await chmod(temporaryRoot, 0o700);
  const worktreePath = join(temporaryRoot, "worktree");
  const branch = options.kind === "execution" ? `prompt-tripwire/execution-${worktreeId}` : null;
  const worktree: DisposableWorktree = Object.freeze({
    worktreeId: `worktree_${worktreeId}`,
    kind: options.kind,
    sourceRepositoryPath,
    path: worktreePath,
    cwd:
      prepared.inspection.workingDirectoryRelative === "."
        ? worktreePath
        : join(worktreePath, ...prepared.inspection.workingDirectoryRelative.split("/")),
    temporaryRoot,
    branch,
    snapshotHash: prepared.snapshot.snapshotHash,
    createdAt: new Date().toISOString(),
  });

  let added = false;
  try {
    const args =
      branch === null
        ? ["worktree", "add", "--detach", worktreePath, prepared.snapshot.commitSha]
        : ["worktree", "add", "-b", branch, worktreePath, prepared.snapshot.commitSha];
    await runGit(sourceRepositoryPath, args);
    added = true;
    await applyApprovedPatch(worktreePath, prepared);
    await materializeSubmodules(worktreePath, prepared.snapshot.submodules);
    const after = await captureOriginalCheckoutState(sourceRepositoryPath);
    if (!originalStatesMatch(before, after)) {
      throw new GitSnapshotError(
        "ORIGINAL_CHECKOUT_CHANGED",
        "worktree-create",
        "The original checkout changed while the disposable worktree was created.",
      );
    }
    return worktree;
  } catch (error) {
    let cleanupFailed = false;
    try {
      if (added) cleanupFailed = !(await cleanupInternal(worktree)).success;
      else await rm(temporaryRoot, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
    let afterCleanup: OriginalCheckoutState;
    try {
      afterCleanup = await captureOriginalCheckoutState(sourceRepositoryPath);
    } catch {
      throw new GitSnapshotError(
        "WORKTREE_CLEANUP_FAILED",
        "worktree-create",
        "Failed worktree creation could not be verified as cleanly contained.",
      );
    }
    if (!originalStatesMatch(before, afterCleanup)) {
      throw new GitSnapshotError(
        "ORIGINAL_CHECKOUT_CHANGED",
        "worktree-create",
        "The original checkout changed during failed worktree creation.",
      );
    }
    if (cleanupFailed) {
      throw new GitSnapshotError(
        "WORKTREE_CLEANUP_FAILED",
        "worktree-create",
        "Failed worktree creation also reported a cleanup failure.",
      );
    }
    if (error instanceof GitSnapshotError) throw error;
    throw new GitSnapshotError(
      "GIT_COMMAND_FAILED",
      "worktree-create",
      "The disposable worktree could not be created.",
    );
  }
}
