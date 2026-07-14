import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PlanComparator,
  createContractPreview,
  createReviewRound,
  normalizeReview,
  renderContractPreview,
  renderDecisionCards,
} from "../../packages/openai-comparator/dist/index.js";
import {
  InspectionPipeline,
  LocalController,
  withTimeout,
} from "../../apps/controller/dist/index.js";
import { runCli } from "../../apps/cli/dist/index.js";
import {
  approveExecutionContract,
  createRepositorySnapshot,
  verifyExecutionContract,
} from "../../packages/domain/dist/index.js";
import { SqlitePersistence } from "../../packages/persistence/dist/index.js";

const HASH = "0".repeat(64);
const USAGE = {
  inputTokens: 100,
  outputTokens: 40,
  totalTokens: 140,
  reasoningTokens: 20,
};

function snapshot() {
  return createRepositorySnapshot({
    repositoryPath: "/tmp/prompt-tripwire-comparator-fixture",
    commitSha: "1".repeat(40),
    branch: "main",
    submodules: {},
    dirtyPatchHash: null,
    instructionHash: HASH,
    configHash: HASH,
    task: "Implement a local validation helper",
    model: { id: "gpt-5.6-sol", reasoningEffort: "low" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.0",
    createdAt: "2026-07-14T00:00:00.000Z",
  });
}

function preparedSnapshot() {
  const approved = snapshot();
  return {
    snapshot: approved,
    patch: null,
    inspection: {
      repositoryPath: approved.repositoryPath,
      workingDirectory: approved.repositoryPath,
      workingDirectoryRelative: ".",
      commitSha: approved.commitSha,
      branch: approved.branch,
      submodules: approved.submodules,
      changes: [],
      trackedChangeCount: 0,
      untrackedFileCount: 0,
      isDirty: false,
      hasUnrepresentableSubmoduleChange: false,
    },
    excludedUntrackedFileCount: 0,
    parameters: {
      repositoryPath: approved.repositoryPath,
      task: approved.task,
      model: approved.model,
      codexVersion: approved.codexVersion,
      promptTripwireVersion: approved.promptTripwireVersion,
      contentMode: "committed_only",
      effectiveConfigHash: approved.configHash,
      configPaths: [],
      externalInstructionHashes: {},
    },
  };
}

function plan(probeId, overrides = {}) {
  const approved = snapshot();
  return {
    probeId,
    threadId: `thread_${probeId}`,
    snapshotHash: approved.snapshotHash,
    taskHash: approved.taskHash,
    summary: "Implement the requested local helper.",
    assumptions: [],
    intendedBehavior: ["Validate input locally."],
    filesToRead: ["src/validator.ts"],
    filesToChange: ["src/validator.ts"],
    components: ["validator"],
    dataChanges: [],
    publicApiChanges: [],
    dependencyChanges: [],
    commands: ["npm run test:unit"],
    externalEffects: [],
    permissionChanges: [],
    compatibilityImpacts: [],
    reversibility: "reversible",
    verificationSteps: ["Run unit tests."],
    unknowns: [],
    repositoryEvidence: [
      {
        id: `evidence_${probeId}`,
        path: "src/validator.ts",
        startLine: 1,
        endLine: 10,
        description: "Existing validation entry point.",
      },
    ],
    ...overrides,
  };
}

function subject(id, overrides = {}) {
  return {
    id,
    summary: "The plans use equivalent local validation behavior.",
    affectedBehaviors: ["Validate input locally."],
    affectedFiles: ["src/validator.ts"],
    affectedData: [],
    affectedApis: [],
    affectedCommands: [],
    affectedExternalSystems: [],
    evidenceRefs: [],
    ...overrides,
  };
}

function safeContent(overrides = {}) {
  return {
    consensus: [subject("subject_consensus")],
    divergences: [],
    unknowns: [],
    ...overrides,
  };
}

function response(output, overrides = {}) {
  return {
    responseId: "response_fixture",
    model: "gpt-5.6-terra",
    output,
    refused: false,
    usage: USAGE,
    ...overrides,
  };
}

class QueueTransport {
  constructor(entries) {
    this.entries = [...entries];
    this.requests = [];
  }

  async compare(request, options) {
    this.requests.push(request);
    const entry = this.entries.shift();
    if (entry === "wait") {
      return await new Promise((resolve, reject) => {
        void resolve;
        options.signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    }
    if (entry instanceof Error) throw entry;
    if (entry === undefined) throw new Error("fixture transport exhausted");
    return entry;
  }
}

function compareInput(plans, overrides = {}) {
  return {
    snapshot: snapshot(),
    plans,
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
    timeoutMs: 100,
    maxAttempts: 2,
    ...overrides,
  };
}

function probeBatch(plans, overrides = {}) {
  return {
    snapshotHash: snapshot().snapshotHash,
    taskHash: snapshot().taskHash,
    model: snapshot().model.id,
    reasoningEffort: snapshot().model.reasoningEffort,
    attempts: plans.map((artifact) => ({
      probeId: artifact.probeId,
      attempt: 1,
      state: "completed",
      threadId: artifact.threadId,
      artifact,
      errorCode: null,
      errorReason: null,
      approvals: [],
      events: [],
    })),
    plans,
    worktrees: [],
    degraded: false,
    blocked: false,
    blockingReason: null,
    ...overrides,
  };
}

function divergenceContent(plans) {
  return safeContent({
    consensus: [],
    divergences: [
      {
        subject: subject("subject_storage", {
          summary: "Retention behavior differs.",
          affectedBehaviors: ["Retain or delete rejected records."],
          affectedData: ["rejected records"],
          evidenceRefs: plans.map((item) => `evidence_${item.probeId}`),
        }),
        alternatives: [
          {
            id: "alternative_retain",
            label: "Retain records",
            description: "Keep rejected records for review.",
            effects: ["Persistent records remain available."],
            supportedByProbeIds: [plans[0].probeId],
            evidenceRefs: [`evidence_${plans[0].probeId}`],
            reversibility: "reversible",
          },
          {
            id: "alternative_delete",
            label: "Delete records",
            description: "Delete rejected records immediately.",
            effects: ["Rejected records are permanently removed."],
            supportedByProbeIds: plans.slice(1).map((item) => item.probeId),
            evidenceRefs: plans.slice(1).map((item) => `evidence_${item.probeId}`),
            reversibility: "irreversible",
          },
        ],
        suggestedQuestion: "Should rejected records be retained or deleted?",
        recommendation: null,
      },
    ],
  });
}

test("AC-003/AC-008: validated Responses output is bound to the approved inputs", async () => {
  const plans = [plan("probe_1"), plan("probe_2"), plan("probe_3")];
  const transport = new QueueTransport([response(divergenceContent(plans))]);
  const result = await new PlanComparator(transport).compare(compareInput(plans));

  assert.equal(result.candidate.snapshotHash, snapshot().snapshotHash);
  assert.equal(result.candidate.taskHash, snapshot().taskHash);
  assert.deepEqual(result.candidate.planIds, ["probe_1", "probe_2", "probe_3"]);
  assert.equal(result.attempts.length, 1);
  assert.deepEqual(result.usage, USAGE);
  assert.deepEqual(Object.keys(transport.requests[0]).sort(), [
    "model",
    "plans",
    "reasoningEffort",
    "task",
  ]);
});

test("AC-008/AC-019: refusal and invalid references retry once without auto-approval", async () => {
  const plans = [plan("probe_1"), plan("probe_2"), plan("probe_3")];
  const invalid = safeContent({
    consensus: [subject("subject_invalid", { evidenceRefs: ["invented_evidence"] })],
  });
  const transport = new QueueTransport([
    response(null, { refused: true }),
    response(safeContent()),
  ]);
  const comparator = new PlanComparator(transport);

  const afterRefusal = await comparator.compare(compareInput(plans));
  assert.deepEqual(
    afterRefusal.attempts.map((attempt) => attempt.state),
    ["refused", "completed"],
  );
  assert.equal(afterRefusal.candidate.divergences.length, 0);

  await assert.rejects(
    new PlanComparator(new QueueTransport([response(invalid)])).compare(
      compareInput(plans, { maxAttempts: 1 }),
    ),
    (error) => error.code === "COMPARATOR_RESPONSE_INVALID",
  );
});

test("AC-008/AC-019: repeated refusal, parse failure, and timeout fail closed", async () => {
  const plans = [plan("probe_1"), plan("probe_2")];
  for (const [entries, code, timeoutMs] of [
    [
      [response(null, { refused: true }), response(null, { refused: true })],
      "COMPARATOR_REFUSAL",
      100,
    ],
    [[response(null), response(null)], "COMPARATOR_PARSE_FAILED", 100],
    [["wait"], "COMPARATOR_TIMEOUT", 5],
  ]) {
    await assert.rejects(
      new PlanComparator(new QueueTransport(entries)).compare(
        compareInput(plans, { maxAttempts: entries.length === 1 ? 1 : 2, timeoutMs }),
      ),
      (error) => error.code === code,
    );
  }
});

test("AC-019: controller timeout waits for cooperative cleanup before returning", async () => {
  let cleaned = false;
  await assert.rejects(
    withTimeout(
      5,
      async (signal) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              setImmediate(() => {
                cleaned = true;
                reject(signal.reason);
              });
            },
            { once: true },
          );
        }),
    ),
    (error) => error.code === "OPERATION_TIMEOUT",
  );
  assert.equal(cleaned, true);
});

