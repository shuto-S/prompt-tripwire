import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GitSnapshotError,
  checkPreparedSnapshot,
  cleanupDisposableWorktree,
  createDisposableWorktree,
  fingerprintCheckout,
  fingerprintsMatch,
  inspectRepository,
  prepareRepositorySnapshot,
} from "../../packages/git-snapshot/dist/index.js";

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: process.env.PATH,
    },
  });
  assert.equal(result.status, 0, `git ${args[0]} failed`);
  return result.stdout.trim();
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-git-fixture-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "PromptTripwire Fixture"]);
  await writeFile(join(root, "tracked.txt"), "committed\n");
  await writeFile(join(root, "old-name.txt"), "rename me\n");
  await writeFile(join(root, "AGENTS.md"), "Repository instructions\n");
  await writeFile(join(root, ".prompt-tripwire.json"), '{"network":"deny"}\n');
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  return root;
}

function snapshotRequest(repositoryPath, overrides = {}) {
  return {
    repositoryPath,
    task: "Implement the approved fixture change",
    model: { id: "gpt-5.4", reasoningEffort: "high" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.9",
    effectiveConfig: { probeCount: 3, network: "deny" },
    createdAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

test("AC-002/AC-009: clean probe worktree contains writes without changing the source checkout", async () => {
  const repository = await createRepository();
  try {
    const hook = join(repository, ".git/hooks/post-checkout");
    await writeFile(hook, "#!/bin/sh\nexit 97\n");
    await chmod(hook, 0o755);
    const before = await fingerprintCheckout(repository);
    const prepared = await prepareRepositorySnapshot(snapshotRequest(repository));
    assert.equal(prepared.inspection.isDirty, false);
    assert.equal(prepared.snapshot.dirtyPatchHash, null);
    assert.match(prepared.snapshot.instructionHash, /^[a-f0-9]{64}$/u);
    assert.match(prepared.snapshot.configHash, /^[a-f0-9]{64}$/u);

    const probe = await createDisposableWorktree(prepared, { kind: "probe" });
    assert.equal(await readFile(join(probe.cwd, "tracked.txt"), "utf8"), "committed\n");
    await writeFile(join(probe.cwd, "probe-only.txt"), "contained\n");
    assert.equal(await pathExists(join(repository, "probe-only.txt")), false);
    assert.equal(fingerprintsMatch(before, await fingerprintCheckout(repository)), true);

    const cleanup = await cleanupDisposableWorktree(probe);
    assert.deepEqual(cleanup, { success: true, failures: [] });
    assert.equal(await pathExists(probe.temporaryRoot), false);
    assert.equal(fingerprintsMatch(before, await fingerprintCheckout(repository)), true);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("dirty checkout requires a choice, excludes untracked files, and applies the approved binary patch", async () => {
  const repository = await createRepository();
  try {
    await writeFile(join(repository, "tracked.txt"), "working change\n");
    git(repository, ["mv", "old-name.txt", "new-name.txt"]);
    await writeFile(join(repository, "untracked-secret.txt"), "excluded fixture value\n");
    await writeFile(join(repository, "AGENTS.md"), "Modified repository instructions\n");
    const before = await fingerprintCheckout(repository);

    await assert.rejects(
      prepareRepositorySnapshot(snapshotRequest(repository)),
      (error) => error instanceof GitSnapshotError && error.code === "DIRTY_CHOICE_REQUIRED",
    );
    await assert.rejects(
      prepareRepositorySnapshot(snapshotRequest(repository, { dirtyChoice: "cancel" })),
      (error) => error instanceof GitSnapshotError && error.code === "SNAPSHOT_CANCELLED",
    );

    const committed = await prepareRepositorySnapshot(
      snapshotRequest(repository, { dirtyChoice: "committed_only" }),
    );
    const included = await prepareRepositorySnapshot(
      snapshotRequest(repository, { dirtyChoice: "include_patch" }),
    );
    assert.equal(committed.snapshot.dirtyPatchHash, null);
    assert.notEqual(included.snapshot.dirtyPatchHash, null);
    assert.equal(included.excludedUntrackedFileCount, 1);
    assert.notEqual(committed.snapshot.instructionHash, included.snapshot.instructionHash);

    const committedWorktree = await createDisposableWorktree(committed, { kind: "probe" });
    assert.equal(
      await readFile(join(committedWorktree.path, "tracked.txt"), "utf8"),
      "committed\n",
    );
    assert.equal(await pathExists(join(committedWorktree.path, "old-name.txt")), true);
    assert.equal(await pathExists(join(committedWorktree.path, "untracked-secret.txt")), false);

    const includedWorktree = await createDisposableWorktree(included, { kind: "probe" });
    assert.equal(
      await readFile(join(includedWorktree.path, "tracked.txt"), "utf8"),
      "working change\n",
    );
    assert.equal(await pathExists(join(includedWorktree.path, "old-name.txt")), false);
    assert.equal(await pathExists(join(includedWorktree.path, "new-name.txt")), true);
    assert.equal(await pathExists(join(includedWorktree.path, "untracked-secret.txt")), false);

    assert.equal((await cleanupDisposableWorktree(committedWorktree)).success, true);
    assert.equal((await cleanupDisposableWorktree(includedWorktree)).success, true);
    assert.equal(fingerprintsMatch(before, await fingerprintCheckout(repository)), true);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("detached HEAD and local submodule SHAs are captured and materialized without network fetch", async () => {
  const parent = await mkdtemp(join(tmpdir(), "prompt-tripwire-submodule-fixture-"));
  const submodule = join(parent, "submodule-source");
  const repository = join(parent, "repository");
  try {
    await Promise.all([mkdir(submodule), mkdir(repository)]);

    git(submodule, ["init", "-b", "main"]);
    git(submodule, ["config", "user.email", "fixture@example.invalid"]);
    git(submodule, ["config", "user.name", "PromptTripwire Fixture"]);
    await writeFile(join(submodule, "submodule.txt"), "submodule content\n");
    git(submodule, ["add", "."]);
    git(submodule, ["commit", "-m", "submodule"]);

    git(repository, ["init", "-b", "main"]);
    git(repository, ["config", "user.email", "fixture@example.invalid"]);
    git(repository, ["config", "user.name", "PromptTripwire Fixture"]);
    await writeFile(join(repository, "root.txt"), "root\n");
    git(repository, ["add", "."]);
    git(repository, ["commit", "-m", "root"]);
    git(repository, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      submodule,
      "deps/sub",
    ]);
    git(repository, ["commit", "-am", "add submodule"]);
    git(repository, ["checkout", "--detach", "HEAD"]);

    const prepared = await prepareRepositorySnapshot(snapshotRequest(repository));
    assert.equal(prepared.snapshot.branch, null);
    assert.equal(Object.keys(prepared.snapshot.submodules).length, 1);
    const worktree = await createDisposableWorktree(prepared, { kind: "probe" });
    assert.equal(
      await readFile(join(worktree.path, "deps/sub/submodule.txt"), "utf8"),
      "submodule content\n",
    );
    assert.equal((await cleanupDisposableWorktree(worktree)).success, true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("AC-008: commit and effective configuration drift prevent worktree creation", async () => {
  const repository = await createRepository();
  try {
    const prepared = await prepareRepositorySnapshot(snapshotRequest(repository));
    const configDrift = await checkPreparedSnapshot(prepared, {
      effectiveConfig: { probeCount: 2, network: "deny" },
    });
    assert.equal(configDrift.stale, true);
    assert.deepEqual(configDrift.reasons, ["config"]);

    await writeFile(join(repository, "tracked.txt"), "new commit\n");
    git(repository, ["add", "tracked.txt"]);
    git(repository, ["commit", "-m", "drift"]);
    const commitDrift = await checkPreparedSnapshot(prepared);
    assert.equal(commitDrift.stale, true);
    assert.ok(commitDrift.reasons.includes("commit"));
    const beforeRejectedRun = await fingerprintCheckout(repository);
    await assert.rejects(
      createDisposableWorktree(prepared, { kind: "execution" }),
      (error) => error instanceof GitSnapshotError && error.code === "STALE_SNAPSHOT",
    );
    assert.equal(fingerprintsMatch(beforeRejectedRun, await fingerprintCheckout(repository)), true);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("AC-012: contract amendment gets a fresh execution worktree and cleanup failures are reported", async () => {
  const repository = await createRepository();
  try {
    const prepared = await prepareRepositorySnapshot(snapshotRequest(repository));
    const first = await createDisposableWorktree(prepared, { kind: "execution" });
    await writeFile(join(first.path, "partial-change.txt"), "untrusted partial state\n");
    const amended = await createDisposableWorktree(prepared, { kind: "execution" });
    assert.notEqual(first.path, amended.path);
    assert.notEqual(first.branch, amended.branch);
    assert.equal(await pathExists(join(amended.path, "partial-change.txt")), false);
    assert.equal((await cleanupDisposableWorktree(first)).success, true);
    assert.equal((await cleanupDisposableWorktree(amended)).success, true);

    const forFailureReport = await createDisposableWorktree(prepared, { kind: "execution" });
    const cleanup = await cleanupDisposableWorktree({
      ...forFailureReport,
      branch: "prompt-tripwire/nonexistent-cleanup-branch",
    });
    assert.equal(cleanup.success, false);
    assert.deepEqual(
      cleanup.failures.map((failure) => failure.step),
      ["branch_delete"],
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("porcelain inspection recognizes a clean repository", async () => {
  const repository = await createRepository();
  try {
    const inspection = await inspectRepository(repository);
    assert.equal(inspection.branch, "main");
    assert.equal(inspection.isDirty, false);
    assert.deepEqual(inspection.changes, []);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
