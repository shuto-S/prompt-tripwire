import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatCliError, runCli } from "../../apps/cli/dist/index.js";
import { LocalController } from "../../apps/controller/dist/index.js";
import {
  createExecutionContract,
  createRepositorySnapshot,
} from "../../packages/domain/dist/index.js";
import { PersistenceError, SqlitePersistence } from "../../packages/persistence/dist/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function snapshot(overrides = {}) {
  return createRepositorySnapshot({
    repositoryPath: "/tmp/prompt-tripwire-fixture",
    commitSha: "1".repeat(40),
    branch: "main",
    submodules: {},
    dirtyPatchHash: null,
    instructionHash: HASH_A,
    configHash: HASH_B,
    task: "Implement the approved behavior",
    model: { id: "gpt-5.4", reasoningEffort: "high" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.0",
    createdAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  });
}

function contract(runId, repositorySnapshot, overrides = {}) {
  return createExecutionContract({
    version: 1,
    runId,
    snapshotHash: repositorySnapshot.snapshotHash,
    taskHash: repositorySnapshot.taskHash,
    approvedGoal: "Implement only the approved behavior",
    approvedBehaviors: ["return a validated result"],
    approvedAssumptions: ["the existing API remains compatible"],
    allowedComponents: ["domain"],
    allowedPaths: ["packages/domain/src/index.ts"],
    protectedPaths: [".env"],
    allowedCommandClasses: ["test"],
    deniedCommandClasses: ["deploy"],
    networkPolicy: { mode: "deny", hosts: [], actions: [] },
    dependencyPolicy: { mode: "deny", allowed: [] },
    dataPolicy: { mode: "deny", allowed: [] },
    externalEffectPolicy: { mode: "deny", allowed: [] },
    requiredChecks: ["npm run test:unit"],
    stopConditions: ["snapshot drift"],
    humanDecisions: [],
    unresolvedNonBlockingUnknowns: [],
    modelVersions: { codex: "gpt-5.4", comparator: "gpt-5.6", policy: "1" },
    createdAt: "2026-07-14T00:02:00.000Z",
    approvedAt: null,
    ...overrides,
  });
}

