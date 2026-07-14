import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AppServerError,
  CodexAppServerClient,
  FakeAppServerHarness,
  ProbeCoordinator,
  ProcessJsonRpcTransport,
  createMemoryTransportPair,
  decideProbeApproval,
  ProtocolEventLedger,
} from "../../packages/codex-app-server/dist/index.js";
import { createRepositorySnapshot } from "../../packages/domain/dist/index.js";
import { prepareRepositorySnapshot } from "../../packages/git-snapshot/dist/index.js";

const HASH = "0".repeat(64);
const PLAN_CONTENT = {
  summary: "Implement the requested change.",
  assumptions: [],
  intendedBehavior: ["The requested behavior is implemented."],
  filesToRead: ["README.md"],
  filesToChange: ["README.md"],
  components: ["documentation"],
  dataChanges: [],
  publicApiChanges: [],
  dependencyChanges: [],
  commands: ["npm test"],
  externalEffects: [],
  permissionChanges: [],
  compatibilityImpacts: [],
  reversibility: "reversible",
  verificationSteps: ["Run tests."],
  unknowns: [],
  repositoryEvidence: [
    {
      id: "evidence_readme",
      path: "README.md",
      startLine: 1,
      endLine: 1,
      description: "Repository entry point.",
    },
  ],
};

function snapshot(repositoryPath) {
  return createRepositorySnapshot({
    repositoryPath,
    commitSha: "1".repeat(40),
    branch: "main",
    submodules: {},
    dirtyPatchHash: null,
    instructionHash: HASH,
    configHash: HASH,
    task: "Implement the fixture change",
    model: { id: "gpt-5.4", reasoningEffort: "high" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.0",
    createdAt: "2026-07-14T00:00:00.000Z",
  });
}

async function fakeClient(repositoryPath, scenarios) {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  const harness = new FakeAppServerHarness(serverTransport, scenarios);
  const client = new CodexAppServerClient(clientTransport);
  await client.initialize();
  return { client, harness };
}

function probeInput(repositoryPath, probeId = "probe_1") {
  return {
    probeId,
    cwd: repositoryPath,
    snapshot: snapshot(repositoryPath),
    model: "gpt-5.4",
    reasoningEffort: "high",
    timeoutMs: 200,
  };
}

test("AC-001: three probes use fresh threads and byte-equivalent planning inputs", async () => {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-client-fixture-"));
  const { client, harness } = await fakeClient(repository, [
    { outcome: "valid", content: PLAN_CONTENT },
    { outcome: "valid", content: PLAN_CONTENT },
    { outcome: "valid", content: PLAN_CONTENT },
  ]);
  try {
    const results = await Promise.all(
      [1, 2, 3].map(
        async (index) =>
          await client.runPlanProbe(probeInput(repository, `probe_${String(index)}`)),
      ),
    );
    assert.equal(new Set(results.map((result) => result.threadId)).size, 3);
    assert.deepEqual(
      results.map((result) => result.artifact.probeId),
      ["probe_1", "probe_2", "probe_3"],
    );
    assert.ok(
      results.every((result) => result.artifact.snapshotHash === snapshot(repository).snapshotHash),
    );

    const threadStarts = harness.requests.filter((request) => request.method === "thread/start");
    const turnStarts = harness.requests.filter((request) => request.method === "turn/start");
    assert.equal(threadStarts.length, 3);
    assert.equal(turnStarts.length, 3);
    assert.equal(
      harness.requests.some((request) => request.method === "thread/fork"),
      false,
    );
    const normalized = turnStarts.map((request) => {
      const same = structuredClone(request.params);
      delete same.threadId;
      return same;
    });
    assert.deepEqual(normalized[1], normalized[0]);
    assert.deepEqual(normalized[2], normalized[0]);
    assert.ok(threadStarts.every((request) => request.params.approvalPolicy === "untrusted"));
    assert.ok(
      turnStarts.every(
        (request) =>
          request.params.sandboxPolicy.type === "readOnly" &&
          request.params.sandboxPolicy.networkAccess === false,
      ),
    );
  } finally {
    await client.close();
    await rm(repository, { recursive: true, force: true });
  }
});

test("AC-018: only structured in-root static reads are approved", async () => {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-approval-fixture-"));
  const { client, harness } = await fakeClient(repository, [
    { outcome: "static_read_approval" },
    { outcome: "unsafe_command_approval" },
    { outcome: "file_change_approval" },
    { outcome: "permission_approval" },
  ]);
  try {
    const results = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(await client.runPlanProbe(probeInput(repository, `probe_${String(index + 1)}`)));
    }
    assert.deepEqual(
      results.map((result) => result.approvals[0]?.decision),
      ["accept_static_read", "decline", "decline", "deny_permissions"],
    );
    assert.deepEqual(
      results.map((result) => result.approvals[0]?.reasonCode),
      [
        "static_read",
        "unsafe_action",
        "probe_file_change_denied",
        "probe_permission_expansion_denied",
      ],
    );
    assert.deepEqual(
      harness.clientResponses.map((response) => response.result),
      [
        { decision: "accept" },
        { decision: "decline" },
        { decision: "decline" },
        { permissions: {}, scope: "turn", strictAutoReview: true },
      ],
    );
  } finally {
    await client.close();
    await rm(repository, { recursive: true, force: true });
  }
});