test("AC-003/AC-004: material alternatives and unanimous risky effects become decisions", async () => {
  const plans = [
    plan("probe_1", { dataChanges: ["delete rejected records"] }),
    plan("probe_2", { dataChanges: ["delete rejected records"] }),
    plan("probe_3", { dataChanges: ["delete rejected records"] }),
  ];
  const result = await new PlanComparator(
    new QueueTransport([response(divergenceContent(plans))]),
  ).compare(compareInput(plans));
  const review = normalizeReview({
    candidate: result.candidate,
    plans,
    model: result.model,
    reasoningEffort: result.reasoningEffort,
    usage: result.usage,
    degraded: false,
  });

  const divergence = review.decisions.find((decision) =>
    decision.question.includes("retained or deleted"),
  );
  assert.ok(divergence);
  assert.deepEqual(
    divergence.options.map((option) => option.supportedByProbeIds),
    [["probe_1"], ["probe_2", "probe_3"]],
  );
  assert.ok(divergence.options.every((option) => option.effects.length > 0));
  assert.ok(
    review.decisions.some((decision) =>
      decision.deterministicTriggers.includes("destructive_data"),
    ),
  );
  assert.equal(createReviewRound(review.decisions).executionAllowed, false);

  const rendered = renderDecisionCards(review.decisions);
  assert.match(rendered, /Probe support:/u);
  assert.match(rendered, /Evidence:/u);
  assert.match(rendered, /Required by policy: destructive_data/u);
  assert.doesNotMatch(rendered, /repositoryEvidence/u);
});