function runRecord(runId, repositorySnapshot, overrides = {}) {
  return {
    runId,
    state: "created",
    version: 0,
    snapshotHash: repositorySnapshot.snapshotHash,
    taskHash: repositorySnapshot.taskHash,
    activeContractId: null,
    blockingDecisionIds: [],
    lastErrorCode: null,
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

async function storage() {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-persistence-"));
  return {
    root,
    databasePath: join(root, "private", "prompt-tripwire.sqlite3"),
    artifactRoot: join(root, "private", "artifacts"),
  };
}

function open(paths) {
  return new SqlitePersistence({
    databasePath: paths.databasePath,
    artifactRoot: paths.artifactRoot,
  });
}

function prepared(repositorySnapshot) {
  return {
    snapshot: repositorySnapshot,
    patch: null,
    inspection: {
      repositoryPath: repositorySnapshot.repositoryPath,
      workingDirectory: repositorySnapshot.repositoryPath,
      workingDirectoryRelative: ".",
      commitSha: repositorySnapshot.commitSha,
      branch: repositorySnapshot.branch,
      submodules: repositorySnapshot.submodules,
      changes: [],
      trackedChangeCount: 0,
      untrackedFileCount: 0,
      isDirty: false,
      hasUnrepresentableSubmoduleChange: false,
    },
    excludedUntrackedFileCount: 0,
    parameters: {
      repositoryPath: repositorySnapshot.repositoryPath,
      task: repositorySnapshot.task,
      model: repositorySnapshot.model,
      codexVersion: repositorySnapshot.codexVersion,
      promptTripwireVersion: repositorySnapshot.promptTripwireVersion,
      contentMode: "committed_only",
      effectiveConfigHash: repositorySnapshot.configHash,
      configPaths: [],
      externalInstructionHashes: {},
    },
  };
}

test("AC-016: restart preserves paused/unapproved runs and recovers running to paused", async () => {
  const paths = await storage();
  const repositorySnapshot = snapshot();
  let store = open(paths);
  store.createRun(
    runRecord("run_paused", repositorySnapshot, {
      state: "paused",
      version: 8,
      lastErrorCode: "USER_REVIEW",
    }),
  );
  store.createRun(
    runRecord("run_unapproved", repositorySnapshot, { state: "needs_review", version: 3 }),
  );
  store.createRun(
    runRecord("run_interrupted", repositorySnapshot, { state: "comparing", version: 3 }),
  );
  store.saveSnapshot("run_interrupted", repositorySnapshot);
  const interruptedDraft = contract("run_interrupted", repositorySnapshot);
  const interruptedReady = store.saveContractAndReady("run_interrupted", interruptedDraft, 3);
  const interruptedApproved = store.approveContract({
    idempotencyKey: "approve-interrupted",
    runId: "run_interrupted",
    contractId: interruptedDraft.contractId,
    expectedVersion: interruptedReady.version,
    approvedAt: "2026-07-14T00:05:00.000Z",
  });
  store.startExecution({
    idempotencyKey: "start-interrupted",
    runId: "run_interrupted",
    contractId: interruptedDraft.contractId,
    currentSnapshot: repositorySnapshot,
    expectedVersion: interruptedApproved.run.version,
    startedAt: "2026-07-14T00:06:00.000Z",
  });
  store.close();

  store = open(paths);
  const controller = new LocalController({ store });
  const recovered = controller.start();
  assert.equal(recovered.length, 1);
  assert.equal(store.getRun("run_paused").run.state, "paused");
  assert.equal(store.getRun("run_unapproved").run.state, "needs_review");
  assert.deepEqual(
    {
      state: store.getRun("run_interrupted").run.state,
      error: store.getRun("run_interrupted").run.lastErrorCode,
    },
    { state: "paused", error: "CONTROLLER_RESTART" },
  );
  assert.throws(
    () =>
      store.approveContract({
        idempotencyKey: "uncertain-reapproval",
        runId: "run_interrupted",
        contractId: interruptedDraft.contractId,
        expectedVersion: store.getRun("run_interrupted").run.version,
        approvedAt: "2026-07-14T00:10:00.000Z",
      }),
    (error) => error?.code === "INVALID_TRANSITION",
  );
  await controller.stop();

  assert.equal((await stat(paths.databasePath)).mode & 0o777, 0o600);
  assert.equal((await stat(paths.artifactRoot)).mode & 0o777, 0o700);
});

test("duplicate events and approvals are idempotent while conflicting reuse fails", async () => {
  const paths = await storage();
  const store = open(paths);
  const repositorySnapshot = snapshot();
  store.createRun(runRecord("run_events", repositorySnapshot));
  const eventInput = {
    idempotencyKey: "event-key-1",
    runId: "run_events",
    eventType: "run.snapshotting",
    payload: { token: "not-stored", phase: "snapshot" },
    occurredAt: "2026-07-14T00:01:00.000Z",
    transition: { expectedVersion: 0, nextState: "snapshotting" },
  };
  const firstEvent = store.ingestEvent(eventInput);
  const repeatedEvent = store.ingestEvent(eventInput);
  assert.deepEqual(repeatedEvent, firstEvent);
  assert.equal(store.getRun("run_events").run.version, 1);
  assert.equal(store.listEvents("run_events").length, 1);
  assert.deepEqual(store.listEvents("run_events")[0].payload, {
    phase: "snapshot",
    token: "[REDACTED]",
  });
  assert.throws(
    () =>
      store.ingestEvent({
        ...eventInput,
        payload: { ...eventInput.payload, createdAt: "2026-07-14T00:01:01.000Z" },
      }),
    (error) => error instanceof PersistenceError && error.code === "CONFLICTING_IDEMPOTENCY_KEY",
  );
  store.recordLog(
    "info",
    "probe.completed",
    { rawReasoning: "must not persist", apiKey: "synthetic-secret-value" },
    "run_events",
    "2026-07-14T00:02:00.000Z",
  );
  assert.deepEqual(store.listLogs("run_events")[0].fields, {
    apiKey: "[REDACTED]",
    rawReasoning: "[REDACTED]",
  });

  store.createRun(
    runRecord("run_approval", repositorySnapshot, { state: "comparing", version: 3 }),
  );
  store.saveSnapshot("run_approval", repositorySnapshot);
  const draft = contract("run_approval", repositorySnapshot);
  const ready = store.saveContractAndReady("run_approval", draft, 3);
  const approvalInput = {
    idempotencyKey: "approval-key-1",
    runId: "run_approval",
    contractId: draft.contractId,
    expectedVersion: ready.version,
    approvedAt: "2026-07-14T00:04:00.000Z",
  };
  const firstApproval = store.approveContract(approvalInput);
  const repeatedApproval = store.approveContract(approvalInput);
  assert.deepEqual(repeatedApproval, firstApproval);
  assert.equal(store.getRun("run_approval").run.version, ready.version + 1);
  assert.throws(
    () => store.approveContract({ ...approvalInput, expectedVersion: ready.version + 1 }),
    (error) => error instanceof PersistenceError && error.code === "CONFLICTING_IDEMPOTENCY_KEY",
  );
  store.close();
});

test("inspect performs read-only planning only and run rejects unapproved or stale contracts", async () => {
  const paths = await storage();
  const store = open(paths);
  const repositorySnapshot = snapshot();
  let executionStarts = 0;
  const executionPort = {
    async start() {
      executionStarts += 1;
      return { outcome: "completed", errorCode: null };
    },
    async interrupt() {},
  };
  const controller = new LocalController({
    store,
    prepareSnapshot: async () => prepared(repositorySnapshot),
    inspectionPort: {
      async inspect(context) {
        return {
          blockingDecisionIds: [],
          contract: contract(context.run.runId, repositorySnapshot),
        };
      },
    },
    executionPort,
  });
  controller.start();
  const inspected = await controller.inspect({
    runId: "run_controller",
    repositoryPath: repositorySnapshot.repositoryPath,
    task: repositorySnapshot.task,
    model: repositorySnapshot.model,
    codexVersion: repositorySnapshot.codexVersion,
    promptTripwireVersion: repositorySnapshot.promptTripwireVersion,
  });
  assert.equal(inspected.state, "ready_for_approval");
  assert.equal(executionStarts, 0, "inspect must not start implementation");

  await assert.rejects(
    controller.run({
      contractId: inspected.activeContractId,
      currentSnapshot: repositorySnapshot,
      expectedVersion: inspected.version,
      idempotencyKey: "start-unapproved",
    }),
  );
  assert.equal(executionStarts, 0);

  const approved = store.approveContract({
    idempotencyKey: "approve-controller",
    runId: inspected.runId,
    contractId: inspected.activeContractId,
    expectedVersion: inspected.version,
    approvedAt: "2026-07-14T00:05:00.000Z",
  });
  const completed = await controller.run({
    contractId: approved.contract.contractId,
    currentSnapshot: repositorySnapshot,
    expectedVersion: approved.run.version,
    idempotencyKey: "start-valid",
  });
  assert.equal(completed.state, "completed");
  assert.equal(executionStarts, 1);
  const replayed = await controller.run({
    contractId: approved.contract.contractId,
    currentSnapshot: repositorySnapshot,
    expectedVersion: approved.run.version,
    idempotencyKey: "start-valid",
  });
  assert.equal(replayed.state, "completed");
  assert.equal(executionStarts, 1, "idempotent start must not launch implementation twice");

  const staleCandidate = await controller.inspect({
    runId: "run_stale",
    repositoryPath: repositorySnapshot.repositoryPath,
    task: repositorySnapshot.task,
    model: repositorySnapshot.model,
    codexVersion: repositorySnapshot.codexVersion,
    promptTripwireVersion: repositorySnapshot.promptTripwireVersion,
  });
  const staleApproval = store.approveContract({
    idempotencyKey: "approve-stale",
    runId: staleCandidate.runId,
    contractId: staleCandidate.activeContractId,
    expectedVersion: staleCandidate.version,
    approvedAt: "2026-07-14T00:06:00.000Z",
  });
  const stale = snapshot({ commitSha: "2".repeat(40) });
  await assert.rejects(
    controller.run({
      contractId: staleApproval.contract.contractId,
      currentSnapshot: stale,
      expectedVersion: staleApproval.run.version,
      idempotencyKey: "start-stale",
    }),
  );
  assert.equal(store.getRun("run_stale").run.state, "stale");
  assert.equal(executionStarts, 1);
  await controller.stop();
});

test("FR-015: JSON and Markdown reports are sanitized private artifacts", async () => {
  const paths = await storage();
  const store = open(paths);
  const repositorySnapshot = snapshot();
  store.createRun(runRecord("run_report", repositorySnapshot, { state: "completed", version: 7 }));
  const controller = new LocalController({ store });
  controller.start();
  assert.notEqual(store.getRun("run_report").retention.retainUntil, null);
  const report = controller.report({
    runId: "run_report",
    report: {
      reportVersion: 1,
      runId: "run_report",
      state: "completed",
      snapshotHash: repositorySnapshot.snapshotHash,
      taskHash: repositorySnapshot.taskHash,
      contractId: null,
      contractHash: null,
      threadIds: ["thread_1"],
      modelIds: ["gpt-5.4"],
      decisions: [],
      observedActions: [],
      diffSummary: { changedPaths: [], withinContract: true, evidenceRefs: [] },
      checks: [],
      deviations: [],
      remainingUnknowns: ["api_key=synthetic-secret-value"],
      generatedAt: "2026-07-14T00:08:00.000Z",
    },
  });
  assert.equal(report.remainingUnknowns[0], "[REDACTED]");
  const stored = store.getReport("run_report");
  const json = store.readArtifact(stored.jsonArtifact.artifactId).toString("utf8");
  const markdown = store.readArtifact(stored.markdownArtifact.artifactId).toString("utf8");
  assert.equal(json.includes("synthetic-secret-value"), false);
  assert.equal(markdown.includes("synthetic-secret-value"), false);
  assert.equal(JSON.parse(json).reportVersion, 1);
  assert.match(markdown, /^# PromptTripwire run run\\_report/mu);
  assert.equal(
    (await stat(join(paths.artifactRoot, stored.jsonArtifact.relativePath))).mode & 0o777,
    0o600,
  );
  const exported = join(paths.root, "explicit-report.json");
  controller.exportReport("run_report", "json", exported);
  assert.equal(JSON.parse(await readFile(exported, "utf8")).reportVersion, 1);
  assert.equal((await stat(exported)).mode & 0o777, 0o600);
  assert.throws(() => controller.exportReport("run_report", "json", exported));
  await controller.stop();
});

test("FR-016: timeout pauses safely, cancellation sets retention, and cleanup failure is tracked", async () => {
  const paths = await storage();
  const store = open(paths);
  const repositorySnapshot = snapshot();
  store.createRun(runRecord("run_timeout", repositorySnapshot, { state: "comparing", version: 3 }));
  store.saveSnapshot("run_timeout", repositorySnapshot);
  const draft = contract("run_timeout", repositorySnapshot);
  const ready = store.saveContractAndReady("run_timeout", draft, 3);
  const approved = store.approveContract({
    idempotencyKey: "approve-timeout",
    runId: "run_timeout",
    contractId: draft.contractId,
    expectedVersion: ready.version,
    approvedAt: "2026-07-14T00:05:00.000Z",
  });
  let interrupts = 0;
  const controller = new LocalController({
    store,
    executionTimeoutMs: 5,
    executionPort: {
      async start({ signal }) {
        return await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      async interrupt() {
        interrupts += 1;
      },
    },
  });
  controller.start();
  const paused = await controller.run({
    contractId: draft.contractId,
    currentSnapshot: repositorySnapshot,
    expectedVersion: approved.run.version,
    idempotencyKey: "start-timeout",
  });
  assert.equal(paused.state, "paused");
  assert.equal(paused.lastErrorCode, "OPERATION_TIMEOUT");
  assert.equal(interrupts, 1);
  assert.equal(store.getRun(paused.runId).retention.retainUntil, null);

  const cancelled = await controller.cancel(paused.runId);
  assert.equal(cancelled.state, "cancelled");
  assert.notEqual(store.getRun(paused.runId).retention.retainUntil, null);

  store.recordWorktree({
    worktreeId: "worktree_timeout",
    runId: paused.runId,
    kind: "execution",
    path: "/tmp/disposable-worktree",
    branch: "prompt-tripwire/run_timeout",
    snapshotHash: repositorySnapshot.snapshotHash,
    createdAt: "2026-07-14T00:05:00.000Z",
  });
  store.recordWorktreeCleanup({
    worktreeId: "worktree_timeout",
    status: "failed",
    cleanedAt: "2026-07-14T00:06:00.000Z",
    errorCode: "WORKTREE_CLEANUP_FAILED",
  });
  assert.deepEqual(
    {
      status: store.getWorktree("worktree_timeout").cleanupStatus,
      error: store.getWorktree("worktree_timeout").cleanupErrorCode,
    },
    { status: "failed", error: "WORKTREE_CLEANUP_FAILED" },
  );
  await controller.stop();
});

test("FR-016: archived runs survive expiry while explicit and scheduled deletion remove private data", async () => {
  const paths = await storage();
  const store = open(paths);
  const repositorySnapshot = snapshot();
  store.createRun(
    runRecord("run_retention", repositorySnapshot, {
      state: "completed",
      version: 7,
      updatedAt: "2026-07-01T00:00:00.000Z",
    }),
    "2026-07-01T00:00:00.000Z",
  );
  store.saveSnapshot("run_retention", repositorySnapshot);
  const controller = new LocalController({
    store,
    now: () => "2026-07-14T00:00:00.000Z",
  });
  controller.start();
  try {
    store.ingestEvent({
      idempotencyKey: "retention-event-key",
      runId: "run_retention",
      eventType: "retention.fixture",
      payload: { state: "completed" },
      occurredAt: "2026-07-01T00:00:30.000Z",
    });
    controller.report({
      runId: "run_retention",
      report: {
        reportVersion: 1,
        runId: "run_retention",
        state: "completed",
        snapshotHash: repositorySnapshot.snapshotHash,
        taskHash: repositorySnapshot.taskHash,
        contractId: null,
        contractHash: null,
        threadIds: [],
        modelIds: [],
        decisions: [],
        observedActions: [],
        diffSummary: { changedPaths: [], withinContract: true, evidenceRefs: [] },
        checks: [],
        deviations: [],
        remainingUnknowns: [],
        generatedAt: "2026-07-01T00:01:00.000Z",
      },
    });
    const stored = store.getReport("run_retention");
    const artifactPath = join(paths.artifactRoot, stored.jsonArtifact.relativePath);
    assert.equal((await stat(artifactPath)).isFile(), true);

    assert.equal(controller.archive("run_retention").retention.pinned, true);
    assert.deepEqual(controller.purgeExpired(), []);
    assert.equal(store.getRun("run_retention").run.state, "completed");

    assert.equal(controller.archive("run_retention", false).retention.pinned, false);
    assert.deepEqual(controller.purgeExpired(), ["run_retention"]);
    assert.throws(
      () => store.getRun("run_retention"),
      (error) => error instanceof PersistenceError && error.code === "NOT_FOUND",
    );
    assert.throws(
      () => store.getSnapshot(repositorySnapshot.snapshotHash),
      (error) => error instanceof PersistenceError && error.code === "NOT_FOUND",
    );
    await assert.rejects(stat(artifactPath), { code: "ENOENT" });

    store.createRun(runRecord("run_retention_reuse", repositorySnapshot));
    assert.equal(
      store.ingestEvent({
        idempotencyKey: "retention-event-key",
        runId: "run_retention_reuse",
        eventType: "retention.fixture",
        payload: { state: "reused" },
        occurredAt: "2026-07-14T00:00:01.000Z",
      }).runId,
      "run_retention_reuse",
    );
  } finally {
    await controller.stop();
  }
});

test("FR-016: deletion refuses active executions and pending worktrees", async () => {
  const paths = await storage();
  const store = open(paths);
  const repositorySnapshot = snapshot();
  store.createRun(
    runRecord("run_delete_active", repositorySnapshot, { state: "running", version: 7 }),
  );
  assert.throws(
    () => store.deleteRun("run_delete_active"),
    (error) => error instanceof PersistenceError && error.code === "RUN_NOT_DELETABLE",
  );

  store.createRun(
    runRecord("run_delete_pending", repositorySnapshot, { state: "paused", version: 7 }),
  );
  store.recordWorktree({
    worktreeId: "worktree_delete_pending",
    runId: "run_delete_pending",
    kind: "execution",
    path: "/tmp/prompt-tripwire-delete-pending",
    branch: null,
    snapshotHash: repositorySnapshot.snapshotHash,
    createdAt: "2026-07-14T00:00:00.000Z",
  });
  assert.throws(
    () => store.deleteRun("run_delete_pending"),
    (error) => error instanceof PersistenceError && error.code === "RUN_NOT_DELETABLE",
  );
  store.close();
});

test("FR-001 fixture accepts task text and a UTF-8 task file", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-task-fixture-"));
  try {
    const repository = join(root, "repository");
    const init = spawnSync("git", ["init", "-b", "main", repository], { encoding: "utf8" });
    assert.equal(init.status, 0);
    await writeFile(join(repository, "tracked.txt"), "fixture\n");
    for (const args of [
      ["-C", repository, "config", "user.email", "fixture@example.invalid"],
      ["-C", repository, "config", "user.name", "PromptTripwire Fixture"],
      ["-C", repository, "add", "tracked.txt"],
      ["-C", repository, "commit", "-m", "fixture"],
    ]) {
      assert.equal(spawnSync("git", args, { encoding: "utf8" }).status, 0);
    }
    const taskFile = join(root, "task.md");
    await writeFile(taskFile, "Implement from UTF-8 task file: 日本語\n");
    assert.equal((await readFile(taskFile, "utf8")).includes("日本語"), true);

    for (const [name, taskArgs] of [
      ["text", ["--task", "Implement from task text"]],
      ["file", ["--task-file", taskFile]],
    ]) {
      let stdout = "";
      let executionStarts = 0;
      const exitCode = await runCli(["inspect", ...taskArgs, "--repo", repository], {
        dataRoot: join(root, `data-${name}`),
        io: {
          stdout: { write: (value) => (stdout += value) },
          stderr: { write: () => undefined },
        },
        createController: (store) =>
          new LocalController({
            store,
            inspectionPort: {
              async inspect(context) {
                return {
                  blockingDecisionIds: [],
                  contract: contract(context.run.runId, context.preparedSnapshot.snapshot),
                };
              },
            },
            executionPort: {
              async start() {
                executionStarts += 1;
                return { outcome: "completed", errorCode: null };
              },
              async interrupt() {},
            },
          }),
      });
      assert.equal(exitCode, 0);
      assert.match(stdout, /State: ready_for_approval/u);
      assert.equal(executionStarts, 0);
    }

    await writeFile(join(repository, "tracked.txt"), "dirty fixture\n");
    await assert.rejects(
      runCli(["inspect", "--task", "Dirty checkout requires a choice", "--repo", repository], {
        dataRoot: join(root, "data-dirty"),
        createController: (store) =>
          new LocalController({
            store,
            inspectionPort: {
              async inspect(context) {
                return {
                  blockingDecisionIds: [],
                  contract: contract(context.run.runId, context.preparedSnapshot.snapshot),
                };
              },
            },
          }),
      }),
      (error) =>
        error !== null && typeof error === "object" && error.code === "DIRTY_CHOICE_REQUIRED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-006/AC-015: inspect opens the Decision Inbox only when review is useful", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-inspect-review-fixture-"));
  try {
    const repository = join(root, "repository");
    assert.equal(spawnSync("git", ["init", "-b", "main", repository]).status, 0);
    await writeFile(join(repository, "tracked.txt"), "fixture\n");
    for (const args of [
      ["-C", repository, "config", "user.email", "fixture@example.invalid"],
      ["-C", repository, "config", "user.name", "PromptTripwire Fixture"],
      ["-C", repository, "add", "tracked.txt"],
      ["-C", repository, "commit", "-m", "fixture"],
    ]) {
      assert.equal(spawnSync("git", args).status, 0);
    }
    let stdout = "";
    let openedRunId = null;
    let closed = false;
    let waited = false;
    const exitCode = await runCli(
      ["inspect", "--task", "Choose one implementation", "--repo", repository],
      {
        dataRoot: join(root, "data"),
        io: {
          stdout: { write: (value) => (stdout += value) },
          stderr: { write: () => undefined },
        },
        createController: (store) =>
          new LocalController({
            store,
            inspectionPort: {
              async inspect() {
                return { blockingDecisionIds: ["decision_fixture"], contract: null };
              },
            },
          }),
        async startReviewServer({ runId }) {
          openedRunId = runId;
          return {
            url: `http://127.0.0.1:43127/runs/${runId}#token=fixture`,
            async close() {
              closed = true;
            },
          };
        },
        async waitForShutdownSignal() {
          waited = true;
        },
      },
    );
    assert.equal(exitCode, 0);
    assert.match(stdout, /State: needs_review/u);
    assert.match(stdout, /Decision Inbox: http:\/\/127\.0\.0\.1:43127/u);
    assert.match(openedRunId, /^run_/u);
    assert.equal(waited, true);
    assert.equal(closed, true);

    let terminalOutput = "";
    assert.equal(
      await runCli(
        ["inspect", "--task", "Choose one implementation", "--repo", repository, "--terminal"],
        {
          dataRoot: join(root, "data-terminal"),
          io: {
            stdout: { write: (value) => (terminalOutput += value) },
            stderr: { write: () => undefined },
          },
          createController: (store) =>
            new LocalController({
              store,
              inspectionPort: {
                async inspect() {
                  return { blockingDecisionIds: ["decision_fixture"], contract: null };
                },
              },
            }),
        },
      ),
      0,
    );
    assert.match(terminalOutput, /Next: tripwire review run_.+ --terminal/u);
    assert.doesNotMatch(terminalOutput, /Decision Inbox:/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("FR-002/AC-019: CLI errors give safe, actionable setup guidance", () => {
  assert.equal(
    formatCliError({ code: "DIRTY_CHOICE_REQUIRED" }),
    "DIRTY_CHOICE_REQUIRED: the checkout is dirty; rerun with --dirty committed or --dirty include\n",
  );
  assert.equal(
    formatCliError(
      Object.assign(new Error("Codex 0.144.4 is required; detected 0.143.0"), {
        code: "CODEX_VERSION_MISMATCH",
      }),
    ),
    "CODEX_VERSION_MISMATCH: Codex 0.144.4 is required; detected 0.143.0\n",
  );
  assert.equal(
    formatCliError(new Error("contains private implementation detail")),
    "CLI_ERROR: request failed\n",
  );
});
