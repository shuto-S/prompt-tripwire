import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../../apps/cli/dist/index.js";
import { LocalController } from "../../apps/controller/dist/index.js";
import { createExecutionContract } from "../../packages/domain/dist/index.js";
import { prepareRepositorySnapshot } from "../../packages/git-snapshot/dist/index.js";
import { SqlitePersistence } from "../../packages/persistence/dist/index.js";

const NOW = "2026-07-14T13:00:00.000Z";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

async function seedApprovedRun(repositoryPath, dataRoot) {
  const prepared = await prepareRepositorySnapshot({
    repositoryPath,
    task: "Run the approved CLI execution",
    model: { id: "gpt-5.4", reasoningEffort: "high" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.7",
    dirtyChoice: "committed_only",
  });
  const store = new SqlitePersistence({
    databasePath: join(dataRoot, "prompt-tripwire.sqlite3"),
    artifactRoot: join(dataRoot, "artifacts"),
  });
  const runId = "run_cli_execution";
  store.createRun(
    {
      runId,
      state: "created",
      version: 0,
      snapshotHash: prepared.snapshot.snapshotHash,
      taskHash: prepared.snapshot.taskHash,
      activeContractId: null,
      blockingDecisionIds: [],
      lastErrorCode: null,
      updatedAt: NOW,
    },
    NOW,
  );
  store.saveSnapshot(runId, prepared.snapshot);
  const snapshotting = store.transitionRun(runId, "snapshotting", 0, NOW);
  const probing = store.transitionRun(runId, "probing", snapshotting.version, NOW);
  const comparing = store.transitionRun(runId, "comparing", probing.version, NOW);
  const contract = createExecutionContract({
    version: 1,
    runId,
    snapshotHash: prepared.snapshot.snapshotHash,
    taskHash: prepared.snapshot.taskHash,
    approvedGoal: "Run the approved CLI execution",
    approvedBehaviors: ["CLI reaches the execution adapter."],
    approvedAssumptions: [],
    allowedComponents: ["fixture"],
    allowedPaths: ["src/allowed.txt"],
    protectedPaths: [".git/**", ".env"],
    allowedCommandClasses: ["test"],
    deniedCommandClasses: ["dependency", "network", "remote_write"],
    networkPolicy: { mode: "deny", hosts: [], actions: [] },
    dependencyPolicy: { mode: "deny", allowed: [] },
    dataPolicy: { mode: "deny", allowed: [] },
    externalEffectPolicy: { mode: "deny", allowed: [] },
    requiredChecks: ["npm test"],
    stopConditions: ["snapshot drift"],
    humanDecisions: [],
    unresolvedNonBlockingUnknowns: [],
    modelVersions: { codex: "gpt-5.4", comparator: "gpt-5.6", policy: "deterministic-v1" },
    createdAt: NOW,
    approvedAt: null,
  });
  const ready = store.saveContractAndReady(runId, contract, comparing.version, NOW);
  const approved = store.approveContract({
    idempotencyKey: "approve:run_cli_execution",
    runId,
    contractId: contract.contractId,
    expectedVersion: ready.version,
    approvedAt: NOW,
  });
  store.close();
  return { contract: approved.contract, prepared };
}

test("AC-019 E2E: tripwire run passes the approved prepared snapshot and persists execution evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-cli-execution-"));
  const repositoryPath = join(root, "repository");
  const dataRoot = join(root, "data");
  await mkdir(join(repositoryPath, "src"), { recursive: true });
  await writeFile(join(repositoryPath, "src", "allowed.txt"), "before\n", "utf8");
  git(repositoryPath, ["init", "-q"]);
  git(repositoryPath, ["config", "user.email", "fixture@example.test"]);
  git(repositoryPath, ["config", "user.name", "Fixture"]);
  git(repositoryPath, ["add", "."]);
  git(repositoryPath, ["commit", "-qm", "fixture"]);
  const seeded = await seedApprovedRun(repositoryPath, dataRoot);
  const stdout = [];
  let observedPreparedHash = null;
  try {
    const exitCode = await runCli(["run", "--contract", seeded.contract.contractId], {
      cwd: repositoryPath,
      dataRoot,
      io: {
        stdout: { write: (value) => stdout.push(String(value)) },
        stderr: { write: () => undefined },
      },
      createController: (store) =>
        new LocalController({
          store,
          executionPort: {
            async start(context) {
              observedPreparedHash = context.preparedSnapshot?.snapshot.snapshotHash ?? null;
              return {
                outcome: "completed",
                errorCode: null,
                evidence: {
                  threadIds: ["thread_cli_execution"],
                  modelIds: ["gpt-5.4", "gpt-5.6"],
                  observedActions: [
                    {
                      actionId: "action_cli_check",
                      kind: "check",
                      summary: "required check passed",
                      outcome: "completed",
                      evidenceRefs: ["evidence_cli_check"],
                    },
                  ],
                  changedPaths: ["src/allowed.txt"],
                  diffWithinContract: true,
                  diffEvidenceRefs: ["evidence_cli_diff"],
                  checks: [
                    {
                      checkId: "check_cli",
                      command: "npm test",
                      outcome: "passed",
                      exitCode: 0,
                      reason: null,
                      evidenceRefs: ["evidence_cli_check"],
                    },
                  ],
                  deviations: [],
                  remainingUnknowns: [],
                },
              };
            },
            async interrupt() {},
          },
        }),
    });
    assert.equal(exitCode, 0);
    assert.equal(observedPreparedHash, seeded.prepared.snapshot.snapshotHash);
    assert.match(stdout.join(""), /completed/u);

    const reopened = new SqlitePersistence({
      databasePath: join(dataRoot, "prompt-tripwire.sqlite3"),
      artifactRoot: join(dataRoot, "artifacts"),
    });
    try {
      const report = reopened.getReport("run_cli_execution").report;
      assert.deepEqual(report.threadIds, ["thread_cli_execution"]);
      assert.equal(report.checks[0].outcome, "passed");
      assert.equal(report.diffSummary.withinContract, true);
    } finally {
      reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-010/AC-015 E2E: a paused run opens the Decision Inbox", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-cli-paused-review-"));
  const repositoryPath = join(root, "repository");
  const dataRoot = join(root, "data");
  await mkdir(join(repositoryPath, "src"), { recursive: true });
  await writeFile(join(repositoryPath, "src", "allowed.txt"), "before\n", "utf8");
  git(repositoryPath, ["init", "-q"]);
  git(repositoryPath, ["config", "user.email", "fixture@example.test"]);
  git(repositoryPath, ["config", "user.name", "Fixture"]);
  git(repositoryPath, ["add", "."]);
  git(repositoryPath, ["commit", "-qm", "fixture"]);
  const seeded = await seedApprovedRun(repositoryPath, dataRoot);
  let stdout = "";
  let reviewOpened = false;
  let reviewClosed = false;
  try {
    const exitCode = await runCli(["run", "--contract", seeded.contract.contractId], {
      cwd: repositoryPath,
      dataRoot,
      io: {
        stdout: { write: (value) => (stdout += String(value)) },
        stderr: { write: () => undefined },
      },
      createController: (store) =>
        new LocalController({
          store,
          executionPort: {
            async start() {
              return { outcome: "paused", errorCode: "OUTSIDE_CONTRACT" };
            },
            async interrupt() {},
          },
        }),
      async startReviewServer({ runId }) {
        assert.equal(runId, "run_cli_execution");
        reviewOpened = true;
        return {
          url: `http://127.0.0.1:43127/runs/${runId}#token=fixture`,
          closed: new Promise(() => undefined),
          async close() {
            reviewClosed = true;
          },
        };
      },
      async waitForShutdownSignal() {},
    });
    assert.equal(exitCode, 0);
    assert.match(stdout, /State: paused/u);
    assert.match(stdout, /Decision Inbox:/u);
    assert.equal(reviewOpened, true);
    assert.equal(reviewClosed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("judge replay is explicitly recorded, read-only, and terminal-safe", async () => {
  let stdout = "";
  const exitCode = await runCli(["replay", "--terminal"], {
    io: {
      stdout: { write: (value) => (stdout += String(value)) },
      stderr: { write: () => undefined },
    },
  });
  assert.equal(exitCode, 0);
  assert.match(stdout, /Recorded replay · read-only · no Codex call or code execution/u);
  assert.match(stdout, /What should happen to persisted account data after deletion\?/u);
  assert.match(stdout, /Delete immediately/u);
  assert.match(stdout, /Retain for 30 days/u);
});
