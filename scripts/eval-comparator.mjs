#!/usr/bin/env node

import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CodexAppServerClient,
  ProcessJsonRpcTransport,
} from "../packages/codex-app-server/dist/index.js";
import {
  AppServerComparatorTransport,
  PlanComparator,
} from "../packages/openai-comparator/dist/index.js";
import { createRepositorySnapshot } from "../packages/domain/dist/index.js";

const HASH = "0".repeat(64);
const MODELS = ["gpt-5.6-sol", "gpt-5.6-terra"];

function fixture(id, behaviors) {
  const snapshot = createRepositorySnapshot({
    repositoryPath: "/tmp/prompt-tripwire-eval-fixture",
    commitSha: "1".repeat(40),
    branch: "main",
    submodules: {},
    dirtyPatchHash: null,
    instructionHash: HASH,
    configHash: HASH,
    task: `Evaluate fixture ${id}: choose the material implementation behavior.`,
    model: { id: "gpt-5.6-sol", reasoningEffort: "low" },
    codexVersion: "0.144.4",
    promptTripwireVersion: "0.1.4",
    createdAt: "2026-07-14T00:00:00.000Z",
  });
  const plans = behaviors.map((behavior, index) => {
    const probeId = `probe_${String(index + 1)}`;
    return {
      probeId,
      threadId: `thread_${String(index + 1)}`,
      snapshotHash: snapshot.snapshotHash,
      taskHash: snapshot.taskHash,
      summary: behavior.summary,
      assumptions: [],
      intendedBehavior: behavior.intendedBehavior,
      filesToRead: ["src/records.ts"],
      filesToChange: ["src/records.ts"],
      components: ["records"],
      dataChanges: behavior.dataChanges,
      publicApiChanges: [],
      dependencyChanges: [],
      commands: ["npm run test:unit"],
      externalEffects: [],
      permissionChanges: [],
      compatibilityImpacts: [],
      reversibility: behavior.reversibility,
      verificationSteps: ["Run focused unit tests."],
      unknowns: [],
      repositoryEvidence: [
        {
          id: `evidence_${probeId}`,
          path: "src/records.ts",
          startLine: 10,
          endLine: 30,
          description: "Current rejected-record handling.",
        },
      ],
    };
  });
  return { id, snapshot, plans };
}

const SAFE = {
  summary: "Validate rejected records locally and retain them for review.",
  intendedBehavior: ["Retain rejected records for review."],
  dataChanges: [],
  reversibility: "reversible",
};

const FIXTURES = [
  {
    ...fixture("equivalent_safe", [SAFE, SAFE, SAFE]),
    expectDivergence: false,
  },
  {
    ...fixture("retention_divergence", [
      SAFE,
      {
        summary: "Validate rejected records locally and delete them immediately.",
        intendedBehavior: ["Delete rejected records immediately."],
        dataChanges: ["Delete rejected records after validation."],
        reversibility: "irreversible",
      },
      SAFE,
    ]),
    expectDivergence: true,
  },
];

async function main() {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "prompt-tripwire-eval-app-server-"));
  let client;
  try {
    await chmod(runtimeRoot, 0o700);
    const shellStartupDirectory = join(runtimeRoot, "zsh-startup");
    await mkdir(shellStartupDirectory, { mode: 0o700 });
    client = new CodexAppServerClient(
      ProcessJsonRpcTransport.start({ cwd: runtimeRoot, shellStartupDirectory }),
    );
    await client.initialize();
    const available = new Map((await client.listModels()).map((model) => [model.id, model]));
    for (const model of MODELS) {
      const descriptor = available.get(model);
      if (!descriptor || !descriptor.supportedReasoningEfforts.includes("low")) {
        throw Object.assign(new Error(`required comparator model unavailable: ${model}`), {
          code: "COMPARATOR_MODEL_UNAVAILABLE",
        });
      }
    }
    const comparator = new PlanComparator(
      new AppServerComparatorTransport(client, { temporaryParent: runtimeRoot }),
    );
    const results = [];
    for (const model of MODELS) {
      for (const item of FIXTURES) {
        const startedAt = performance.now();
        try {
          const result = await comparator.compare({
            snapshot: item.snapshot,
            plans: item.plans,
            model,
            reasoningEffort: "low",
            timeoutMs: 120_000,
            maxAttempts: 1,
          });
          const hasDivergence = result.candidate.divergences.length > 0;
          results.push({
            model,
            fixture: item.id,
            passed: hasDivergence === item.expectDivergence,
            divergenceCount: result.candidate.divergences.length,
            unknownCount: result.candidate.unknowns.length,
            durationMs: Math.round(performance.now() - startedAt),
            threadId: result.attempts[0]?.threadId ?? null,
            turnId: result.attempts[0]?.turnId ?? null,
            usage: result.usage,
          });
        } catch (error) {
          const attempt =
            error !== null && typeof error === "object" && "attempts" in error
              ? error.attempts?.[0]
              : undefined;
          results.push({
            model,
            fixture: item.id,
            passed: false,
            errorCode:
              error !== null && typeof error === "object" && "code" in error
                ? String(error.code)
                : "COMPARATOR_EVAL_FAILED",
            durationMs: Math.round(performance.now() - startedAt),
            threadId: attempt?.threadId ?? null,
            turnId: attempt?.turnId ?? null,
          });
        }
      }
    }
    const summary = MODELS.map((model) => {
      const modelResults = results.filter((result) => result.model === model);
      return {
        model,
        passed: modelResults.filter((result) => result.passed).length,
        total: modelResults.length,
        totalTokens: modelResults.reduce(
          (sum, result) => sum + ("usage" in result ? (result.usage.totalTokens ?? 0) : 0),
          0,
        ),
      };
    });
    process.stdout.write(
      `${JSON.stringify(
        { authMode: "codex-cli-login", reasoningEffort: "low", summary, results },
        null,
        2,
      )}\n`,
    );
    if (results.some((result) => !result.passed)) process.exitCode = 1;
  } finally {
    try {
      await client?.close();
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (error) {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? String(error.code)
      : "COMPARATOR_EVAL_FAILED";
  process.stderr.write(`${code}: comparator eval was not run.\n`);
  process.exitCode = 2;
}
