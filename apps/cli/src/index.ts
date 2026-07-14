#!/usr/bin/env node

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  DefaultInspectionPort,
  LocalController,
  renderTerminalReview,
  renderTerminalStatus,
} from "@prompt-tripwire/controller";
import { ContractExecutionPort } from "@prompt-tripwire/contract-runtime";
import {
  canonicalHash,
  renderRunReportMarkdown,
  serializeRunReportJson,
} from "@prompt-tripwire/domain";
import { prepareRepositorySnapshot } from "@prompt-tripwire/git-snapshot";
import { SqlitePersistence } from "@prompt-tripwire/persistence";
import { startReviewServer } from "@prompt-tripwire/ui";

export const CLI_FOUNDATION = Object.freeze({ name: "cli", version: "0.1.0" });

const HELP = `PromptTripwire ${CLI_FOUNDATION.version}

Usage:
  tripwire inspect --task TEXT [--repo PATH] [--dirty committed|include]
  tripwire inspect --task-file PATH [--repo PATH] [--dirty committed|include]
  tripwire review RUN_ID [--terminal]
  tripwire review RUN_ID --decision DECISION_ID (--option OPTION_ID | --freeform TEXT | --defer)
  tripwire review RUN_ID (--approve [--contract CONTRACT_ID] | --cancel)
  tripwire approve RUN_ID [--contract CONTRACT_ID]
  tripwire run --contract CONTRACT_ID
  tripwire status RUN_ID
  tripwire report RUN_ID [--format json|markdown]
  tripwire cancel RUN_ID
  tripwire export RUN_ID --output PATH [--format json|markdown]
  tripwire archive RUN_ID
  tripwire unarchive RUN_ID
  tripwire delete RUN_ID
  tripwire purge-expired
`;

export interface CliIo {
  readonly stdout: { write(value: string): unknown };
  readonly stderr: { write(value: string): unknown };
}

export interface CliDependencies {
  readonly cwd?: string;
  readonly dataRoot?: string;
  readonly io?: CliIo;
  readonly createController?: (store: SqlitePersistence) => LocalController;
}

function defaultDataRoot(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "PromptTripwire");
  }
  const xdg = process.env.XDG_DATA_HOME;
  return xdg === undefined || xdg.length === 0
    ? join(homedir(), ".local", "share", "prompt-tripwire")
    : join(xdg, "prompt-tripwire");
}

function required(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) throw new TypeError(`${label} is required`);
  return value;
}

function utf8Task(path: string): string {
  const bytes = readFileSync(path);
  const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (value.trim().length === 0) throw new TypeError("task file must not be empty");
  return value;
}

function positional(values: readonly string[], index: number, label: string): string {
  return required(values[index], label);
}

function expectedVersion(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TypeError("--expected-version must be a non-negative integer");
  }
  return parsed;
}

function mutationKey(kind: string, value: unknown): string {
  return `cli:${kind}:${canonicalHash(value).slice(0, 32)}`;
}

