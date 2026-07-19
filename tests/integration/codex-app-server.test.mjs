import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getEventListeners } from "node:events";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AppServerError,
  assertProbeRootSymlinkContainment,
  CodexAppServerClient,
  FakeAppServerHarness,
  ProbeCoordinator,
  ProcessJsonRpcTransport,
  createMemoryTransportPair,
  decideProbeApproval,
  probeItemViolation,
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

const COMPARISON_CONTENT = {
  consensus: [],
  divergences: [],
  unknowns: [],
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
    promptTripwireVersion: "0.1.7",
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

function comparisonInput(repositoryPath) {
  return {
    cwd: repositoryPath,
    task: snapshot(repositoryPath).task,
    plans: ["probe_1", "probe_2"].map((probeId) => ({
      probeId,
      threadId: `thread_${probeId}`,
      snapshotHash: snapshot(repositoryPath).snapshotHash,
      taskHash: snapshot(repositoryPath).taskHash,
      ...PLAN_CONTENT,
    })),
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
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

test("AC-008/AC-018: comparator uses a fresh tool-free structured-output thread", async () => {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-comparison-fixture-"));
  const { client, harness } = await fakeClient(repository, [
    { outcome: "valid", content: COMPARISON_CONTENT },
  ]);
  try {
    const result = await client.runComparison(comparisonInput(repository));
    assert.match(result.threadId, /^thread_fake_/u);
    assert.match(result.turnId, /^turn_fake_/u);
    assert.equal(result.model, "gpt-5.6-terra");
    assert.deepEqual(result.output, COMPARISON_CONTENT);
    assert.deepEqual(result.usage, {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      reasoningTokens: 20,
    });

    const threadStart = harness.requests.find((request) => request.method === "thread/start");
    const turnStart = harness.requests.find((request) => request.method === "turn/start");
    assert.equal(threadStart.params.cwd, repository);
    assert.equal(threadStart.params.ephemeral, true);
    assert.equal(threadStart.params.sandbox, "read-only");
    assert.equal(threadStart.params.approvalPolicy, "untrusted");
    assert.equal(threadStart.params.serviceName, "prompt_tripwire_comparator");
    assert.deepEqual(turnStart.params.sandboxPolicy, {
      type: "readOnly",
      networkAccess: false,
    });
    assert.equal(turnStart.params.effort, "low");
    assert.equal(turnStart.params.summary, "none");
    assert.ok(turnStart.params.outputSchema);
    assert.match(
      threadStart.params.developerInstructions,
      /Every evidenceRefs value must be copied verbatim/u,
    );
    assert.match(turnStart.params.input[0].text, /"probeIds":\["probe_1","probe_2"\]/u);
    assert.match(turnStart.params.input[0].text, /"repositoryEvidenceIds":\["evidence_readme"\]/u);
  } finally {
    await client.close();
    await rm(repository, { recursive: true, force: true });
  }
});

test("AC-008/AC-019: a late comparator request never inherits probe read approval", async () => {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-late-comparison-request-"));
  const { client, harness } = await fakeClient(repository, [
    { outcome: "valid", content: COMPARISON_CONTENT },
  ]);
  try {
    const result = await client.runComparison(comparisonInput(repository));
    harness.requestStaticReadApproval(result.threadId, result.turnId, repository);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(harness.clientResponses.at(-1).result, { decision: "decline" });
  } finally {
    await client.close();
    await rm(repository, { recursive: true, force: true });
  }
});

test("AC-019: successful turns remove their abort listeners", async () => {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-abort-listener-fixture-"));
  const controller = new AbortController();
  const { client } = await fakeClient(repository, [{ outcome: "valid" }]);
  try {
    await client.runPlanProbe({ ...probeInput(repository), signal: controller.signal });
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally {
    await client.close();
    await rm(repository, { recursive: true, force: true });
  }
});

test("AC-019: cancelled turns remove their waiter and abort listener", async () => {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-abort-cleanup-fixture-"));
  const controller = new AbortController();
  const { client } = await fakeClient(repository, [{ outcome: "timeout" }]);
  try {
    const pending = client.runPlanProbe({
      ...probeInput(repository),
      signal: controller.signal,
      timeoutMs: 1_000,
    });
    setImmediate(() => controller.abort());
    await assert.rejects(
      pending,
      (error) => error instanceof AppServerError && error.code === "PROBE_CANCELLED",
    );
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally {
    await client.close();
    await rm(repository, { recursive: true, force: true });
  }
});

test("AC-008/AC-018: comparator tool requests and invalid output fail closed", async () => {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-comparison-denial-"));
  const { client, harness } = await fakeClient(repository, [
    { outcome: "static_read_approval", content: COMPARISON_CONTENT },
    { outcome: "invalid_output" },
  ]);
  try {
    await assert.rejects(client.runComparison(comparisonInput(repository)), (error) => {
      assert.equal(error instanceof AppServerError, true);
      assert.equal(error.code, "COMPARISON_TOOL_VIOLATION");
      assert.match(error.metadata.threadId, /^thread_fake_/u);
      assert.match(error.metadata.turnId, /^turn_fake_/u);
      return true;
    });
    assert.deepEqual(harness.clientResponses[0].result, { decision: "decline" });
    await assert.rejects(
      client.runComparison(comparisonInput(repository)),
      (error) => error instanceof AppServerError && error.code === "INVALID_COMPARISON_ARTIFACT",
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
  const root = tmpdir();
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
      command: "cat README.md",
      commandActions: [
        { type: "read", command: "cat README.md", path: "README.md", name: "README.md" },
      ],
    },
    root,
  );
  assert.equal(safeRelativeRead.observation.decision, "accept_static_read");
  const safeAbsoluteRead = decideProbeApproval(
    2,
    "item/commandExecution/requestApproval",
    {
      ...base,
      command: `cat ${join(root, "README.md")}`,
      commandActions: [
        {
          type: "read",
          command: `cat ${join(root, "README.md")}`,
          path: join(root, "README.md"),
          name: "README.md",
        },
      ],
    },
    root,
  );
  assert.equal(safeAbsoluteRead.observation.decision, "accept_static_read");
  const missingActualCommand = decideProbeApproval(
    3,
    "item/commandExecution/requestApproval",
    {
      ...base,
      commandActions: [
        { type: "read", command: "cat README.md", path: "README.md", name: "README.md" },
      ],
    },
    root,
  );
  assert.equal(missingActualCommand.observation.decision, "decline");
  assert.equal(missingActualCommand.observation.reasonCode, "unsafe_action");
  const nullActualCommand = decideProbeApproval(
    3,
    "item/commandExecution/requestApproval",
    {
      ...base,
      command: null,
      commandActions: [
        { type: "read", command: "cat README.md", path: "README.md", name: "README.md" },
      ],
    },
    root,
  );
  assert.equal(nullActualCommand.observation.decision, "decline");
  assert.equal(nullActualCommand.observation.reasonCode, "unsafe_action");

  const deniedCommands = [
    "python3 inspect.py",
    "npm run build",
    "npm test",
    "npm install",
    "curl https://example.invalid",
  ];
  for (const command of deniedCommands) {
    const decision = decideProbeApproval(
      3,
      "item/commandExecution/requestApproval",
      { ...base, command, commandActions: [{ type: "unknown", command }] },
      root,
    );
    assert.equal(decision.observation.decision, "decline");
  }
  const networkExpansion = decideProbeApproval(
    4,
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
    5,
    "item/commandExecution/requestApproval",
    {
      ...base,
      command: "cat outside",
      commandActions: [
        { type: "read", command: "cat outside", path: "../outside", name: "outside" },
      ],
    },
    root,
  );
  assert.equal(outsideRead.observation.decision, "decline");
  const parentSegmentRead = decideProbeApproval(
    6,
    "item/commandExecution/requestApproval",
    {
      ...base,
      command: "cat src/../README.md",
      commandActions: [
        {
          type: "read",
          command: "cat src/../README.md",
          path: "src/../README.md",
          name: "README.md",
        },
      ],
    },
    root,
  );
  assert.equal(parentSegmentRead.observation.decision, "decline");
  assert.equal(parentSegmentRead.observation.reasonCode, "unsafe_action");
  const fileWrite = decideProbeApproval(7, "item/fileChange/requestApproval", base, root);
  assert.equal(fileWrite.observation.decision, "decline");
});

test("AC-002: structured static reads reject shell ambiguity and command/action mismatches", () => {
  const root = tmpdir();
  const base = {
    threadId: "thread_untrusted_action",
    turnId: "turn_untrusted_action",
    itemId: "item_untrusted_action",
    cwd: root,
  };
  const read = (command, path, extra = {}) => ({
    ...base,
    command,
    ...extra,
    commandActions: [{ type: "read", command, path, name: path }],
  });
  const denied = [
    read("cat -- -", "-"),
    read("head -n 10 -- -", "-"),
    read("tail -n 10 -- -", "-"),
    read("wc -- -", "-"),
    read("sed -n '1p' -", "-"),
    read("cat ~/.ssh/id_rsa", "~/.ssh/id_rsa"),
    read("cat $HOME/.ssh/id_rsa", "$HOME/.ssh/id_rsa"),
    read("cat ${HOME}/.ssh/id_rsa", "${HOME}/.ssh/id_rsa"),
    read("cat $(pwd)/README.md", "$(pwd)/README.md"),
    read("cat `pwd`/README.md", "`pwd`/README.md"),
    read("cat *.md", "*.md"),
    read("cat {README,LICENSE}.md", "{README,LICENSE}.md"),
    read("cat README.md > captured.txt", "README.md"),
    read("cat README.md; curl https://example.invalid", "README.md"),
    read("sed -i '' '1s/a/b/' README.md", "README.md"),
    read("cat package.json", "README.md"),
    read("cat README.md", "README.md", { command: "curl https://example.invalid" }),
    {
      ...base,
      command: "rg TODO -",
      commandActions: [{ type: "search", command: "rg TODO -", path: "-", query: "TODO" }],
    },
    {
      ...base,
      command: "rg --pre 'sh -c evil' TODO .",
      commandActions: [
        {
          type: "search",
          command: "rg --pre 'sh -c evil' TODO .",
          path: ".",
          query: "TODO",
        },
      ],
    },
    {
      ...base,
      command: "find . -exec cat README.md +",
      commandActions: [
        {
          type: "listFiles",
          command: "find . -exec cat README.md +",
          path: ".",
        },
      ],
    },
    {
      ...base,
      command: "cat README.md",
      commandActions: [
        { type: "search", command: "cat README.md", path: "README.md", query: "TODO" },
      ],
    },
  ];
  for (const request of denied) {
    const decision = decideProbeApproval(1, "item/commandExecution/requestApproval", request, root);
    assert.equal(decision.observation.decision, "decline", JSON.stringify(request.commandActions));
    assert.equal(decision.observation.reasonCode, "unsafe_action");
  }
  const ambiguousCwd = decideProbeApproval(
    2,
    "item/commandExecution/requestApproval",
    read("cat README.md", "README.md", { cwd: `${root}/$HOME` }),
    root,
  );
  assert.equal(ambiguousCwd.observation.decision, "decline");
  assert.equal(ambiguousCwd.observation.reasonCode, "outside_probe_root");

  assert.match(
    probeItemViolation(
      {
        id: "item_observed_mismatch",
        type: "commandExecution",
        status: "completed",
        command: "curl https://example.invalid",
        cwd: root,
        commandActions: [
          { type: "read", command: "cat README.md", path: "README.md", name: "README.md" },
        ],
      },
      root,
    ),
    /^unsafe_command_observed:unsafe_action:/u,
  );

  for (const item of [
    {
      id: "item_observed_stdin_read",
      type: "commandExecution",
      status: "completed",
      command: "cat -- -",
      cwd: root,
      commandActions: [{ type: "read", command: "cat -- -", path: "-", name: "-" }],
    },
    {
      id: "item_observed_stdin_search",
      type: "commandExecution",
      status: "completed",
      command: "rg TODO -",
      cwd: root,
      commandActions: [{ type: "search", command: "rg TODO -", path: "-", query: "TODO" }],
    },
    {
      id: "item_observed_wrong_shell_envelope",
      type: "commandExecution",
      status: "completed",
      command: "/bin/bash -lc ls",
      cwd: root,
      commandActions: [{ type: "listFiles", command: "ls", path: null }],
    },
    {
      id: "item_observed_wrong_zsh_flag",
      type: "commandExecution",
      status: "completed",
      command: "/bin/zsh -ic ls",
      cwd: root,
      commandActions: [{ type: "listFiles", command: "ls", path: null }],
    },
    {
      id: "item_observed_compound_inner_command",
      type: "commandExecution",
      status: "completed",
      command: "/bin/zsh -lc 'ls; cat .env'",
      cwd: root,
      commandActions: [{ type: "listFiles", command: "ls", path: null }],
    },
    {
      id: "item_observed_mismatched_inner_command",
      type: "commandExecution",
      status: "completed",
      command: "/bin/zsh -c 'cat README.md'",
      cwd: root,
      commandActions: [{ type: "listFiles", command: "ls", path: null }],
    },
    {
      id: "item_observed_extra_wrapper_argument",
      type: "commandExecution",
      status: "completed",
      command: "/bin/zsh -lc ls extra",
      cwd: root,
      commandActions: [{ type: "listFiles", command: "ls", path: null }],
    },
  ]) {
    assert.match(
      probeItemViolation(item, root),
      /^unsafe_command_observed:unsafe_action:/u,
      item.command,
    );
  }
  assert.match(
    probeItemViolation(
      {
        id: "item_failed_unsafe_command",
        type: "commandExecution",
        status: "failed",
        command: "npm test",
        cwd: root,
        commandActions: [{ type: "unknown", command: "npm test" }],
      },
      root,
    ),
    /^unsafe_command_observed:unsafe_action:/u,
  );
  assert.equal(
    probeItemViolation(
      { id: "item_failed_file_change", type: "fileChange", status: "failed", changes: [] },
      root,
    ),
    "file_change_observed",
  );
});

test("AC-002: bounded cat, read, search, and listing commands remain allowed", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-safe-probe-"));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "other"));
  await writeFile(join(root, "README.md"), "# Safe fixture\n");
  await writeFile(join(root, "src", "safe.ts"), "// TODO: safe\n");
  await writeFile(join(root, "other", "safe.ts"), "// TODO: duplicate basename\n");
  const base = {
    threadId: "thread_static_read",
    turnId: "turn_static_read",
    itemId: "item_static_read",
    cwd: root,
  };
  const allowed = [
    {
      ...base,
      command: "cat README.md",
      commandActions: [
        { type: "read", command: "cat README.md", path: "README.md", name: "README.md" },
      ],
    },
    {
      ...base,
      commandActions: [
        {
          type: "read",
          command: "head -n 20 README.md",
          path: "README.md",
          name: "README.md",
        },
      ],
    },
    {
      ...base,
      commandActions: [
        {
          type: "read",
          command: "sed -n 1,80p README.md",
          path: "README.md",
          name: "README.md",
        },
      ],
    },
    {
      ...base,
      commandActions: [
        { type: "search", command: "rg -n 'TODO.*safe' src", path: "src", query: "TODO.*safe" },
      ],
    },
    {
      ...base,
      command: "rg -n . src/safe.ts",
      commandActions: [
        { type: "search", command: "rg -n . src/safe.ts", path: "safe.ts", query: "." },
      ],
    },
    {
      ...base,
      command: "rg -n . README.md src/safe.ts",
      commandActions: [
        {
          type: "search",
          command: "rg -n . README.md src/safe.ts",
          path: "README.md",
          query: ".",
        },
      ],
    },
    {
      ...base,
      command: "rg -n -e TODO -- README.md src/safe.ts",
      commandActions: [
        {
          type: "search",
          command: "rg -n -e TODO -- README.md src/safe.ts",
          path: "README.md",
          query: "TODO",
        },
      ],
    },
    {
      ...base,
      command: "rg -n TODO",
      commandActions: [{ type: "search", command: "rg -n TODO", path: null, query: "TODO" }],
    },
    {
      ...base,
      commandActions: [{ type: "listFiles", command: "ls -la src", path: "src" }],
    },
    {
      ...base,
      commandActions: [
        {
          type: "listFiles",
          command: "rg --files -g '*.ts' src",
          path: "src",
        },
      ],
    },
    {
      ...base,
      commandActions: [
        {
          type: "listFiles",
          command: "find src -maxdepth 2 -type f -name '*.ts' -print",
          path: "src",
        },
      ],
    },
    {
      ...base,
      command: "/bin/zsh -c ls",
      commandActions: [{ type: "listFiles", command: "ls", path: null }],
    },
    {
      ...base,
      command: "/bin/zsh -lc 'cat README.md'",
      commandActions: [
        { type: "read", command: "cat README.md", path: "README.md", name: "README.md" },
      ],
    },
  ];
  try {
    for (const request of allowed) {
      const requestWithActualCommand =
        request.command === undefined
          ? { ...request, command: request.commandActions[0]?.command }
          : request;
      const decision = decideProbeApproval(
        1,
        "item/commandExecution/requestApproval",
        requestWithActualCommand,
        root,
      );
      assert.equal(
        decision.observation.decision,
        "accept_static_read",
        JSON.stringify(request.commandActions),
      );
      assert.equal(decision.observation.reasonCode, "static_read");
    }

    const rejectedMultiPathSearches = [
      {
        command: `rg -n TODO src/safe.ts ${join(dirname(root), "outside.ts")}`,
        path: "safe.ts",
      },
      {
        command: `rg -n TODO ${join(dirname(root), "outside.ts")} src/safe.ts`,
        path: "safe.ts",
      },
      {
        command: "rg -n TODO src/safe.ts .git/config",
        path: "safe.ts",
      },
      {
        command: "rg -n TODO README.md src/safe.ts",
        path: "unrelated.md",
      },
      {
        command: "rg -n TODO src/safe.ts other/safe.ts",
        path: "safe.ts",
      },
      {
        command: "rg -n TODO src/safe.ts .git/config",
        actualCommand: "/bin/zsh -lc 'rg -n TODO src/safe.ts .git/config'",
        path: "safe.ts",
      },
    ];
    for (const fixture of rejectedMultiPathSearches) {
      const decision = decideProbeApproval(
        2,
        "item/commandExecution/requestApproval",
        {
          ...base,
          command: fixture.actualCommand ?? fixture.command,
          commandActions: [
            { type: "search", command: fixture.command, path: fixture.path, query: "TODO" },
          ],
        },
        root,
      );
      assert.equal(decision.observation.decision, "decline", fixture.command);
      assert.equal(decision.observation.reasonCode, "unsafe_action");
    }

    const appServerWrappedItems = [
      {
        command: "/bin/zsh -c ls",
        commandActions: [{ type: "listFiles", command: "ls", path: null }],
      },
      {
        command: "/bin/zsh -lc ls",
        commandActions: [{ type: "listFiles", command: "ls", path: null }],
      },
      {
        command: "/bin/zsh -c 'cat README.md'",
        commandActions: [
          { type: "read", command: "cat README.md", path: "README.md", name: "README.md" },
        ],
      },
      {
        command: "/bin/zsh -lc 'rg -n TODO src'",
        commandActions: [{ type: "search", command: "rg -n TODO src", path: "src", query: "TODO" }],
      },
      {
        command: "/bin/zsh -lc 'rg -n TODO README.md src/safe.ts'",
        commandActions: [
          {
            type: "search",
            command: "rg -n TODO README.md src/safe.ts",
            path: "README.md",
            query: "TODO",
          },
        ],
      },
    ];
    for (const [index, item] of appServerWrappedItems.entries()) {
      assert.equal(
        probeItemViolation(
          {
            id: `item_app_server_wrapper_${String(index)}`,
            type: "commandExecution",
            status: "completed",
            cwd: root,
            ...item,
          },
          root,
        ),
        null,
        item.command,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-002: protected content is unreadable while list-only inspection remains bounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-protected-probe-"));
  const base = {
    threadId: "thread_protected",
    turnId: "turn_protected",
    itemId: "item_protected",
    cwd: root,
  };
  await mkdir(join(root, ".ssh"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "fixtures"));
  await mkdir(join(root, "hidden-only"));
  await mkdir(join(root, "safe"));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "vault"));
  await writeFile(join(root, ".env"), "SECRET=redacted\n");
  await writeFile(join(root, ".git", "config"), '[remote "origin"]\n');
  await writeFile(join(root, ".git", "credentials"), "redacted\n");
  await writeFile(join(root, ".ssh", "id_rsa"), "redacted\n");
  await writeFile(join(root, "fixtures", "test.key"), "redacted\n");
  await writeFile(join(root, "hidden-only", ".env.local"), "SECRET=redacted\n");
  await writeFile(join(root, "src", "safe.ts"), "export const safe = true;\n");
  await writeFile(join(root, "vault", "secret.key"), "SECRET=redacted\n");
  await symlink(join(root, ".env"), join(root, "apparently-safe-link"));
  await symlink(join(root, "vault"), join(root, "safe", "linked"));
  try {
    assert.doesNotThrow(() => assertProbeRootSymlinkContainment(root));
    const directReads = [
      ".env",
      ".git",
      ".git/config",
      ".git/credentials",
      ".ssh/id_rsa",
      "fixtures/test.key",
      "apparently-safe-link",
    ];
    for (const path of directReads) {
      const decision = decideProbeApproval(
        1,
        "item/commandExecution/requestApproval",
        {
          ...base,
          command: `cat ${path}`,
          commandActions: [{ type: "read", command: `cat ${path}`, path, name: path }],
        },
        root,
      );
      assert.equal(decision.observation.decision, "decline", path);
      assert.equal(decision.observation.reasonCode, "unsafe_action");
    }

    const recursiveSearches = [
      {
        command: "rg SECRET .",
        path: ".",
        query: "SECRET",
      },
      {
        command: "rg --hidden --no-ignore SECRET hidden-only",
        path: "hidden-only",
        query: "SECRET",
      },
      {
        command: "rg -g '.env' SECRET .",
        path: ".",
        query: "SECRET",
      },
      {
        command: "rg --glob=.env.local SECRET hidden-only",
        path: "hidden-only",
        query: "SECRET",
      },
      {
        command: "rg -L SECRET safe",
        path: "safe",
        query: "SECRET",
      },
      {
        command: "rg --follow SECRET safe",
        path: "safe",
        query: "SECRET",
      },
    ];
    for (const action of recursiveSearches) {
      const decision = decideProbeApproval(
        2,
        "item/commandExecution/requestApproval",
        { ...base, command: action.command, commandActions: [{ type: "search", ...action }] },
        root,
      );
      assert.equal(decision.observation.decision, "decline", action.command);
      assert.equal(decision.observation.reasonCode, "unsafe_action");
    }

    assert.match(
      probeItemViolation(
        {
          id: "item_observed_following_search",
          type: "commandExecution",
          status: "completed",
          command: "rg -L SECRET safe",
          cwd: root,
          commandActions: [
            { type: "search", command: "rg -L SECRET safe", path: "safe", query: "SECRET" },
          ],
        },
        root,
      ),
      /^unsafe_command_observed:unsafe_action:/u,
    );

    const boundedContentSearches = [
      { command: "rg safe src/safe.ts", path: "src/safe.ts", query: "safe" },
      { command: "rg SECRET hidden-only", path: "hidden-only", query: "SECRET" },
      {
        command: "rg -g '!.env.local' SECRET hidden-only",
        path: "hidden-only",
        query: "SECRET",
      },
    ];
    for (const action of boundedContentSearches) {
      const decision = decideProbeApproval(
        3,
        "item/commandExecution/requestApproval",
        { ...base, command: action.command, commandActions: [{ type: "search", ...action }] },
        root,
      );
      assert.equal(decision.observation.decision, "accept_static_read", action.command);
    }

    const listOnly = [
      { type: "listFiles", command: "ls -la .git", path: ".git" },
      { type: "listFiles", command: "ls -la .ssh", path: ".ssh" },
      { type: "listFiles", command: "find . -maxdepth 3 -type f -print", path: "." },
      { type: "listFiles", command: "rg --files --hidden --no-ignore .", path: "." },
    ];
    for (const action of listOnly) {
      const decision = decideProbeApproval(
        4,
        "item/commandExecution/requestApproval",
        { ...base, command: action.command, commandActions: [action] },
        root,
      );
      assert.equal(decision.observation.decision, "accept_static_read", action.command);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-002: static reads resolve symlinks and reject repository escape", async () => {
  const parent = await mkdtemp(join(tmpdir(), "prompt-tripwire-probe-symlink-"));
  const root = join(parent, "repository");
  const outside = join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, "inside.txt"), "inside\n");
  await writeFile(join(outside, "secret.txt"), "outside\n");
  await symlink(join(root, "inside.txt"), join(root, "inside-link"));
  assert.doesNotThrow(() => assertProbeRootSymlinkContainment(root));
  await symlink(outside, join(root, "outside-directory-link"));
  const parentTraversalCwd = decideProbeApproval(
    1,
    "item/commandExecution/requestApproval",
    {
      threadId: "thread_parent_traversal",
      turnId: "turn_parent_traversal",
      itemId: "item_parent_traversal",
      cwd: `${root}/outside-directory-link/..`,
      commandActions: [{ type: "search", command: "rg TODO", path: null, query: "TODO" }],
    },
    root,
  );
  assert.equal(parentTraversalCwd.observation.decision, "decline");
  assert.equal(parentTraversalCwd.observation.reasonCode, "outside_probe_root");
  await unlink(join(root, "outside-directory-link"));
  await symlink(join(outside, "secret.txt"), join(root, "outside-link"));
  try {
    assert.throws(
      () => assertProbeRootSymlinkContainment(root),
      (error) => error instanceof AppServerError && error.code === "PROBE_CONTAINMENT_VIOLATION",
    );
    const request = (path) => ({
      threadId: "thread_symlink",
      turnId: "turn_symlink",
      itemId: `item_${path}`,
      cwd: root,
      command: `cat ${path}`,
      commandActions: [{ type: "read", command: `cat ${path}`, path, name: path }],
    });
    assert.equal(
      decideProbeApproval(1, "item/commandExecution/requestApproval", request("inside-link"), root)
        .observation.decision,
      "accept_static_read",
    );
    const escaped = decideProbeApproval(
      2,
      "item/commandExecution/requestApproval",
      request("outside-link"),
      root,
    );
    assert.equal(escaped.observation.decision, "decline");
    assert.equal(escaped.observation.reasonCode, "unsafe_action");
    await unlink(join(root, "outside-link"));
    await symlink(join(outside, "missing.txt"), join(root, "broken-link"));
    assert.throws(
      () => assertProbeRootSymlinkContainment(root),
      (error) => error instanceof AppServerError && error.code === "PROBE_CONTAINMENT_VIOLATION",
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("AC-PLUG-004: child App Server inherits the guard and Plugin re-entry is blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-reentry-child-"));
  const codex = join(root, "codex");
  const marker = join(root, "result.txt");
  const zDotDir = join(root, "zsh-startup");
  await mkdir(zDotDir, { mode: 0o700 });
  const expectedShellConfig = `shell_environment_policy.set={ZDOTDIR=${JSON.stringify(await realpath(zDotDir))},PROMPT_TRIPWIRE_PLUGIN_REENTRY="1"}`;
  const adapter = fileURLToPath(
    new URL(
      "../../plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs",
      import.meta.url,
    ),
  );
  await writeFile(
    codex,
    `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.144.4\\n");
  process.exit(0);
}
const result = spawnSync(process.execPath, [${JSON.stringify(adapter)}, "--help"], {
  encoding: "utf8",
  env: process.argv.includes(${JSON.stringify(expectedShellConfig)}) &&
      process.argv.some((argument, index) => argument === "--disable" && process.argv[index + 1] === "plugins")
    ? { PATH: process.env.PATH, PROMPT_TRIPWIRE_PLUGIN_REENTRY: "1" }
    : { PATH: process.env.PATH },
});
writeFileSync(${JSON.stringify(marker)}, [String(result.status), result.stdout, result.stderr].join("\\n"), { mode: 0o600 });
`,
    { mode: 0o700 },
  );

  const previous = process.env.PROMPT_TRIPWIRE_PLUGIN_REENTRY;
  process.env.PROMPT_TRIPWIRE_PLUGIN_REENTRY = "1";
  let transport;
  try {
    transport = ProcessJsonRpcTransport.start({
      cwd: root,
      codexPath: codex,
      shellStartupDirectory: zDotDir,
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await access(marker);
        break;
      } catch {
        await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
      }
    }
    const output = await readFile(marker, "utf8");
    assert.match(output, /^1\n/u);
    assert.match(output, /REENTRY_BLOCKED/u);
    assert.equal((await stat(zDotDir)).mode & 0o777, 0o700);
    assert.deepEqual(await readdir(zDotDir), []);
  } finally {
    if (previous === undefined) delete process.env.PROMPT_TRIPWIRE_PLUGIN_REENTRY;
    else process.env.PROMPT_TRIPWIRE_PLUGIN_REENTRY = previous;
    await transport?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("probe App Server uses an empty isolated zsh startup directory without broad inheritance", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-zdotdir-child-"));
  const codex = join(root, "codex");
  const marker = join(root, "args.json");
  const zDotDir = join(root, "zsh-startup");
  await mkdir(zDotDir, { mode: 0o700 });
  const expectedShellConfig = `shell_environment_policy.set={ZDOTDIR=${JSON.stringify(await realpath(zDotDir))}}`;
  await writeFile(
    codex,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.144.4\\n");
  process.exit(0);
}
writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2)), { mode: 0o600 });
process.stdin.resume();
`,
    { mode: 0o700 },
  );

  const previous = process.env.PROMPT_TRIPWIRE_PLUGIN_REENTRY;
  delete process.env.PROMPT_TRIPWIRE_PLUGIN_REENTRY;
  let transport;
  try {
    transport = ProcessJsonRpcTransport.start({
      cwd: root,
      codexPath: codex,
      shellStartupDirectory: zDotDir,
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await access(marker);
        break;
      } catch {
        await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
      }
    }
    const args = JSON.parse(await readFile(marker, "utf8"));
    assert.equal(args.includes(expectedShellConfig), true);
    assert.deepEqual(
      args.flatMap((argument, index) =>
        argument === "--disable" && args[index + 1] === "plugins"
          ? [argument, args[index + 1]]
          : [],
      ),
      ["--disable", "plugins"],
    );
    assert.equal(
      args.some((argument) => argument.includes("PROMPT_TRIPWIRE_PLUGIN_REENTRY")),
      false,
    );
    assert.equal((await stat(zDotDir)).mode & 0o777, 0o700);
    assert.deepEqual(await readdir(zDotDir), []);
  } finally {
    if (previous !== undefined) process.env.PROMPT_TRIPWIRE_PLUGIN_REENTRY = previous;
    await transport?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("App Server preserves custom Codex auth home without broad environment inheritance", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-codex-home-child-"));
  const codex = join(root, "codex");
  const marker = join(root, "environment.json");
  const zDotDir = join(root, "zsh-startup");
  const codexHome = join(root, "codex-home");
  await mkdir(zDotDir, { mode: 0o700 });
  await writeFile(
    codex,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.144.4\\n");
  process.exit(0);
}
writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
  codexHomeMatches: process.env.CODEX_HOME === ${JSON.stringify(codexHome)},
  unrelatedCanaryPresent: process.env.PROMPT_TRIPWIRE_UNRELATED_ENV_CANARY !== undefined,
}), { mode: 0o600 });
process.stdin.resume();
`,
    { mode: 0o700 },
  );

  const previousCodexHome = process.env.CODEX_HOME;
  const previousCanary = process.env.PROMPT_TRIPWIRE_UNRELATED_ENV_CANARY;
  process.env.CODEX_HOME = codexHome;
  process.env.PROMPT_TRIPWIRE_UNRELATED_ENV_CANARY = "must-not-be-inherited";
  let transport;
  try {
    transport = ProcessJsonRpcTransport.start({
      cwd: root,
      codexPath: codex,
      shellStartupDirectory: zDotDir,
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await access(marker);
        break;
      } catch {
        await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
      }
    }
    assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), {
      codexHomeMatches: true,
      unrelatedCanaryPresent: false,
    });
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousCanary === undefined) delete process.env.PROMPT_TRIPWIRE_UNRELATED_ENV_CANARY;
    else process.env.PROMPT_TRIPWIRE_UNRELATED_ENV_CANARY = previousCanary;
    await transport?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("probe App Server rejects unsafe zsh startup directories before spawn", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-unsafe-zdotdir-"));
  const permissive = join(root, "permissive");
  const nonempty = join(root, "nonempty");
  const safe = join(root, "safe");
  const linked = join(root, "linked");
  await mkdir(permissive, { mode: 0o700 });
  await chmod(permissive, 0o755);
  await mkdir(nonempty, { mode: 0o700 });
  await writeFile(join(nonempty, ".zshenv"), "# fixture\n");
  await mkdir(safe, { mode: 0o700 });
  await symlink(safe, linked);
  try {
    for (const shellStartupDirectory of [join(root, "missing"), permissive, nonempty, linked]) {
      assert.throws(
        () =>
          ProcessJsonRpcTransport.start({
            cwd: root,
            codexPath: "must-not-be-spawned",
            detectedVersion: () => "0.144.4",
            shellStartupDirectory,
          }),
        (error) => error instanceof AppServerError && error.code === "PROTOCOL_VALIDATION_FAILED",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime refuses an unverified Codex version before spawning App Server", () => {
  assert.throws(
    () =>
      ProcessJsonRpcTransport.start({
        cwd: "/tmp",
        codexPath: "must-not-be-spawned",
        detectedVersion: () => "0.144.3",
        shellStartupDirectory: "/must-not-be-inspected",
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
    promptTripwireVersion: "0.1.7",
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

test("AC-002: an external tracked symlink blocks the batch before any probe thread", async () => {
  const parent = await mkdtemp(join(tmpdir(), "prompt-tripwire-coordinator-symlink-"));
  const repository = join(parent, "repository");
  const outside = join(parent, "outside.txt");
  await mkdir(repository);
  await writeFile(join(repository, "README.md"), "# Fixture\n");
  await writeFile(outside, "outside\n");
  await symlink(outside, join(repository, "outside-link"));
  git(repository, ["init", "-b", "main"]);
  git(repository, ["config", "user.email", "fixture@example.invalid"]);
  git(repository, ["config", "user.name", "PromptTripwire Fixture"]);
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "fixture with external symlink"]);
  const prepared = await prepareRepositorySnapshot({
    repositoryPath: repository,
    task: "Inspect the fixture without changing it",
    model: { id: "gpt-5.4", reasoningEffort: "high" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.7",
    effectiveConfig: { probeCount: 3 },
    createdAt: "2026-07-14T00:00:00.000Z",
  });
  const runner = new ConfigurableRunner();
  const before = git(repository, ["status", "--porcelain=v1"]);
  try {
    const result = await new ProbeCoordinator(runner).run({ prepared });
    assert.equal(result.blocked, true);
    assert.equal(result.degraded, false);
    assert.equal(result.blockingReason, "PROBE_CONTAINMENT_VIOLATION");
    assert.equal(result.plans.length, 0);
    assert.equal(runner.calls.length, 0);
    assert.ok(
      result.attempts.every((attempt) => attempt.errorCode === "PROBE_CONTAINMENT_VIOLATION"),
    );
    assert.ok(result.worktrees.every((entry) => entry.cleanup.success));
    assert.equal(git(repository, ["status", "--porcelain=v1"]), before);
  } finally {
    await rm(parent, { recursive: true, force: true });
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
