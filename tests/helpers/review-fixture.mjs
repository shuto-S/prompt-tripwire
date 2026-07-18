import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalController } from "../../apps/controller/dist/index.js";
import { createRepositorySnapshot } from "../../packages/domain/dist/index.js";
import { SqlitePersistence } from "../../packages/persistence/dist/index.js";

const HASH = "0".repeat(64);
const CREATED_AT = "2026-07-14T09:00:00.000Z";

function plan(snapshot, probeId) {
  return {
    probeId,
    threadId: `thread_${probeId}`,
    snapshotHash: snapshot.snapshotHash,
    taskHash: snapshot.taskHash,
    summary: `FULL PLAN SHOULD NOT LEAK: ${probeId}`,
    assumptions: ["The existing validation entry point remains stable."],
    intendedBehavior: ["Handle deletion according to the explicit human decision."],
    filesToRead: ["src/records.ts"],
    filesToChange: ["src/records.ts"],
    components: ["records"],
    dataChanges: ["Delete or retain persisted records."],
    publicApiChanges: [],
    dependencyChanges: [],
    commands: ["npm run test:unit"],
    externalEffects: [],
    permissionChanges: [],
    compatibilityImpacts: [],
    reversibility: "difficult",
    verificationSteps: ["Run unit tests."],
    unknowns: [],
    repositoryEvidence: [
      {
        id: `evidence_${probeId}`,
        path: "src/records.ts",
        startLine: 10,
        endLine: 24,
        description: "Existing record lifecycle logic.",
      },
    ],
  };
}

function decision(index, includeCancellationOption = false) {
  const decisionId = `decision_${String(index + 1)}`;
  return {
    decisionId,
    category: "destructive",
    question: `How should persisted record group ${String(index + 1)} be deleted?`,
    reason: "The planning probes disagree about persistent deletion semantics.",
    impact: "high",
    options: [
      {
        id: `${decisionId}_hard_delete`,
        label: "Delete immediately",
        description: "Remove the persisted records in the same operation.",
        effects: ["Permanent deletion", "No restore window"],
        supportedByProbeIds: ["probe_1"],
        evidenceRefs: ["evidence_probe_1"],
      },
      {
        id: `${decisionId}_retain`,
        label: "Retain for recovery",
        description: "Mark records deleted while retaining recovery data.",
        effects: ["Adds a recovery window", "Requires lifecycle handling"],
        supportedByProbeIds: ["probe_2", "probe_3"],
        evidenceRefs: ["evidence_probe_2", "evidence_probe_3"],
      },
      ...(includeCancellationOption
        ? [
            {
              id: `${decisionId}_cancel`,
              label: "Cancel this run",
              description: "Stop without creating an execution contract.",
              effects: ["The run is cancelled", "No implementation begins"],
              supportedByProbeIds: ["probe_1"],
              evidenceRefs: ["evidence_probe_1"],
            },
          ]
        : []),
    ],
    freeformAllowed: true,
    defaultOptionId: null,
    deterministicTriggers: ["persistent_data", "destructive"],
    evidenceRefs: ["evidence_probe_1", "evidence_probe_2"],
    status: "unresolved",
  };
}

export async function createReviewFixture({
  decisionCount = 1,
  runId = "run_ui",
  includeCancellationOption = false,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-ui-"));
  const store = new SqlitePersistence({
    databasePath: join(root, "prompt-tripwire.sqlite3"),
    artifactRoot: join(root, "artifacts"),
  });
  const snapshot = createRepositorySnapshot({
    repositoryPath: "/tmp/prompt-tripwire-ui-fixture",
    commitSha: "1".repeat(40),
    branch: "main",
    submodules: {},
    dirtyPatchHash: null,
    instructionHash: HASH,
    configHash: HASH,
    task: "Implement an explicit persisted-record deletion policy",
    model: { id: "gpt-5.6-sol", reasoningEffort: "low" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.4",
    createdAt: CREATED_AT,
  });
  store.createRun({
    runId,
    state: "created",
    version: 0,
    snapshotHash: snapshot.snapshotHash,
    taskHash: snapshot.taskHash,
    activeContractId: null,
    blockingDecisionIds: [],
    lastErrorCode: null,
    updatedAt: CREATED_AT,
  });
  store.saveSnapshot(runId, snapshot);
  const plans = ["probe_1", "probe_2", "probe_3"].map((probeId) =>
    store.savePlanArtifact(runId, plan(snapshot, probeId), CREATED_AT),
  );
  const candidate = {
    comparisonId: `comparison_${runId}`,
    snapshotHash: snapshot.snapshotHash,
    taskHash: snapshot.taskHash,
    planIds: plans.map((item) => item.artifact.probeId),
    consensus: [],
    divergences: [],
    unknowns: [],
  };
  store.saveComparison({
    runId,
    candidate,
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
    attempts: [
      {
        attempt: 1,
        state: "completed",
        responseId: `response_${runId}`,
        threadId: `thread_comparator_${runId}`,
        turnId: `turn_comparator_${runId}`,
        model: "gpt-5.6-terra",
        errorCode: null,
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, reasoningTokens: 5 },
      },
    ],
    createdAt: CREATED_AT,
  });
  const decisions = Array.from({ length: decisionCount }, (_, index) =>
    decision(index, includeCancellationOption),
  );
  store.saveDecisionPoints({
    runId,
    comparisonId: candidate.comparisonId,
    decisions,
    createdAt: CREATED_AT,
  });
  const snapshotting = store.transitionRun(runId, "snapshotting", 0, CREATED_AT);
  const probing = store.transitionRun(runId, "probing", snapshotting.version, CREATED_AT);
  const comparing = store.setBlockingDecisionsAndTransition(
    runId,
    decisions.map((item) => item.decisionId),
    probing.version,
    "comparing",
    CREATED_AT,
  );
  const run = store.transitionRun(runId, "needs_review", comparing.version, CREATED_AT);
  let clock = 0;
  const controller = new LocalController({
    store,
    now: () => `2026-07-14T09:${String(clock++).padStart(2, "0")}:00.000Z`,
  });
  controller.start();
  return {
    root,
    store,
    controller,
    run,
    decisions,
    async close() {
      await controller.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function createStateFixture(state, runId) {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-ui-state-"));
  const store = new SqlitePersistence({
    databasePath: join(root, "prompt-tripwire.sqlite3"),
    artifactRoot: join(root, "artifacts"),
  });
  store.createRun({
    runId,
    state,
    version: 0,
    snapshotHash: null,
    taskHash: HASH,
    activeContractId: null,
    blockingDecisionIds: [],
    lastErrorCode: null,
    updatedAt: CREATED_AT,
  });
  const controller = new LocalController({ store });
  controller.start();
  return {
    controller,
    async close() {
      await controller.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}