for (const [outcome, expectedCode] of [
  ["invalid_output", "INVALID_PLAN_ARTIFACT"],
  ["reordered_events", "PROTOCOL_CORRUPTION"],
  ["disconnect", "APP_SERVER_DISCONNECTED"],
  ["timeout", "PROBE_TIMEOUT"],
  ["unsafe_command_observed", "PROBE_CONTAINMENT_VIOLATION"],
  ["nonempty_diff", "PROBE_CONTAINMENT_VIOLATION"],
]) {
  test(`AC-002/AC-019: ${outcome} fails closed`, async () => {
    const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-failure-fixture-"));
    const { client } = await fakeClient(repository, [{ outcome }]);
    try {
      await assert.rejects(
        client.runPlanProbe({ ...probeInput(repository), timeoutMs: 20 }),
        (error) => error instanceof AppServerError && error.code === expectedCode,
      );
    } finally {
      await client.close();
      await rm(repository, { recursive: true, force: true });
    }
  });
}

test("AC-019: duplicate notifications are idempotent", async () => {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-duplicate-fixture-"));
  const { client } = await fakeClient(repository, [{ outcome: "duplicate_events" }]);
  try {
    const result = await client.runPlanProbe(probeInput(repository));
    assert.equal(result.events.filter((event) => event.method === "item/completed").length, 1);
    assert.equal(result.events.filter((event) => event.method === "turn/completed").length, 1);
  } finally {
    await client.close();
    await rm(repository, { recursive: true, force: true });
  }
});

test("AC-019: interrupted turns may retain the item that interruption stopped", () => {
  const interrupted = new ProtocolEventLedger();
  interrupted.accept("turn/started", {
    threadId: "thread_interrupt",
    turn: { id: "turn_interrupt", status: "inProgress" },
  });
  interrupted.accept("item/started", {
    threadId: "thread_interrupt",
    turnId: "turn_interrupt",
    item: {
      id: "file_interrupt",
      type: "fileChange",
      status: "inProgress",
      changes: [{ path: "src/allowed.txt", kind: { type: "update", move_path: null }, diff: "" }],
    },
  });
  assert.doesNotThrow(() =>
    interrupted.accept("turn/completed", {
      threadId: "thread_interrupt",
      turn: { id: "turn_interrupt", status: "interrupted" },
    }),
  );

  const completed = new ProtocolEventLedger();
  completed.accept("turn/started", {
    threadId: "thread_complete",
    turn: { id: "turn_complete", status: "inProgress" },
  });
  completed.accept("item/started", {
    threadId: "thread_complete",
    turnId: "turn_complete",
    item: {
      id: "file_complete",
      type: "fileChange",
      status: "inProgress",
      changes: [{ path: "src/allowed.txt", kind: { type: "update", move_path: null }, diff: "" }],
    },
  });
  assert.throws(
    () =>
      completed.accept("turn/completed", {
        threadId: "thread_complete",
        turn: { id: "turn_complete", status: "completed" },
      }),
    (error) => error instanceof AppServerError && error.code === "PROTOCOL_CORRUPTION",
  );
});

