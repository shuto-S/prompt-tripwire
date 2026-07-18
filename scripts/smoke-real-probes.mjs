#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AppServerError,
  CodexAppServerClient,
  ProbeCoordinator,
  ProcessJsonRpcTransport,
  REQUIRED_CODEX_VERSION,
} from "../packages/codex-app-server/dist/index.js";
import { prepareRepositorySnapshot } from "../packages/git-snapshot/dist/index.js";

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
  assert.equal(result.status, 0, `git ${args[0]} failed`);
  return result.stdout.trim();
}

async function createFixture() {
  const repository = await mkdtemp(join(tmpdir(), "prompt-tripwire-real-probe-"));
  git(repository, ["init", "-b", "main"]);
  git(repository, ["config", "user.email", "fixture@example.invalid"]);
  git(repository, ["config", "user.name", "PromptTripwire Fixture"]);
  await writeFile(
    join(repository, "README.md"),
    "# Greeter CLI\n\nRun `node cli.mjs NAME` to print a greeting.\n",
  );
  await writeFile(
    join(repository, "cli.mjs"),
    "const name = process.argv[2] ?? 'world';\nconsole.log(`Hello, ${name}!`);\n",
  );
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "fixture"]);
  return repository;
}

async function main() {
  const diagnosticOne = process.argv.includes("--diagnostic-one");
  const repository = await createFixture();
  let client = null;
  try {
    const transport = ProcessJsonRpcTransport.start({ cwd: repository });
    client = new CodexAppServerClient(transport);
    await client.initialize();
    const models = await client.listModels();
    const selected = models.find((model) => model.isDefault) ?? models[0];
    assert(selected, "App Server advertised no model");
    const reasoningEffort = selected.supportedReasoningEfforts.includes(
      selected.defaultReasoningEffort,
    )
      ? selected.defaultReasoningEffort
      : selected.supportedReasoningEfforts[0];
    assert(reasoningEffort, "selected model advertised no reasoning effort");

    const prepared = await prepareRepositorySnapshot({
      repositoryPath: repository,
      task: "Add a --dry-run option that validates the NAME argument and explains what greeting would be printed without printing the greeting itself.",
      model: { id: selected.model, reasoningEffort },
      codexVersion: REQUIRED_CODEX_VERSION,
      promptTripwireVersion: "0.1.2",
      effectiveConfig: { probeCount: 3, network: "deny" },
    });
    const result = await new ProbeCoordinator(client).run({
      prepared,
      timeoutMs: 180_000,
      probeCount: diagnosticOne ? 1 : 3,
      maxAttempts: diagnosticOne ? 1 : 2,
    });
    const completed = result.attempts.filter((attempt) => attempt.state === "completed");
    const evidence = {
      codexVersion: REQUIRED_CODEX_VERSION,
      model: result.model,
      reasoningEffort: result.reasoningEffort,
      snapshotHash: result.snapshotHash,
      taskHash: result.taskHash,
      validPlanCount: result.plans.length,
      distinctThreadCount: new Set(completed.map((attempt) => attempt.threadId)).size,
      attempts: result.attempts.map((attempt) => ({
        probeId: attempt.probeId,
        attempt: attempt.attempt,
        state: attempt.state,
        threadId: attempt.threadId,
        errorCode: attempt.errorCode,
        errorReason: attempt.errorReason,
        approvals: attempt.approvals.map((approval) => ({
          decision: approval.decision,
          reasonCode: approval.reasonCode,
        })),
      })),
      allWorktreesCleaned: result.worktrees.every((entry) => entry.cleanup.success),
      originalCheckoutClean: git(repository, ["status", "--porcelain=v1"]) === "",
      degraded: result.degraded,
      blocked: result.blocked,
    };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (!diagnosticOne) {
      assert.equal(result.blocked, false, "real probe batch was blocked");
      assert.equal(result.plans.length, 3, "real probe batch did not produce three valid plans");
      assert.equal(evidence.distinctThreadCount, 3, "real probes did not use distinct threads");
    }
    assert.equal(evidence.allWorktreesCleaned, true, "real probe worktree cleanup failed");
    assert.equal(evidence.originalCheckoutClean, true, "real probes changed the source checkout");
  } finally {
    if (client !== null) await client.close();
    await rm(repository, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const code = error instanceof AppServerError ? error.code : "REAL_PROBE_SMOKE_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