test("AC-005/AC-007: equivalent safe plans produce an immutable approval preview", async () => {
  const plans = [plan("probe_1"), plan("probe_2"), plan("probe_3")];
  const result = await new PlanComparator(new QueueTransport([response(safeContent())])).compare(
    compareInput(plans),
  );
  const review = normalizeReview({
    candidate: result.candidate,
    plans,
    model: result.model,
    reasoningEffort: result.reasoningEffort,
    usage: result.usage,
    degraded: false,
  });
  assert.deepEqual(review.decisions, []);

  const preview = createContractPreview({
    runId: "run_safe",
    snapshot: snapshot(),
    plans,
    comparison: result.candidate,
    decisions: review.decisions,
    humanDecisions: [],
    comparatorModel: result.model,
    createdAt: "2026-07-14T00:01:00.000Z",
  }).contract;
  assert.equal(preview.approvedAt, null);
  assert.equal(verifyExecutionContract(preview), true);
  assert.match(renderContractPreview(preview), new RegExp(preview.contentHash, "u"));
  assert.match(renderContractPreview(preview), /explicit approval is required/u);

  const approved = approveExecutionContract(preview, "2026-07-14T00:02:00.000Z");
  assert.equal(approved.contentHash, preview.contentHash);
  assert.equal(verifyExecutionContract(approved), true);
  assert.throws(() => {
    approved.allowedPaths.push("src/other.ts");
  });
});

