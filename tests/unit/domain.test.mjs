import assert from "node:assert/strict";
import test from "node:test";

import {
  ComparisonCandidateSchema,
  DecisionPointSchema,
  DeviationRecordSchema,
  DomainInvariantError,
  ExecutionContractDraftSchema,
  ExecutionRecordSchema,
  HumanDecisionSchema,
  PlanArtifactSchema,
  ProbeRecordSchema,
  RepositorySnapshotInputSchema,
  RunReportSchema,
  RunRecordSchema,
  SnapshotDriftReason,
  amendExecutionContract,
  approveExecutionContract,
  canonicalHash,
  createExecutionContract,
  createRepositorySnapshot,
  detectSnapshotDrift,
  executionContractContentHash,
  renderRunReportMarkdown,
  serializeRunReportJson,
  startExecution,
  transitionRun,
  verifyExecutionContract,
  verifyRepositorySnapshot,
} from "../../packages/domain/dist/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function snapshotInput(overrides = {}) {
  return {
    repositoryPath: "/tmp/repository",
    commitSha: "1".repeat(40),
    branch: "main",
    submodules: {},
    dirtyPatchHash: null,
    instructionHash: HASH_A,
    configHash: HASH_B,
    task: "Implement the approved behavior\nwithout side effects.",
    model: { id: "gpt-5.4", reasoningEffort: "high" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.9",
    createdAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

function contractDraft(snapshot, overrides = {}) {
  return {
    version: 1,
    runId: "run_1",
    snapshotHash: snapshot.snapshotHash,
    taskHash: snapshot.taskHash,
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
    humanDecisions: [
      {
        decisionId: "decision_1",
        selectedOptionId: "option_1",
        freeformOverride: null,
        rationale: "smallest compatible change",
        expectedRunVersion: 3,
        decidedAt: "2026-07-14T00:01:00.000Z",
      },
    ],
    unresolvedNonBlockingUnknowns: [],
    modelVersions: { codex: "gpt-5.4", comparator: "gpt-5.6", policy: "1" },
    createdAt: "2026-07-14T00:02:00.000Z",
    approvedAt: null,
    ...overrides,
  };
}

function planArtifact() {
  return {
    probeId: "probe_1",
    threadId: "thread_1",
    snapshotHash: HASH_A,
    taskHash: HASH_B,
    summary: "Plan",
    assumptions: [],
    intendedBehavior: [],
    filesToRead: [],
    filesToChange: [],
    components: [],
    dataChanges: [],
    publicApiChanges: [],
    dependencyChanges: [],
    commands: [],
    externalEffects: [],
    permissionChanges: [],
    compatibilityImpacts: [],
    reversibility: "reversible",
    verificationSteps: [],
    unknowns: [],
    repositoryEvidence: [],
  };
}

function comparisonCandidate() {
  return {
    comparisonId: "comparison_1",
    snapshotHash: HASH_A,
    taskHash: HASH_B,
    planIds: ["plan_1", "plan_2"],
    consensus: [],
    divergences: [],
    unknowns: [],
  };
}

function decisionPoint() {
  return {
    decisionId: "decision_1",
    category: "behavior",
    question: "Which behavior should be implemented?",
    reason: "The plans diverge.",
    impact: "medium",
    options: [
      {
        id: "option_1",
        label: "A",
        description: "Behavior A",
        effects: [],
        supportedByProbeIds: ["probe_1"],
        evidenceRefs: [],
      },
      {
        id: "option_2",
        label: "B",
        description: "Behavior B",
        effects: [],
        supportedByProbeIds: ["probe_2"],
        evidenceRefs: [],
      },
    ],
    freeformAllowed: true,
    defaultOptionId: "option_1",
    deterministicTriggers: [],
    evidenceRefs: [],
    status: "unresolved",
  };
}

function runRecord(snapshot, contract, overrides = {}) {
  return {
    runId: "run_1",
    state: "approved",
    version: 4,
    snapshotHash: snapshot.snapshotHash,
    taskHash: snapshot.taskHash,
    activeContractId: contract.contractId,
    blockingDecisionIds: [],
    lastErrorCode: null,
    updatedAt: "2026-07-14T00:04:00.000Z",
    ...overrides,
  };
}

test("domain schemas reject unknown fields and missing required fields", () => {
  const snapshot = createRepositorySnapshot(snapshotInput());
  const fixtures = [
    [RepositorySnapshotInputSchema, snapshotInput()],
    [PlanArtifactSchema, planArtifact()],
    [ComparisonCandidateSchema, comparisonCandidate()],
    [DecisionPointSchema, decisionPoint()],
    [ExecutionContractDraftSchema, contractDraft(snapshot)],
    [
      RunRecordSchema,
      {
        runId: "run_1",
        state: "needs_review",
        version: 1,
        snapshotHash: snapshot.snapshotHash,
        taskHash: snapshot.taskHash,
        activeContractId: null,
        blockingDecisionIds: [],
        lastErrorCode: null,
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
    ],
    [
      ProbeRecordSchema,
      {
        probeId: "probe_1",
        runId: "run_1",
        threadId: null,
        state: "pending",
        attempt: 1,
        lastErrorCode: null,
      },
    ],
    [
      ExecutionRecordSchema,
      {
        executionId: "execution_1",
        runId: "run_1",
        threadId: null,
        contractId: "contract_1",
        state: "not_started",
        worktreeId: "worktree_1",
        lastErrorCode: null,
      },
    ],
    [
      DeviationRecordSchema,
      {
        deviationId: "deviation_1",
        runId: "run_1",
        executionId: "execution_1",
        state: "observed",
        category: "path",
        contractClause: "allowedPaths",
        evidenceRefs: [],
        observedAt: "2026-07-14T00:00:00.000Z",
      },
    ],
  ];

  for (const [schema, value] of fixtures) {
    assert.equal(schema.safeParse({ ...value, unexpected: true }).success, false);
    const [requiredKey] = Object.keys(value);
    const missing = { ...value };
    delete missing[requiredKey];
    assert.equal(schema.safeParse(missing).success, false);
  }
});

test("FR-015 report schema provides deterministic JSON and Markdown entry points", () => {
  const report = RunReportSchema.parse({
    reportVersion: 1,
    runId: "run_report",
    state: "completed",
    snapshotHash: HASH_A,
    taskHash: HASH_B,
    contractId: "contract_1",
    contractHash: HASH_A,
    threadIds: ["thread_1"],
    modelIds: ["gpt-5.4"],
    decisions: [],
    observedActions: [],
    diffSummary: {
      changedPaths: ["packages/domain/src/reports.ts"],
      withinContract: true,
      evidenceRefs: [],
    },
    checks: [
      {
        checkId: "check_1",
        command: "npm run test:unit",
        outcome: "passed",
        exitCode: 0,
        reason: null,
        evidenceRefs: [],
      },
    ],
    deviations: [],
    remainingUnknowns: [],
    generatedAt: "2026-07-14T00:10:00.000Z",
  });
  assert.deepEqual(JSON.parse(serializeRunReportJson(report)), report);
  assert.match(renderRunReportMarkdown(report), /npm run test:unit — passed/u);
  assert.throws(() => RunReportSchema.parse({ ...report, contractHash: null }));
});

test("decision schemas reject unsafe defaults and ambiguous human answers", () => {
  assert.equal(
    DecisionPointSchema.safeParse({
      ...decisionPoint(),
      impact: "high",
      defaultOptionId: "option_1",
    }).success,
    false,
  );
  assert.equal(
    HumanDecisionSchema.safeParse({
      decisionId: "decision_1",
      selectedOptionId: "option_1",
      freeformOverride: "override",
      rationale: null,
      expectedRunVersion: 1,
      decidedAt: "2026-07-14T00:00:00.000Z",
    }).success,
    false,
  );
});

test("canonical hashes ignore object order, line endings, and display-only timestamps", () => {
  const first = {
    z: "line 1\r\nline 2",
    createdAt: "2026-07-14T00:00:00.000Z",
    nested: { updatedAt: "2026-07-14T00:00:00.000Z", a: 1 },
  };
  const second = {
    nested: { a: 1, updatedAt: "2027-01-01T00:00:00.000Z" },
    createdAt: "2027-01-01T00:00:00.000Z",
    z: "line 1\nline 2",
  };
  assert.equal(canonicalHash(first), canonicalHash(second));

  const snapshot = createRepositorySnapshot(snapshotInput());
  const decisionAtFirst = contractDraft(snapshot);
  const decisionAtSecond = {
    ...decisionAtFirst,
    humanDecisions: [
      {
        ...decisionAtFirst.humanDecisions[0],
        decidedAt: "2027-01-01T00:00:00.000Z",
      },
    ],
  };
  assert.equal(
    executionContractContentHash(decisionAtFirst),
    executionContractContentHash(decisionAtSecond),
  );

  const crlfSnapshot = createRepositorySnapshot(snapshotInput({ task: "line 1\r\nline 2" }));
  const lfSnapshot = createRepositorySnapshot(
    snapshotInput({ task: "line 1\nline 2", createdAt: "2027-01-01T00:00:00.000Z" }),
  );
  assert.equal(crlfSnapshot.task, "line 1\nline 2");
  assert.equal(crlfSnapshot.snapshotHash, lfSnapshot.snapshotHash);
  assert.equal(crlfSnapshot.taskHash, lfSnapshot.taskHash);
});

test("every semantic contract boundary changes the content hash", () => {
  const snapshot = createRepositorySnapshot(snapshotInput());
  const base = contractDraft(snapshot);
  const baseHash = executionContractContentHash(base);
  const changes = [
    { approvedGoal: "Implement a different behavior" },
    { approvedBehaviors: ["different behavior"] },
    { approvedAssumptions: ["different assumption"] },
    { allowedComponents: ["controller"] },
    { allowedPaths: ["apps/controller/src/index.ts"] },
    { protectedPaths: ["docs/SECURITY.md"] },
    { allowedCommandClasses: ["build"] },
    { deniedCommandClasses: ["migration"] },
    {
      networkPolicy: {
        mode: "allowlist",
        hosts: ["api.openai.com"],
        actions: ["read"],
      },
    },
    { dependencyPolicy: { mode: "allowlist", allowed: ["zod"] } },
    { dataPolicy: { mode: "allowlist", allowed: ["local sqlite"] } },
    { externalEffectPolicy: { mode: "allowlist", allowed: ["issue comment"] } },
    { requiredChecks: ["npm run check"] },
    { stopConditions: ["policy uncertainty"] },
    {
      humanDecisions: [
        {
          ...base.humanDecisions[0],
          selectedOptionId: "option_2",
        },
      ],
    },
    { unresolvedNonBlockingUnknowns: ["platform behavior"] },
    { modelVersions: { ...base.modelVersions, policy: "2" } },
    { snapshotHash: "c".repeat(64) },
    { taskHash: "d".repeat(64) },
  ];
  for (const change of changes) {
    assert.notEqual(executionContractContentHash({ ...base, ...change }), baseHash);
  }
});

test("approval preserves hash and immutability while amendments create a fresh version", () => {
  const snapshot = createRepositorySnapshot(snapshotInput());
  const contract = createExecutionContract(contractDraft(snapshot));
  const approved = approveExecutionContract(contract, "2026-07-14T00:03:00.000Z");

  assert.equal(approved.contentHash, contract.contentHash);
  assert.equal(approved.contractId, contract.contractId);
  assert.equal(verifyExecutionContract(approved), true);
  assert.equal(Object.isFrozen(approved), true);
  assert.equal(Object.isFrozen(approved.allowedPaths), true);
  assert.throws(() => approved.allowedPaths.push("README.md"), TypeError);

  const amended = amendExecutionContract(approved, {
    approvedBehaviors: ["return an amended result"],
    createdAt: "2026-07-14T00:05:00.000Z",
  });
  assert.equal(amended.version, approved.version + 1);
  assert.equal(amended.approvedAt, null);
  assert.notEqual(amended.contentHash, approved.contentHash);
  assert.notEqual(amended.contractId, approved.contractId);
  assert.equal(verifyExecutionContract(amended), true);
});

test("snapshot verification and drift cover every approval binding", () => {
  const approved = createRepositorySnapshot(snapshotInput());
  assert.equal(verifyRepositorySnapshot(approved), true);

  const cases = [
    [SnapshotDriftReason.RepositoryPath, { repositoryPath: "/tmp/other-repository" }],
    [SnapshotDriftReason.Commit, { commitSha: "2".repeat(40) }],
    [SnapshotDriftReason.Branch, { branch: "feature" }],
    [SnapshotDriftReason.Submodules, { submodules: { dependency: "2".repeat(40) } }],
    [SnapshotDriftReason.DirtyPatch, { dirtyPatchHash: "c".repeat(64) }],
    [SnapshotDriftReason.Task, { task: "Different task" }],
    [SnapshotDriftReason.Instructions, { instructionHash: "c".repeat(64) }],
    [SnapshotDriftReason.Config, { configHash: "c".repeat(64) }],
    [SnapshotDriftReason.Model, { model: { id: "gpt-5.4", reasoningEffort: "medium" } }],
    [SnapshotDriftReason.CodexVersion, { codexVersion: "0.145.0" }],
    [SnapshotDriftReason.PromptTripwireVersion, { promptTripwireVersion: "0.2.0" }],
  ];
  for (const [reason, change] of cases) {
    const current = createRepositorySnapshot(snapshotInput(change));
    assert.deepEqual(detectSnapshotDrift(approved, current), [reason]);
  }

  assert.deepEqual(detectSnapshotDrift(approved, { ...approved, snapshotHash: "c".repeat(64) }), [
    SnapshotDriftReason.SnapshotHash,
  ]);
});

test("execution starts only from an approved matching contract and snapshot", () => {
  const snapshot = createRepositorySnapshot(snapshotInput());
  const draftContract = createExecutionContract(contractDraft(snapshot));
  const approvedContract = approveExecutionContract(draftContract, "2026-07-14T00:03:00.000Z");
  const run = runRecord(snapshot, approvedContract);

  const running = startExecution({
    run,
    contract: approvedContract,
    currentSnapshot: snapshot,
    expectedVersion: run.version,
    updatedAt: "2026-07-14T00:05:00.000Z",
  });
  assert.equal(running.state, "running");
  assert.equal(running.version, run.version + 1);

  const rejected = [
    [
      runRecord(snapshot, approvedContract, { state: "ready_for_approval" }),
      approvedContract,
      snapshot,
    ],
    [run, draftContract, snapshot],
    [
      runRecord(snapshot, approvedContract, { blockingDecisionIds: ["decision_1"] }),
      approvedContract,
      snapshot,
    ],
    [run, approvedContract, createRepositorySnapshot(snapshotInput({ commitSha: "2".repeat(40) }))],
  ];
  for (const [rejectedRun, contract, currentSnapshot] of rejected) {
    assert.throws(
      () =>
        startExecution({
          run: rejectedRun,
          contract,
          currentSnapshot,
          expectedVersion: rejectedRun.version,
          updatedAt: "2026-07-14T00:05:00.000Z",
        }),
      DomainInvariantError,
    );
  }
});

test("persisted review and paused states never become executable after restart", () => {
  const snapshot = createRepositorySnapshot(snapshotInput());
  const contract = createExecutionContract(contractDraft(snapshot));
  const persistedStates = ["needs_review", "paused"];

  for (const state of persistedStates) {
    const restored = RunRecordSchema.parse(
      JSON.parse(
        JSON.stringify(
          runRecord(snapshot, contract, {
            state,
            activeContractId: state === "paused" ? contract.contractId : null,
          }),
        ),
      ),
    );
    assert.equal(restored.state, state);
    assert.throws(
      () =>
        startExecution({
          run: restored,
          contract,
          currentSnapshot: snapshot,
          expectedVersion: restored.version,
          updatedAt: "2026-07-14T00:05:00.000Z",
        }),
      DomainInvariantError,
    );
  }
});

test("state transitions reject invalid paths and optimistic-version conflicts", () => {
  const snapshot = createRepositorySnapshot(snapshotInput());
  const contract = createExecutionContract(contractDraft(snapshot));
  const run = runRecord(snapshot, contract, { state: "created", version: 0 });
  assert.throws(
    () => transitionRun(run, "completed", 0, "2026-07-14T00:05:00.000Z"),
    DomainInvariantError,
  );
  assert.throws(
    () => transitionRun(run, "snapshotting", 1, "2026-07-14T00:05:00.000Z"),
    (error) => error instanceof DomainInvariantError && error.code === "CONFLICTING_VERSION",
  );
});