test("AC-019: a duplicate approval request is answered twice but recorded once", async () => {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-duplicate-approval-"));
  const { client, harness } = await fakeClient(repository, [
    { outcome: "duplicate_static_read_approval" },
  ]);
  try {
    const result = await client.runPlanProbe(probeInput(repository));
    assert.equal(result.approvals.length, 1);
    assert.equal(result.approvals[0].decision, "accept_static_read");
    assert.deepEqual(
      harness.clientResponses.map((response) => response.result),
      [{ decision: "accept" }, { decision: "accept" }],
    );
  } finally {
    await client.close();
    await rm(repository, { recursive: true, force: true });
  }
});

test("AC-002: network, interpreters, builds, tests, packages, and writes are denied", () => {
  const root = "/tmp/prompt-tripwire-policy-root";
  const base = {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "item_1",
    cwd: root,
  };
  const safeRelativeRead = decideProbeApproval(
    1,
    "item/commandExecution/requestApproval",
    {
      ...base,
      commandActions: [
        { type: "read", command: "cat README.md", path: "README.md", name: "README.md" },
      ],
    },
    root,
  );
  assert.equal(safeRelativeRead.observation.decision, "accept_static_read");

  const deniedCommands = [
    "python3 inspect.py",
    "npm run build",
    "npm test",
    "npm install",
    "curl https://example.invalid",
  ];
  for (const command of deniedCommands) {
    const decision = decideProbeApproval(
      2,
      "item/commandExecution/requestApproval",
      { ...base, commandActions: [{ type: "unknown", command }] },
      root,
    );
    assert.equal(decision.observation.decision, "decline");
  }
  const networkExpansion = decideProbeApproval(
    3,
    "item/commandExecution/requestApproval",
    {
      ...base,
      commandActions: [{ type: "search", command: "rg TODO", path: null, query: "TODO" }],
      networkApprovalContext: { host: "example.invalid", protocol: "https" },
    },
    root,
  );
  assert.equal(networkExpansion.observation.reasonCode, "permission_or_network_expansion");
  const outsideRead = decideProbeApproval(
    4,
    "item/commandExecution/requestApproval",
    {
      ...base,
      commandActions: [
        { type: "read", command: "cat outside", path: "../outside", name: "outside" },
      ],
    },
    root,
  );
  assert.equal(outsideRead.observation.decision, "decline");
  const fileWrite = decideProbeApproval(5, "item/fileChange/requestApproval", base, root);
  assert.equal(fileWrite.observation.decision, "decline");
});