test("AC-006/AC-007: at most three decisions render and each answer changes the contract hash", async () => {
  const plans = [plan("probe_1"), plan("probe_2"), plan("probe_3")];
  const candidate = (
    await new PlanComparator(new QueueTransport([response(divergenceContent(plans))])).compare(
      compareInput(plans),
    )
  ).candidate;
  const base = normalizeReview({
    candidate,
    plans,
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
    usage: USAGE,
    degraded: false,
  });
  const decisions = Array.from({ length: 5 }, (_, index) => ({
    ...base.decisions[0],
    decisionId: `${base.decisions[0].decisionId}_${String(index)}`,
  }));
  const round = createReviewRound(decisions);
  assert.equal(round.decisions.length, 3);
  assert.equal(round.remainingCount, 2);
  assert.match(renderDecisionCards(decisions), /Remaining after this round: 2/u);

  const answers = decisions.map((decision) => ({
    decisionId: decision.decisionId,
    selectedOptionId: decision.options[0].id,
    freeformOverride: null,
    rationale: null,
    expectedRunVersion: 1,
    decidedAt: "2026-07-14T00:01:00.000Z",
  }));
  const input = {
    runId: "run_decisions",
    snapshot: snapshot(),
    plans,
    comparison: candidate,
    decisions: decisions.map((decision) => ({ ...decision, status: "resolved" })),
    comparatorModel: "gpt-5.6-terra",
    createdAt: "2026-07-14T00:02:00.000Z",
  };
  const first = createContractPreview({ ...input, humanDecisions: answers }).contract;
  const changed = createContractPreview({
    ...input,
    humanDecisions: [
      { ...answers[0], selectedOptionId: decisions[0].options[1].id },
      ...answers.slice(1),
    ],
  }).contract;
  assert.notEqual(first.contentHash, changed.contentHash);
  assert.notEqual(first.contractId, changed.contractId);
});

