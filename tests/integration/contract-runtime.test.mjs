import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalController } from "../../apps/controller/dist/index.js";
import { createExecutionContract } from "../../packages/domain/dist/index.js";
import { createMemoryTransportPair } from "../../packages/codex-app-server/dist/index.js";
import { ContractExecutionPort } from "../../packages/contract-runtime/dist/index.js";
import { prepareRepositorySnapshot } from "../../packages/git-snapshot/dist/index.js";
import { SqlitePersistence } from "../../packages/persistence/dist/index.js";

const NOW = "2026-07-14T12:00:00.000Z";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function repositoryFixture() {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-runtime-repo-"));
  await mkdir(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "allowed.txt"), "before\n", "utf8");
  writeFileSync(join(root, "README.md"), "runtime fixture\n", "utf8");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "fixture@example.test"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  const prepared = await prepareRepositorySnapshot({
    repositoryPath: root,
    task: "Implement the approved runtime fixture change",
    model: { id: "gpt-5.4", reasoningEffort: "high" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.0",
    dirtyChoice: "committed_only",
  });
  return { root, prepared };
}

async function storage() {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-runtime-store-"));
  return {
    root,
    store: new SqlitePersistence({
      databasePath: join(root, "private", "prompt-tripwire.sqlite3"),
      artifactRoot: join(root, "private", "artifacts"),
    }),
  };
}

function approvedContract(store, prepared, runId, overrides = {}) {
  const snapshot = prepared.snapshot;
  const initial = {
    runId,
    state: "created",
    version: 0,
    snapshotHash: snapshot.snapshotHash,
    taskHash: snapshot.taskHash,
    activeContractId: null,
    blockingDecisionIds: [],
    lastErrorCode: null,
    updatedAt: NOW,
  };
  store.createRun(initial, NOW);
  store.saveSnapshot(runId, snapshot);
  const snapshotting = store.transitionRun(runId, "snapshotting", 0, NOW);
  const probing = store.transitionRun(runId, "probing", snapshotting.version, NOW);
  const comparing = store.transitionRun(runId, "comparing", probing.version, NOW);
  const contract = createExecutionContract({
    version: 1,
    runId,
    snapshotHash: snapshot.snapshotHash,
    taskHash: snapshot.taskHash,
    approvedGoal: "Update the approved fixture file",
    approvedBehaviors: ["The approved file contains the new value."],
    approvedAssumptions: [],
    allowedComponents: ["fixture"],
    allowedPaths: ["src/allowed.txt"],
    protectedPaths: [".env", ".git/**"],
    allowedCommandClasses: ["static_read", "test", "lint", "typecheck", "build", "verification"],
    deniedCommandClasses: [
      "dependency",
      "destructive",
      "permission",
      "remote_write",
      "secret_access",
      "deploy",
      "release",
      "migration",
    ],
    networkPolicy: { mode: "deny", hosts: [], actions: [] },
    dependencyPolicy: { mode: "deny", allowed: [] },
    dataPolicy: { mode: "deny", allowed: [] },
    externalEffectPolicy: { mode: "deny", allowed: [] },
    requiredChecks: ["npm run test:unit"],
    stopConditions: ["outside path", "unknown action"],
    humanDecisions: [],
    unresolvedNonBlockingUnknowns: [],
    modelVersions: { codex: "gpt-5.4", comparator: "gpt-5.6", policy: "deterministic-v1" },
    createdAt: NOW,
    approvedAt: null,
    ...overrides,
  });
  const ready = store.saveContractAndReady(runId, contract, comparing.version, NOW);
  const approved = store.approveContract({
    idempotencyKey: `approve:${runId}:1`,
    runId,
    contractId: contract.contractId,
    expectedVersion: ready.version,
    approvedAt: NOW,
  });
  return { snapshot, contract: approved.contract, run: approved.run };
}

class FakeExecutionHarness {
  constructor(transport, scenario) {
    this.transport = transport;
    this.scenario = scenario;
    this.requests = [];
    this.responses = [];
    this.threadId = `thread_${scenario}`;
    this.turnId = `turn_${scenario}`;
    this.nextServerId = 10_000;
    this.turnCompleted = false;
    transport.onMessage((message) => this.receive(message));
  }