test("runtime refuses an unverified Codex version before spawning App Server", () => {
  assert.throws(
    () =>
      ProcessJsonRpcTransport.start({
        cwd: "/tmp",
        codexPath: "must-not-be-spawned",
        detectedVersion: () => "0.144.3",
      }),
    (error) => error instanceof AppServerError && error.code === "CODEX_VERSION_MISMATCH",
  );
});

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
  assert.equal(result.status, 0, `git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function createPreparedRepository() {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-coordinator-fixture-"));
  git(repository, ["init", "-b", "main"]);
  git(repository, ["config", "user.email", "fixture@example.invalid"]);
  git(repository, ["config", "user.name", "PromptTripwire Fixture"]);
  await writeFile(join(repository, "README.md"), "# Fixture\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "fixture"]);
  const prepared = await prepareRepositorySnapshot({
    repositoryPath: repository,
    task: "Implement the fixture change",
    model: { id: "gpt-5.4", reasoningEffort: "high" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.0",
    effectiveConfig: { probeCount: 3 },
    createdAt: "2026-07-14T00:00:00.000Z",
  });
  return { repository, prepared };
}

class ConfigurableRunner {
  calls = [];
  attempts = new Map();

  constructor(failingProbeNumbers = []) {
    this.failingProbeNumbers = new Set(failingProbeNumbers);
  }

  async runPlanProbe(input) {
    this.calls.push(input);
    const attempt = (this.attempts.get(input.probeId) ?? 0) + 1;
    this.attempts.set(input.probeId, attempt);
    const probeNumber = Number(input.probeId.split("_")[1]);
    if (this.failingProbeNumbers.has(probeNumber)) {
      throw new AppServerError("INVALID_PLAN_ARTIFACT", "fixture failure");
    }
    return {
      probeId: input.probeId,
      threadId: `thread_${input.probeId}_${String(attempt)}`,
      turnId: `turn_${input.probeId}_${String(attempt)}`,
      artifact: {
        probeId: input.probeId,
        threadId: `thread_${input.probeId}_${String(attempt)}`,
        snapshotHash: input.snapshot.snapshotHash,
        taskHash: input.snapshot.taskHash,
        ...PLAN_CONTENT,
      },
      approvals: [],
      events: [],
    };
  }
}

test("AC-001/AC-002: coordinator isolates three probes and cleans every worktree", async () => {
  const { repository, prepared } = await createPreparedRepository();
  const runner = new ConfigurableRunner();
  try {
    const result = await new ProbeCoordinator(runner).run({ prepared });
    assert.equal(result.blocked, false);
    assert.equal(result.degraded, false);
    assert.equal(result.plans.length, 3);
    assert.equal(new Set(runner.calls.map((call) => call.cwd)).size, 3);
    assert.ok(result.worktrees.every((entry) => entry.cleanup.success));
    for (const call of runner.calls) {
      await assert.rejects(access(call.cwd));
    }
    assert.equal(git(repository, ["status", "--porcelain=v1"]), "");
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("AC-001: a failed attempt retries once on a fresh thread", async () => {
  const { repository, prepared } = await createPreparedRepository();
  const attempts = new Map();
  const retryCwds = [];
  const runner = new ConfigurableRunner();
  runner.runPlanProbe = async (input) => {
    const attempt = (attempts.get(input.probeId) ?? 0) + 1;
    attempts.set(input.probeId, attempt);
    if (input.probeId.startsWith("probe_2_") && attempt === 1) {
      retryCwds.push(input.cwd);
      throw new AppServerError("PROBE_TIMEOUT", "fixture timeout");
    }
    if (input.probeId.startsWith("probe_2_")) retryCwds.push(input.cwd);
    return await ConfigurableRunner.prototype.runPlanProbe.call(runner, input);
  };
  try {
    const result = await new ProbeCoordinator(runner).run({ prepared });
    assert.equal(result.plans.length, 3);
    assert.deepEqual(
      result.attempts
        .filter((attempt) => attempt.probeId.startsWith("probe_2_"))
        .map((attempt) => attempt.state),
      ["timed_out", "completed"],
    );
    assert.equal(new Set(retryCwds).size, 2);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

for (const [failingProbeNumbers, expected] of [
  [[3], { plans: 2, degraded: true, blocked: false }],
  [[2, 3], { plans: 1, degraded: false, blocked: true }],
]) {
  test(`AC-001: ${expected.plans} valid plans produce the required gate state`, async () => {
    const { repository, prepared } = await createPreparedRepository();
    try {
      const result = await new ProbeCoordinator(new ConfigurableRunner(failingProbeNumbers)).run({
        prepared,
      });
      assert.equal(result.plans.length, expected.plans);
      assert.equal(result.degraded, expected.degraded);
      assert.equal(result.blocked, expected.blocked);
      assert.equal(result.blockingReason, expected.blocked ? "INSUFFICIENT_VALID_PROBES" : null);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });
}