test("AC-007/AC-019: review artifacts and idempotent answers survive restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-comparison-store-"));
  const options = {
    databasePath: join(root, "private", "tripwire.sqlite3"),
    artifactRoot: join(root, "private", "artifacts"),
  };
  const approvedSnapshot = snapshot();
  let store = new SqlitePersistence(options);
  try {
    store.createRun({
      runId: "run_review",
      state: "probing",
      version: 2,
      snapshotHash: approvedSnapshot.snapshotHash,
      taskHash: approvedSnapshot.taskHash,
      activeContractId: null,
      blockingDecisionIds: [],
      lastErrorCode: null,
      updatedAt: "2026-07-14T00:00:00.000Z",
    });
    store.saveSnapshot("run_review", approvedSnapshot);
    const storedPlans = [plan("probe_1"), plan("probe_2"), plan("probe_3")].map(
      (artifact, index) => {
        store.recordProbeRun({
          runId: "run_review",
          probeId: artifact.probeId,
          attempt: 1,
          threadId: artifact.threadId,
          state: "completed",
          errorCode: null,
          worktreeId: null,
          createdAt: `2026-07-14T00:00:0${String(index)}.000Z`,
        });
        return store.savePlanArtifact(
          "run_review",
          index === 0
            ? { ...artifact, summary: "Never persist api_key=synthetic-secret-value" }
            : artifact,
        ).artifact;
      },
    );
    assert.match(storedPlans[0].summary, /\[REDACTED\]/u);

    const compared = await new PlanComparator(
      new QueueTransport([response(divergenceContent(storedPlans))]),
    ).compare(compareInput(storedPlans));
    store.saveComparison({
      runId: "run_review",
      candidate: compared.candidate,
      model: compared.model,
      reasoningEffort: compared.reasoningEffort,
      attempts: compared.attempts,
      createdAt: "2026-07-14T00:01:00.000Z",
    });
    const review = normalizeReview({
      candidate: compared.candidate,
      plans: storedPlans,
      model: compared.model,
      reasoningEffort: compared.reasoningEffort,
      usage: compared.usage,
      degraded: false,
    });
    store.saveDecisionPoints({
      runId: "run_review",
      comparisonId: compared.candidate.comparisonId,
      decisions: review.decisions,
      createdAt: "2026-07-14T00:01:00.000Z",
    });
    const comparing = store.setBlockingDecisionsAndTransition(
      "run_review",
      review.decisions.map((decision) => decision.decisionId),
      2,
      "comparing",
      "2026-07-14T00:01:00.000Z",
    );
    let current = store.transitionRun(
      "run_review",
      "needs_review",
      comparing.version,
      "2026-07-14T00:01:01.000Z",
    );
    const answers = [];
    for (const decision of store.listDecisionPoints("run_review")) {
      const answer = {
        decisionId: decision.decisionId,
        selectedOptionId: decision.options[0].id,
        freeformOverride: null,
        rationale: null,
        expectedRunVersion: current.version,
        decidedAt: `2026-07-14T00:02:${String(answers.length).padStart(2, "0")}.000Z`,
      };
      const result = store.recordHumanDecision({
        idempotencyKey: `answer_${decision.decisionId}`,
        runId: "run_review",
        decision: answer,
      });
      assert.deepEqual(
        store.recordHumanDecision({
          idempotencyKey: `answer_${decision.decisionId}`,
          runId: "run_review",
          decision: answer,
        }),
        result,
      );
      current = result.run;
      answers.push(result.humanDecision);
    }
    assert.deepEqual(current.blockingDecisionIds, []);
    const persistedComparison = store.getComparison("run_review");
    assert.deepEqual(persistedComparison.attempts, compared.attempts);
    const preview = createContractPreview({
      runId: "run_review",
      snapshot: approvedSnapshot,
      plans: storedPlans,
      comparison: persistedComparison.candidate,
      decisions: store.listDecisionPoints("run_review"),
      humanDecisions: store.listHumanDecisions("run_review"),
      comparatorModel: persistedComparison.model,
      createdAt: "2026-07-14T00:03:00.000Z",
    }).contract;
    const ready = store.saveContractAndReady("run_review", preview, current.version);
    assert.equal(ready.state, "ready_for_approval");
    store.close();

    store = new SqlitePersistence(options);
    assert.equal(store.getRun("run_review").run.state, "ready_for_approval");
    assert.equal(store.getContract(preview.contractId).contentHash, preview.contentHash);
    assert.equal(store.listProbeRuns("run_review").length, 3);
    assert.equal(store.listPlanArtifacts("run_review").length, 3);
    assert.equal(store.listHumanDecisions("run_review").length, review.decisions.length);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("M1: controller pipeline reaches approval or fail-closed review states", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-pipeline-"));
  const store = new SqlitePersistence({
    databasePath: join(root, "prompt-tripwire.sqlite3"),
    artifactRoot: join(root, "artifacts"),
  });
  const threePlans = [plan("probe_1"), plan("probe_2"), plan("probe_3")];
  const twoPlans = threePlans.slice(0, 2);
  let probeCall = 0;
  const transport = new QueueTransport([
    response(safeContent()),
    response(null, { refused: true }),
    response(null, { refused: true }),
    response(safeContent()),
  ]);
  const pipeline = new InspectionPipeline({
    probes: {
      async run() {
        probeCall += 1;
        return probeCall === 3 ? probeBatch(twoPlans, { degraded: true }) : probeBatch(threePlans);
      },
    },
    comparator: new PlanComparator(transport),
    now: () => "2026-07-14T00:05:00.000Z",
  });
  const controller = new LocalController({
    store,
    inspectionPort: pipeline,
    prepareSnapshot: async () => preparedSnapshot(),
    now: () => "2026-07-14T00:05:00.000Z",
  });
  controller.start();
  try {
    const input = {
      repositoryPath: snapshot().repositoryPath,
      task: snapshot().task,
      model: snapshot().model,
      codexVersion: snapshot().codexVersion,
      promptTripwireVersion: snapshot().promptTripwireVersion,
    };
    const safe = await controller.inspect({ ...input, runId: "run_pipeline_safe" });
    assert.equal(safe.state, "ready_for_approval");
    assert.notEqual(safe.activeContractId, null);

    const fallback = await controller.inspect({ ...input, runId: "run_pipeline_fallback" });
    assert.equal(fallback.state, "needs_review");
    assert.ok(fallback.blockingDecisionIds.length > 0);
    assert.ok(
      store
        .listDecisionPoints(fallback.runId)
        .some((decision) => decision.deterministicTriggers.includes("unknown")),
    );
    assert.deepEqual(
      store.getComparison(fallback.runId).attempts.map((attempt) => attempt.state),
      ["refused", "refused"],
    );
    const fallbackDecision = store.listDecisionPoints(fallback.runId)[0];
    const deferred = controller.defer({
      runId: fallback.runId,
      decisionId: fallbackDecision.decisionId,
      expectedVersion: fallback.version,
      idempotencyKey: "defer_pipeline_fallback",
    });
    assert.equal(deferred.state, "needs_review");
    assert.equal(controller.review(fallback.runId).decisions[0].status, "deferred");
    const fallbackReady = controller.decide({
      runId: fallback.runId,
      decisionId: fallbackDecision.decisionId,
      selectedOptionId: null,
      freeformOverride: "Proceed with the local validator behavior shown by both plans.",
      expectedVersion: deferred.version,
      idempotencyKey: "decide_pipeline_fallback",
    });
    assert.equal(fallbackReady.state, "ready_for_approval");
    assert.equal(
      controller.approve({
        runId: fallback.runId,
        contractId: fallbackReady.activeContractId,
        expectedVersion: fallbackReady.version,
        idempotencyKey: "approve_pipeline_fallback",
      }).state,
      "approved",
    );

    const degraded = await controller.inspect({ ...input, runId: "run_pipeline_degraded" });
    assert.equal(degraded.state, "needs_review");
    assert.ok(
      store
        .listDecisionPoints(degraded.runId)
        .some((decision) => decision.deterministicTriggers.includes("degraded_probe_set")),
    );
    const degradedDecision = store.listDecisionPoints(degraded.runId)[0];
    const manualOption = degradedDecision.options.find((option) => option.id.endsWith("_manual"));
    assert.ok(manualOption);
    await controller.stop();

    let stdout = "";
    assert.equal(
      await runCli(
        [
          "review",
          degraded.runId,
          "--decision",
          degradedDecision.decisionId,
          "--option",
          manualOption.id,
          "--expected-version",
          String(degraded.version),
        ],
        {
          dataRoot: root,
          io: {
            stdout: { write: (value) => (stdout += value) },
            stderr: { write: () => undefined },
          },
        },
      ),
      0,
    );
    assert.match(stdout, /State: ready_for_approval/u);
    assert.match(stdout, /explicit approval is required/u);

    stdout = "";
    assert.equal(
      await runCli(["approve", degraded.runId], {
        dataRoot: root,
        io: {
          stdout: { write: (value) => (stdout += value) },
          stderr: { write: () => undefined },
        },
      }),
      0,
    );
    assert.match(stdout, /State: approved/u);
  } finally {
    await controller.stop();
    await rm(root, { recursive: true, force: true });
  }
});