  receive(value) {
    if (value === null || typeof value !== "object") return;
    const message = value;
    if (typeof message.method !== "string") {
      this.responses.push(structuredClone(message));
      if (message.id === 10_000) {
        if (this.scenario === "file-approval" && message.result?.decision === "accept") {
          queueMicrotask(() => this.completeApprovedFileChange());
        } else {
          queueMicrotask(() => this.completeInterrupted());
        }
      }
      return;
    }
    this.requests.push(structuredClone(message));
    if (message.id === undefined) return;
    if (message.method === "initialize") {
      this.respond(message.id, {});
      return;
    }
    if (message.method === "thread/start") {
      this.respond(message.id, {
        thread: { id: this.threadId },
        model: message.params.model,
        reasoningEffort: "high",
      });
      return;
    }
    if (message.method === "turn/start") {
      this.cwd = message.params.cwd;
      this.respond(message.id, { turn: { id: this.turnId, status: "inProgress" } });
      queueMicrotask(() => this.startScenario());
      return;
    }
    if (message.method === "turn/interrupt") {
      this.respond(message.id, {});
      queueMicrotask(() => this.completeInterrupted());
      return;
    }
    if (message.method === "command/exec") {
      this.respond(message.id, { exitCode: 0, stdout: "ok\n", stderr: "" });
      return;
    }
    this.respond(message.id, {});
  }

