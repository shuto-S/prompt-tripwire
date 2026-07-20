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
  presentationStatus = null,
  presentationContent = null,
  probeIds = ["probe_1", "probe_2", "probe_3"],
  repositoryPath = "/tmp/prompt-tripwire-ui-fixture",
  task = "Implement an explicit persisted-record deletion policy",
  transformCandidate = (value) => value,
  transformDecision = (value) => value,
  transformPlan = (value) => value,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-ui-"));
  const store = new SqlitePersistence({
    databasePath: join(root, "prompt-tripwire.sqlite3"),
    artifactRoot: join(root, "artifacts"),
  });
  const snapshot = createRepositorySnapshot({
    repositoryPath,
    commitSha: "1".repeat(40),
    branch: "main",
    submodules: {},
    dirtyPatchHash: null,
    instructionHash: HASH,
    configHash: HASH,
    task,
    model: { id: "gpt-5.6-sol", reasoningEffort: "low" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.9",
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
  const plans = probeIds.map((probeId, index) =>
    store.savePlanArtifact(runId, transformPlan(plan(snapshot, probeId), index), CREATED_AT),
  );
  const decisions = Array.from({ length: decisionCount }, (_, index) =>
    transformDecision(decision(index, includeCancellationOption), index),
  );
  const candidate = transformCandidate(
    {
      comparisonId: `comparison_${runId}`,
      snapshotHash: snapshot.snapshotHash,
      taskHash: snapshot.taskHash,
      planIds: plans.map((item) => item.artifact.probeId),
      consensus: [],
      divergences: [],
      unknowns: [],
    },
    decisions,
  );
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
  store.saveDecisionPoints({
    runId,
    comparisonId: candidate.comparisonId,
    decisions,
    createdAt: CREATED_AT,
  });
  if (presentationStatus !== null) {
    store.saveReviewPresentation({
      runId,
      taskHash: snapshot.taskHash,
      status: presentationStatus,
      content:
        presentationStatus === "available"
          ? (presentationContent ?? {
              task: "永続レコードを明示的に削除する方針を実装する",
              decisions: decisions.map((item, index) => ({
                decisionId: item.decisionId,
                question: `永続レコードグループ${String(index + 1)}をどのように削除しますか？`,
                reason: "計画プローブ間で永続データ削除の意味が一致していません。",
                options: item.options.map((option, optionIndex) => ({
                  optionId: option.id,
                  label:
                    optionIndex === 0
                      ? "直ちに削除"
                      : optionIndex === 1
                        ? "復旧のため保持"
                        : "この実行をキャンセル",
                  description:
                    optionIndex === 0
                      ? "同じ操作で永続レコードを削除します。"
                      : optionIndex === 1
                        ? "復旧データを保持したまま削除済みにします。"
                        : "実行契約を作成せず停止します。",
                  effects: option.effects.map(
                    (_, effectIndex) =>
                      `選択肢${String(optionIndex + 1)}の影響${String(effectIndex + 1)}`,
                  ),
                })),
              })),
            })
          : null,
      model: "gpt-5.6-terra",
      errorCode: presentationStatus === "available" ? null : "TRANSLATION_TIMEOUT",
      createdAt: CREATED_AT,
    });
  }
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
