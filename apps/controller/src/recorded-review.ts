import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRepositorySnapshot } from "@prompt-tripwire/domain";
import { SqlitePersistence } from "@prompt-tripwire/persistence";

import { LocalController } from "./controller.js";

const HASH = "0".repeat(64);
const CREATED_AT = "2026-07-15T00:00:00.000Z";

export interface RecordedReviewFixture {
  readonly controller: LocalController;
  readonly runId: string;
  close(): Promise<void>;
}

export async function createRecordedReviewFixture(): Promise<RecordedReviewFixture> {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-recorded-review-"));
  const store = new SqlitePersistence({
    databasePath: join(root, "prompt-tripwire.sqlite3"),
    artifactRoot: join(root, "artifacts"),
  });
  const runId = "run_recorded_build_week_review";
  const snapshot = createRepositorySnapshot({
    repositoryPath: "/safe-fixture/prompt-tripwire-judge",
    commitSha: "1".repeat(40),
    branch: "main",
    submodules: {},
    dirtyPatchHash: null,
    instructionHash: HASH,
    configHash: HASH,
    task: "Choose explicit account-deletion retention behavior before implementation",
    model: { id: "gpt-5.6-sol", reasoningEffort: "low" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.0",
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

  const plan = (
    probeId: string,
    behavior: string,
    reversibility: "irreversible" | "unknown" | "reversible" | "difficult",
  ) => ({
    probeId,
    threadId: `thread_recorded_${probeId}`,
    snapshotHash: snapshot.snapshotHash,
    taskHash: snapshot.taskHash,
    summary: `Implement ${behavior.toLowerCase()} with explicit lifecycle tests.`,
    assumptions: ["Deletion semantics must be selected by the product owner."],
    intendedBehavior: [behavior],
    filesToRead: ["src/accounts.ts", "test/accounts.test.ts"],
    filesToChange: ["src/accounts.ts", "test/accounts.test.ts"],
    components: ["accounts"],
    dataChanges: [behavior],
    publicApiChanges: [],
    dependencyChanges: [],
    commands: ["npm test"],
    externalEffects: [],
    permissionChanges: [],
    compatibilityImpacts: [],
    reversibility,
    verificationSteps: ["Run account lifecycle tests."],
    unknowns: [],
    repositoryEvidence: [
      {
        id: `evidence_recorded_${probeId}`,
        path: "src/accounts.ts",
        startLine: 12,
        endLine: 38,
        description: "The existing account lifecycle has no retention policy.",
      },
    ],
  });
  const plans = [
    plan("probe_1", "Delete account records immediately", "irreversible"),
    plan("probe_2", "Retain deleted records for 30 days", "reversible"),
    plan("probe_3", "Retain deleted records for 30 days", "reversible"),
  ].map((item) => store.savePlanArtifact(runId, item, CREATED_AT));

  const candidate = {
    comparisonId: "comparison_recorded_build_week_review",
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
        responseId: "response_recorded_build_week_review",
        threadId: "thread_recorded_comparator",
        turnId: "turn_recorded_comparator",
        model: "gpt-5.6-terra",
        errorCode: null,
        usage: { inputTokens: 24, outputTokens: 12, totalTokens: 36, reasoningTokens: 6 },
      },
    ],
    createdAt: CREATED_AT,
  });
  const decision = {
    decisionId: "decision_recorded_retention",
    category: "destructive" as const,
    question: "What should happen to persisted account data after deletion?",
    reason: "Independent plans disagree on irreversible deletion versus a recovery window.",
    impact: "high" as const,
    options: [
      {
        id: "decision_recorded_hard_delete",
        label: "Delete immediately",
        description: "Remove account data in the deletion operation.",
        effects: ["No recovery window", "Irreversible data loss"],
        supportedByProbeIds: ["probe_1"],
        evidenceRefs: ["evidence_recorded_probe_1"],
      },
      {
        id: "decision_recorded_retain",
        label: "Retain for 30 days",
        description: "Mark the account deleted and purge it after a recovery window.",
        effects: ["Recovery remains possible", "Requires lifecycle handling"],
        supportedByProbeIds: ["probe_2", "probe_3"],
        evidenceRefs: ["evidence_recorded_probe_2", "evidence_recorded_probe_3"],
      },
    ],
    freeformAllowed: true,
    defaultOptionId: null,
    deterministicTriggers: ["persistent_data", "destructive"],
    evidenceRefs: ["evidence_recorded_probe_1", "evidence_recorded_probe_2"],
    status: "unresolved" as const,
  };
  store.saveDecisionPoints({
    runId,
    comparisonId: candidate.comparisonId,
    decisions: [decision],
    createdAt: CREATED_AT,
  });
  const snapshotting = store.transitionRun(runId, "snapshotting", 0, CREATED_AT);
  const probing = store.transitionRun(runId, "probing", snapshotting.version, CREATED_AT);
  const comparing = store.setBlockingDecisionsAndTransition(
    runId,
    [decision.decisionId],
    probing.version,
    "comparing",
    CREATED_AT,
  );
  store.transitionRun(runId, "needs_review", comparing.version, CREATED_AT);

  const controller = new LocalController({ store, now: () => CREATED_AT });
  controller.start();
  return {
    controller,
    runId,
    async close(): Promise<void> {
      await controller.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}