  startScenario() {
    this.notify("turn/started", {
      threadId: this.threadId,
      turn: { id: this.turnId, status: "inProgress" },
    });
    if (this.scenario === "success" || this.scenario === "outside") {
      const path = this.scenario === "success" ? "src/allowed.txt" : "outside.txt";
      const item = {
        id: `file_${this.scenario}`,
        type: "fileChange",
        status: "inProgress",
        changes: [
          {
            path,
            kind: { type: this.scenario === "success" ? "update" : "add", move_path: null },
            diff: "@@ -1 +1 @@\n-before\n+after\n",
          },
        ],
      };
      this.notify("item/started", { threadId: this.threadId, turnId: this.turnId, item });
      writeFileSync(join(this.cwd, path), "after\n", "utf8");
      this.notify("item/completed", {
        threadId: this.threadId,
        turnId: this.turnId,
        item: { ...item, status: "completed" },
      });
      this.notify("turn/diff/updated", {
        threadId: this.threadId,
        turnId: this.turnId,
        diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after\n`,
      });
      this.complete("completed");
      return;
    }
    if (this.scenario === "disconnect") {
      this.transport.disconnect("fixture_disconnect");
      return;
    }
    if (this.scenario === "allowed-command") {
      this.requestApproval("item/commandExecution/requestApproval", {
        threadId: this.threadId,
        turnId: this.turnId,
        itemId: "allowed_command",
        startedAtMs: 1,
        cwd: this.cwd,
        command: "rg TODO src",
        commandActions: [{ type: "search", command: "rg TODO src", path: null, query: "TODO" }],
      });
      return;
    }
    if (this.scenario === "file-approval") {
      this.fileApprovalItem = {
        id: "file_approval",
        type: "fileChange",
        status: "inProgress",
        changes: [
          {
            path: "src/allowed.txt",
            kind: { type: "update", move_path: null },
            diff: "@@ -1 +1 @@\n-before\n+after\n",
          },
        ],
      };
      this.notify("item/started", {
        threadId: this.threadId,
        turnId: this.turnId,
        item: this.fileApprovalItem,
      });
      this.requestApproval("item/fileChange/requestApproval", {
        threadId: this.threadId,
        turnId: this.turnId,
        itemId: this.fileApprovalItem.id,
      });
      return;
    }
    if (this.scenario === "uncorrelated-file-approval") {
      this.requestApproval("item/fileChange/requestApproval", {
        threadId: this.threadId,
        turnId: this.turnId,
        itemId: "file_without_item",
      });
      return;
    }
    if (this.scenario === "empty-file-approval" || this.scenario === "outside-move-file-approval") {
      const item = {
        id: `file_${this.scenario}`,
        type: "fileChange",
        status: "inProgress",
        changes:
          this.scenario === "empty-file-approval"
            ? []
            : [
                {
                  path: "src/allowed.txt",
                  kind: { type: "update", move_path: "outside.txt" },
                  diff: "",
                },
              ],
      };
      this.notify("item/started", {
        threadId: this.threadId,
        turnId: this.turnId,
        item,
      });
      this.requestApproval("item/fileChange/requestApproval", {
        threadId: this.threadId,
        turnId: this.turnId,
        itemId: item.id,
      });
      return;
    }
    if (this.scenario === "network") {
      this.requestApproval("item/commandExecution/requestApproval", {
        threadId: this.threadId,
        turnId: this.turnId,
        itemId: "network_command",
        startedAtMs: 1,
        cwd: this.cwd,
        command: "curl https://example.test",
        commandActions: [{ type: "unknown", command: "curl https://example.test" }],
        networkApprovalContext: { host: "example.test", protocol: "https" },
      });
      return;
    }
    if (this.scenario === "dependency") {
      this.requestApproval("item/commandExecution/requestApproval", {
        threadId: this.threadId,
        turnId: this.turnId,
        itemId: "dependency_command",
        startedAtMs: 1,
        cwd: this.cwd,
        command: "npm install zod",
        commandActions: [{ type: "unknown", command: "npm install zod" }],
      });
      return;
    }
    if (this.scenario === "permission") {
      this.requestApproval("item/permissions/requestApproval", {
        threadId: this.threadId,
        turnId: this.turnId,
        itemId: "permission_request",
        startedAtMs: 1,
        cwd: this.cwd,
        permissions: { network: { enabled: true } },
      });
      return;
    }
    if (this.scenario === "external") {
      this.requestApproval("item/tool/call", {
        threadId: this.threadId,
        turnId: this.turnId,
        callId: "external_call",
        tool: "external_write",
        namespace: "fixture",
        arguments: {},
      });
    }
  }

  requestApproval(method, params) {
    this.transport.send({ id: this.nextServerId, method, params });
    this.nextServerId += 1;
  }

  completeInterrupted() {
    if (!this.turnCompleted) this.complete("interrupted");
  }

  completeApprovedFileChange() {
    const item = this.fileApprovalItem;
    assert.ok(item);
    writeFileSync(join(this.cwd, "src", "allowed.txt"), "after\n", "utf8");
    this.notify("item/completed", {
      threadId: this.threadId,
      turnId: this.turnId,
      item: { ...item, status: "completed" },
    });
    this.notify("turn/diff/updated", {
      threadId: this.threadId,
      turnId: this.turnId,
      diff: "diff --git a/src/allowed.txt b/src/allowed.txt\n--- a/src/allowed.txt\n+++ b/src/allowed.txt\n@@ -1 +1 @@\n-before\n+after\n",
    });
    this.complete("completed");
  }

  complete(status) {
    if (this.turnCompleted) return;
    this.turnCompleted = true;
    this.notify("turn/completed", {
      threadId: this.threadId,
      turn: { id: this.turnId, status },
    });
  }

  respond(id, result) {
    this.transport.send({ id, result });
  }

  notify(method, params) {
    this.transport.send({ method, params });
  }
}

function runtimeWithScenarios(scenarios, harnesses) {
  return new ContractExecutionPort({
    createTransport: () => {
      const scenario = scenarios.shift();
      assert.ok(scenario, "missing fake execution scenario");
      const [client, server] = createMemoryTransportPair();
      harnesses.push(new FakeExecutionHarness(server, scenario));
      return client;
    },
    now: () => NOW,
  });
}

async function runApproved(controller, prepared, approved, key) {
  return await controller.run({
    contractId: approved.contract.contractId,
    currentSnapshot: approved.snapshot,
    preparedSnapshot: prepared,
    expectedVersion: approved.run.version,
    idempotencyKey: key,
  });
}

test("AC-009 AC-013 AC-019: successful execution is isolated and reports real checks and diff", async () => {
  const repository = await repositoryFixture();
  const persisted = await storage();
  const harnesses = [];
  const runtime = runtimeWithScenarios(["success"], harnesses);
  const controller = new LocalController({ store: persisted.store, executionPort: runtime });
  controller.start();
  try {
    const approved = approvedContract(persisted.store, repository.prepared, "run_success");
    const result = await runApproved(
      controller,
      repository.prepared,
      approved,
      "execute:run_success:1",
    );
    assert.equal(result.state, "completed");
    assert.equal(readFileSync(join(repository.root, "src", "allowed.txt"), "utf8"), "before\n");
    const report = persisted.store.getReport(result.runId).report;
    assert.deepEqual(report.diffSummary.changedPaths, ["src/allowed.txt"]);
    assert.equal(report.diffSummary.withinContract, true);
    assert.deepEqual(
      report.checks.map((check) => [check.command, check.outcome, check.exitCode]),
      [["npm run test:unit", "passed", 0]],
    );
    assert.deepEqual(report.threadIds, ["thread_success"]);
    assert.equal(report.contractHash, approved.contract.contentHash);
    assert.ok(report.modelIds.includes("gpt-5.4"));
    assert.equal(persisted.store.listExecutions(result.runId)[0].state, "completed");
    const worktree = persisted.store.listWorktrees(result.runId)[0];
    assert.equal(worktree.cleanupStatus, "removed");
    assert.equal(existsSync(worktree.path), false);
    const checkRequest = harnesses[0].requests.find((request) => request.method === "command/exec");
    assert.deepEqual(checkRequest.params.command, ["npm", "run", "test:unit"]);
    assert.deepEqual(checkRequest.params.env, {
      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    });
    assert.equal(checkRequest.params.sandboxPolicy.networkAccess, false);
    const threadStart = harnesses[0].requests.find((request) => request.method === "thread/start");
    assert.match(threadStart.params.developerInstructions, /Use apply_patch, not shell commands/);
    assert.match(threadStart.params.developerInstructions, /Never use pwd or sed/);
  } finally {
    await controller.stop();
    await rm(repository.root, { recursive: true, force: true });
    await rm(persisted.root, { recursive: true, force: true });
  }
});

test("AC-011: P0 rejects an allowlisted external capability before creating a worktree", async () => {
  const repository = await repositoryFixture();
  const persisted = await storage();
  const harnesses = [];
  const controller = new LocalController({
    store: persisted.store,
    executionPort: runtimeWithScenarios([], harnesses),
  });
  controller.start();
  try {
    const approved = approvedContract(persisted.store, repository.prepared, "run_allowlist", {
      networkPolicy: { mode: "allowlist", hosts: ["example.invalid"], actions: ["read"] },
    });
    const result = await runApproved(
      controller,
      repository.prepared,
      approved,
      "execute:run_allowlist:1",
    );
    assert.equal(result.state, "failed");
    assert.equal(result.lastErrorCode, "UNSUPPORTED_P0_CONTRACT");
    assert.equal(persisted.store.listWorktrees(result.runId).length, 0);
    assert.equal(harnesses.length, 0);
  } finally {
    await controller.stop();
    await rm(repository.root, { recursive: true, force: true });
    await rm(persisted.root, { recursive: true, force: true });
  }
});

test("AC-010: outside-path write is detected, interrupted, discarded, and never completed", async () => {
  const repository = await repositoryFixture();
  const persisted = await storage();
  const harnesses = [];
  const controller = new LocalController({
    store: persisted.store,
    executionPort: runtimeWithScenarios(["outside"], harnesses),
  });
  controller.start();
  try {
    const approved = approvedContract(persisted.store, repository.prepared, "run_outside");
    const result = await runApproved(
      controller,
      repository.prepared,
      approved,
      "execute:run_outside:1",
    );
    assert.equal(result.state, "paused");
    assert.equal(existsSync(join(repository.root, "outside.txt")), false);
    assert.ok(harnesses[0].requests.some((request) => request.method === "turn/interrupt"));
    const report = persisted.store.getReport(result.runId).report;
    assert.ok(report.deviations.some((item) => item.category === "file_path"));
    assert.ok(
      report.observedActions.some((item) => item.outcome === "detected_after_contained_write"),
    );
    assert.notEqual(result.state, "completed");
    assert.equal(persisted.store.listDeviations(result.runId)[0].state, "paused");
  } finally {
    await controller.stop();
    await rm(repository.root, { recursive: true, force: true });
    await rm(persisted.root, { recursive: true, force: true });
  }
});

test("AC-013/AC-016/AC-019: App Server disconnect fails execution and preserves sanitized evidence", async () => {
  const repository = await repositoryFixture();
  const persisted = await storage();
  const harnesses = [];
  const controller = new LocalController({
    store: persisted.store,
    executionPort: runtimeWithScenarios(["disconnect"], harnesses),
  });
  controller.start();
  try {
    const approved = approvedContract(persisted.store, repository.prepared, "run_disconnect");
    const result = await runApproved(
      controller,
      repository.prepared,
      approved,
      "execute:run_disconnect:1",
    );
    assert.equal(result.state, "failed");
    assert.equal(result.lastErrorCode, "APP_SERVER_DISCONNECTED");
    assert.notEqual(result.state, "completed");
    assert.equal(readFileSync(join(repository.root, "src", "allowed.txt"), "utf8"), "before\n");
    const report = persisted.store.getReport(result.runId).report;
    assert.equal(report.state, "failed");
    assert.ok(report.remainingUnknowns.length > 0);
    assert.doesNotMatch(JSON.stringify(report), /rawReasoning|processEnv|api[_-]?key/iu);
    assert.equal(persisted.store.listExecutions(result.runId)[0].state, "failed");
    assert.equal(persisted.store.listWorktrees(result.runId)[0].cleanupStatus, "removed");
  } finally {
    await controller.stop();
    await rm(repository.root, { recursive: true, force: true });
    await rm(persisted.root, { recursive: true, force: true });
  }
});

test("AC-011: network, dependency, permission, and external requests are declined before execution", async (t) => {
  for (const scenario of ["network", "dependency", "permission", "external"]) {
    await t.test(scenario, async () => {
      const repository = await repositoryFixture();
      const persisted = await storage();
      const harnesses = [];
      const controller = new LocalController({
        store: persisted.store,
        executionPort: runtimeWithScenarios([scenario], harnesses),
      });
      controller.start();
      try {
        const approved = approvedContract(persisted.store, repository.prepared, `run_${scenario}`);
        const result = await runApproved(
          controller,
          repository.prepared,
          approved,
          `execute:run_${scenario}:1`,
        );
        assert.equal(result.state, "paused");
        const response = harnesses[0].responses.find((item) => item.id === 10_000);
        assert.ok(response, "approval response was not sent");
        if (scenario === "permission") assert.deepEqual(response.result.permissions, {});
        else if (scenario === "external") assert.equal(response.result.success, false);
        else assert.equal(response.result.decision, "decline");
        const report = persisted.store.getReport(result.runId).report;
        assert.ok(
          report.observedActions.some((item) => item.outcome === "declined_before_execution"),
        );
        assert.equal(readFileSync(join(repository.root, "src", "allowed.txt"), "utf8"), "before\n");
      } finally {
        await controller.stop();
        await rm(repository.root, { recursive: true, force: true });
        await rm(persisted.root, { recursive: true, force: true });
      }
    });
  }
});

test("contract-matched structured reads accept the execution worktree root as cwd", async () => {
  const repository = await repositoryFixture();
  const persisted = await storage();
  const harnesses = [];
  const controller = new LocalController({
    store: persisted.store,
    executionPort: runtimeWithScenarios(["allowed-command"], harnesses),
  });
  controller.start();
  try {
    const approved = approvedContract(persisted.store, repository.prepared, "run_allowed_command");
    const result = await runApproved(
      controller,
      repository.prepared,
      approved,
      "execute:run_allowed_command:1",
    );
    assert.equal(result.state, "paused");
    const response = harnesses[0].responses.find((item) => item.id === 10_000);
    assert.deepEqual(response?.result, { decision: "accept" });
    const report = persisted.store.getReport(result.runId).report;
    assert.equal(
      report.observedActions.some((item) => item.outcome === "declined_before_execution"),
      false,
    );
    assert.equal(report.deviations.length, 0);
  } finally {
    await controller.stop();
    await rm(repository.root, { recursive: true, force: true });
    await rm(persisted.root, { recursive: true, force: true });
  }
});

test("pathless file approvals require a same-ID contract-valid file item", async (t) => {
  await t.test("correlated item is accepted and completes", async () => {
    const repository = await repositoryFixture();
    const persisted = await storage();
    const harnesses = [];
    const controller = new LocalController({
      store: persisted.store,
      executionPort: runtimeWithScenarios(["file-approval"], harnesses),
    });
    controller.start();
    try {
      const approved = approvedContract(persisted.store, repository.prepared, "run_file_approval");
      const result = await runApproved(
        controller,
        repository.prepared,
        approved,
        "execute:run_file_approval:1",
      );
      assert.equal(result.state, "completed");
      const response = harnesses[0].responses.find((item) => item.id === 10_000);
      assert.deepEqual(response?.result, { decision: "accept" });
      const report = persisted.store.getReport(result.runId).report;
      assert.deepEqual(report.diffSummary.changedPaths, ["src/allowed.txt"]);
      assert.equal(report.deviations.length, 0);
    } finally {
      await controller.stop();
      await rm(repository.root, { recursive: true, force: true });
      await rm(persisted.root, { recursive: true, force: true });
    }
  });

  await t.test("uncorrelated request is declined", async () => {
    const repository = await repositoryFixture();
    const persisted = await storage();
    const harnesses = [];
    const controller = new LocalController({
      store: persisted.store,
      executionPort: runtimeWithScenarios(["uncorrelated-file-approval"], harnesses),
    });
    controller.start();
    try {
      const approved = approvedContract(
        persisted.store,
        repository.prepared,
        "run_uncorrelated_file_approval",
      );
      const result = await runApproved(
        controller,
        repository.prepared,
        approved,
        "execute:run_uncorrelated_file_approval:1",
      );
      assert.equal(result.state, "paused");
      const response = harnesses[0].responses.find((item) => item.id === 10_000);
      assert.deepEqual(response?.result, { decision: "decline" });
      const report = persisted.store.getReport(result.runId).report;
      assert.ok(report.deviations.some((item) => item.category === "file_path"));
    } finally {
      await controller.stop();
      await rm(repository.root, { recursive: true, force: true });
      await rm(persisted.root, { recursive: true, force: true });
    }
  });

  for (const scenario of ["empty-file-approval", "outside-move-file-approval"]) {
    await t.test(`${scenario} is declined`, async () => {
      const repository = await repositoryFixture();
      const persisted = await storage();
      const harnesses = [];
      const controller = new LocalController({
        store: persisted.store,
        executionPort: runtimeWithScenarios([scenario], harnesses),
      });
      controller.start();
      try {
        const approved = approvedContract(persisted.store, repository.prepared, `run_${scenario}`);
        const result = await runApproved(
          controller,
          repository.prepared,
          approved,
          `execute:run_${scenario}:1`,
        );
        assert.equal(result.state, "paused");
        const response = harnesses[0].responses.find((item) => item.id === 10_000);
        assert.deepEqual(response?.result, { decision: "decline" });
        const report = persisted.store.getReport(result.runId).report;
        assert.ok(report.deviations.length > 0);
      } finally {
        await controller.stop();
        await rm(repository.root, { recursive: true, force: true });
        await rm(persisted.root, { recursive: true, force: true });
      }
    });
  }
});

test("AC-012: an amended contract starts a new thread and clean worktree", async () => {
  const repository = await repositoryFixture();
  const persisted = await storage();
  const harnesses = [];
  const controller = new LocalController({
    store: persisted.store,
    executionPort: runtimeWithScenarios(["outside", "success"], harnesses),
  });
  controller.start();
  try {
    const approved = approvedContract(persisted.store, repository.prepared, "run_amend");
    const paused = await runApproved(
      controller,
      repository.prepared,
      approved,
      "execute:run_amend:1",
    );
    assert.equal(paused.state, "paused");
    const ready = controller.amend({
      runId: paused.runId,
      amendment: {
        approvedBehaviors: ["The amended contract permits a clean retry."],
      },
      expectedVersion: paused.version,
      idempotencyKey: "amend:run_amend:2",
    });
    assert.equal(ready.state, "ready_for_approval");
    const amendedContract = persisted.store.getContract(ready.activeContractId);
    assert.equal(amendedContract.version, 2);
    const reapproved = controller.approve({
      runId: ready.runId,
      contractId: amendedContract.contractId,
      expectedVersion: ready.version,
      idempotencyKey: "approve:run_amend:2",
    });
    const completed = await controller.run({
      contractId: amendedContract.contractId,
      currentSnapshot: repository.prepared.snapshot,
      preparedSnapshot: repository.prepared,
      expectedVersion: reapproved.version,
      idempotencyKey: "execute:run_amend:2",
    });
    assert.equal(completed.state, "completed");
    const worktrees = persisted.store.listWorktrees(completed.runId);
    assert.equal(worktrees.length, 2);
    assert.notEqual(worktrees[0].worktreeId, worktrees[1].worktreeId);
    assert.notEqual(worktrees[0].path, worktrees[1].path);
    assert.ok(worktrees.every((worktree) => worktree.cleanupStatus === "removed"));
    assert.deepEqual(
      new Set(persisted.store.listExecutions(completed.runId).map((item) => item.threadId)),
      new Set(["thread_outside", "thread_success"]),
    );
    assert.equal(existsSync(join(repository.root, "outside.txt")), false);
  } finally {
    await controller.stop();
    await rm(repository.root, { recursive: true, force: true });
    await rm(persisted.root, { recursive: true, force: true });
  }
});