async function waitForShutdownSignal(): Promise<void> {
  await new Promise<void>((resolveSignal) => {
    const finish = (): void => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolveSignal();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

export async function runCli(
  args: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? { stdout: process.stdout, stderr: process.stderr };
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      approve: { type: "boolean" },
      cancel: { type: "boolean" },
      contract: { type: "string" },
      decision: { type: "string" },
      defer: { type: "boolean" },
      dirty: { type: "string" },
      "expected-version": { type: "string" },
      freeform: { type: "string" },
      format: { type: "string" },
      help: { type: "boolean", short: "h" },
      option: { type: "string" },
      output: { type: "string" },
      rationale: { type: "string" },
      repo: { type: "string" },
      task: { type: "string" },
      "task-file": { type: "string" },
      terminal: { type: "boolean" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (parsed.values.version === true) {
    io.stdout.write(`prompt-tripwire ${CLI_FOUNDATION.version}\n`);
    return 0;
  }
  if (parsed.values.help === true || parsed.positionals.length === 0) {
    io.stdout.write(HELP);
    return 0;
  }

  const dataRoot = resolve(dependencies.dataRoot ?? defaultDataRoot());
  const store = new SqlitePersistence({
    databasePath: join(dataRoot, "prompt-tripwire.sqlite3"),
    artifactRoot: join(dataRoot, "artifacts"),
  });
  const controller =
    dependencies.createController?.(store) ??
    new LocalController({
      store,
      inspectionPort: new DefaultInspectionPort(),
      executionPort: new ContractExecutionPort(),
    });
  let started = false;
  try {
    controller.start();
    started = true;
    const [command, ...positionals] = parsed.positionals;
    switch (command) {
      case "inspect": {
        if (parsed.values.task !== undefined && parsed.values["task-file"] !== undefined) {
          throw new TypeError("use exactly one of --task or --task-file");
        }
        const task =
          parsed.values.task ??
          utf8Task(required(parsed.values["task-file"], "--task or --task-file"));
        const dirtyChoice =
          parsed.values.dirty === undefined
            ? undefined
            : parsed.values.dirty === "include"
              ? "include_patch"
              : parsed.values.dirty === "committed"
                ? "committed_only"
                : (() => {
                    throw new TypeError("--dirty must be committed or include");
                  })();
        const run = await controller.inspect({
          repositoryPath: resolve(parsed.values.repo ?? dependencies.cwd ?? process.cwd()),
          task,
          model: { id: "gpt-5.6-sol", reasoningEffort: "low" },
          codexVersion: "0.144.4",
          promptTripwireVersion: CLI_FOUNDATION.version,
          ...(dirtyChoice === undefined ? {} : { dirtyChoice }),
        });
        io.stdout.write(renderTerminalStatus(run, store.listEvents(run.runId)));
        return 0;
      }
      case "review": {
        const runId = positional(positionals, 0, "RUN_ID");
        let review = controller.review(runId);
        const version = expectedVersion(parsed.values["expected-version"], review.run.version);
        const mutationCount =
          Number(parsed.values.approve === true) +
          Number(parsed.values.cancel === true) +
          Number(parsed.values.decision !== undefined);
        if (mutationCount > 1) {
          throw new TypeError("review accepts only one decision, approval, or cancellation");
        }
        if (mutationCount === 0 && parsed.values.terminal !== true) {
          const reviewServer = await startReviewServer({ controller, runId });
          io.stdout.write(`Decision Inbox: ${reviewServer.url}\nPress Ctrl-C to close it.\n`);
          try {
            await waitForShutdownSignal();
          } finally {
            await reviewServer.close();
          }
          return 0;
        }
        if (parsed.values.cancel === true) {
          await controller.cancelVersioned({
            runId,
            expectedVersion: version,
            idempotencyKey: mutationKey("cancel", { runId, version }),
          });
        } else if (parsed.values.approve === true) {
          const contractId = required(
            parsed.values.contract ?? review.run.activeContractId ?? undefined,
            "--contract or active contract",
          );
          controller.approve({
            runId,
            contractId,
            expectedVersion: version,
            idempotencyKey: mutationKey("approve", { runId, contractId, version }),
          });
        } else if (parsed.values.decision !== undefined) {
          const actionCount =
            Number(parsed.values.option !== undefined) +
            Number(parsed.values.freeform !== undefined) +
            Number(parsed.values.defer === true);
          if (actionCount !== 1) {
            throw new TypeError(
              "a decision requires exactly one of --option, --freeform, or --defer",
            );
          }
          if (parsed.values.defer === true) {
            controller.defer({
              runId,
              decisionId: parsed.values.decision,
              expectedVersion: version,
              idempotencyKey: mutationKey("defer", {
                runId,
                decisionId: parsed.values.decision,
                version,
              }),
            });
          } else {
            const selectedOptionId = parsed.values.option ?? null;
            const freeformOverride = parsed.values.freeform ?? null;
            controller.decide({
              runId,
              decisionId: parsed.values.decision,
              selectedOptionId,
              freeformOverride,
              rationale: parsed.values.rationale ?? null,
              expectedVersion: version,
              idempotencyKey: mutationKey("decision", {
                runId,
                decisionId: parsed.values.decision,
                selectedOptionId,
                freeformOverride,
                rationale: parsed.values.rationale ?? null,
                version,
              }),
            });
          }
        } else if (parsed.values.defer === true) {
          throw new TypeError("--defer requires --decision");
        }
        review = controller.review(runId);
        io.stdout.write(renderTerminalReview(review.run, review.decisions, review.contract));
        return 0;
      }
      case "approve": {
        const runId = positional(positionals, 0, "RUN_ID");
        const review = controller.review(runId);
        const contractId = required(
          parsed.values.contract ?? review.run.activeContractId ?? undefined,
          "--contract or active contract",
        );
        const version = expectedVersion(parsed.values["expected-version"], review.run.version);
        const run = controller.approve({
          runId,
          contractId,
          expectedVersion: version,
          idempotencyKey: mutationKey("approve", { runId, contractId, version }),
        });
        io.stdout.write(renderTerminalStatus(run, store.listEvents(runId)));
        return 0;
      }
      case "status": {
        const runId = positional(positionals, 0, "RUN_ID");
        const status = controller.status(runId);
        io.stdout.write(renderTerminalStatus(status.run, store.listEvents(runId)));
        return 0;
      }
      case "run": {
        const contractId = required(parsed.values.contract, "--contract");
        const contract = store.getContract(contractId);
        const current = store.getRun(contract.runId).run;
        if (current.state !== "approved") {
          io.stdout.write(renderTerminalStatus(current, store.listEvents(current.runId)));
          return 0;
        }
        const approved = store.getSnapshot(contract.snapshotHash);
        const prepared = await prepareRepositorySnapshot({
          repositoryPath: approved.repositoryPath,
          task: approved.task,
          model: approved.model,
          codexVersion: approved.codexVersion,
          promptTripwireVersion: approved.promptTripwireVersion,
          dirtyChoice: approved.dirtyPatchHash === null ? "committed_only" : "include_patch",
        });
        const run = await controller.run({
          contractId,
          currentSnapshot: prepared.snapshot,
          preparedSnapshot: prepared,
          expectedVersion: current.version,
          idempotencyKey: `cli:start:${contractId}`,
        });
        io.stdout.write(renderTerminalStatus(run, store.listEvents(run.runId)));
        return 0;
      }
      case "report": {
        const runId = positional(positionals, 0, "RUN_ID");
        const report = controller.report({ runId });
        const format = parsed.values.format ?? "markdown";
        if (format !== "json" && format !== "markdown") {
          throw new TypeError("--format must be json or markdown");
        }
        io.stdout.write(
          format === "json" ? serializeRunReportJson(report) : renderRunReportMarkdown(report),
        );
        return 0;
      }
      case "cancel": {
        const runId = positional(positionals, 0, "RUN_ID");
        const run = await controller.cancel(runId);
        io.stdout.write(renderTerminalStatus(run, store.listEvents(runId)));
        return 0;
      }
      case "export": {
        const runId = positional(positionals, 0, "RUN_ID");
        const format = parsed.values.format ?? "json";
        if (format !== "json" && format !== "markdown") {
          throw new TypeError("--format must be json or markdown");
        }
        controller.exportReport(runId, format, required(parsed.values.output, "--output"));
        io.stdout.write(`Exported sanitized ${format} report.\n`);
        return 0;
      }
      case "archive":
      case "unarchive": {
        const runId = positional(positionals, 0, "RUN_ID");
        const persisted = controller.archive(runId, command === "archive");
        io.stdout.write(
          `${command === "archive" ? "Archived" : "Unarchived"} ${persisted.run.runId}.\n`,
        );
        return 0;
      }
      case "delete": {
        const runId = positional(positionals, 0, "RUN_ID");
        controller.deleteRun(runId);
        io.stdout.write(`Deleted ${runId}.\n`);
        return 0;
      }
      case "purge-expired": {
        const deleted = controller.purgeExpired();
        io.stdout.write(`Deleted ${String(deleted.length)} expired run(s).\n`);
        return 0;
      }
      default:
        throw new TypeError(`unknown command: ${String(command)}`);
    }
  } finally {
    if (started) await controller.stop();
    else store.close();
  }
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "CLI_ERROR";
    process.stderr.write(`${code}: request failed\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
