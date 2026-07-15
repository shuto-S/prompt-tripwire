import { randomUUID } from "node:crypto";

import {
  CodexAppServerClient,
  ProcessJsonRpcTransport,
  type JsonRpcTransport,
} from "@prompt-tripwire/codex-app-server";
import {
  sha256,
  type AuditAction,
  type AuditCheck,
  type AuditDeviation,
  type ExecutionContract,
  type ExecutionRecord,
  type RepositorySnapshot,
  type RunRecord,
} from "@prompt-tripwire/domain";
import {
  cleanupDisposableWorktree,
  createDisposableWorktree,
  inspectRepository,
  type DisposableWorktree,
  type PreparedRepositorySnapshot,
} from "@prompt-tripwire/git-snapshot";
import type { SqlitePersistence } from "@prompt-tripwire/persistence";

import { ExecutionChangeMonitor } from "./change-monitor.js";
import { ContractExecutionGate } from "./execution-gate.js";

export interface RuntimeExecutionContext {
  readonly run: RunRecord;
  readonly contract: ExecutionContract;
  readonly snapshot: RepositorySnapshot;
  readonly preparedSnapshot?: PreparedRepositorySnapshot;
  readonly store: SqlitePersistence;
  readonly signal: AbortSignal;
}

export interface RuntimeExecutionEvidence {
  readonly threadIds: readonly string[];
  readonly modelIds: readonly string[];
  readonly observedActions: readonly AuditAction[];
  readonly changedPaths: readonly string[];
  readonly diffWithinContract: boolean | null;
  readonly diffEvidenceRefs: readonly string[];
  readonly checks: readonly AuditCheck[];
  readonly deviations: readonly AuditDeviation[];
  readonly remainingUnknowns: readonly string[];
}

export interface RuntimeExecutionResult {
  readonly outcome: "completed" | "paused" | "failed";
  readonly errorCode: string | null;
  readonly evidence: RuntimeExecutionEvidence;
}

export interface ContractExecutionPortOptions {
  readonly createTransport?: (cwd: string) => JsonRpcTransport;
  readonly now?: () => string;
  readonly temporaryParent?: string;
}

interface ActiveExecution {
  readonly client: CodexAppServerClient;
  threadId: string | null;
  turnId: string | null;
}

const P0_FORBIDDEN_COMMAND_CLASSES = new Set([
  "dependency",
  "deploy",
  "destructive",
  "migration",
  "network",
  "permission",
  "release",
  "remote_write",
  "secret_access",
]);

function unsupportedP0Contract(contract: ExecutionContract): boolean {
  return (
    contract.networkPolicy.mode !== "deny" ||
    contract.networkPolicy.hosts.length > 0 ||
    contract.networkPolicy.actions.length > 0 ||
    contract.dependencyPolicy.mode !== "deny" ||
    contract.dependencyPolicy.allowed.length > 0 ||
    contract.dataPolicy.mode !== "deny" ||
    contract.dataPolicy.allowed.length > 0 ||
    contract.externalEffectPolicy.mode !== "deny" ||
    contract.externalEffectPolicy.allowed.length > 0 ||
    contract.allowedCommandClasses.some((value) => P0_FORBIDDEN_COMMAND_CLASSES.has(value))
  );
}

function errorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "EXECUTION_FAILED";
}

function executionInstructions(contract: ExecutionContract): string {
  const machinePolicy = {
    contractId: contract.contractId,
    contentHash: contract.contentHash,
    snapshotHash: contract.snapshotHash,
    taskHash: contract.taskHash,
    allowedPaths: contract.allowedPaths,
    protectedPaths: contract.protectedPaths,
    allowedCommandClasses: contract.allowedCommandClasses,
    deniedCommandClasses: contract.deniedCommandClasses,
    networkPolicy: contract.networkPolicy,
    dependencyPolicy: contract.dependencyPolicy,
    dataPolicy: contract.dataPolicy,
    externalEffectPolicy: contract.externalEffectPolicy,
    requiredChecks: contract.requiredChecks,
    stopConditions: contract.stopConditions,
  };
  return [
    "You are the single PromptTripwire contract-bound execution agent.",
    "Implement only the approved goal and behaviors inside the machine-readable contract below.",
    "Use apply_patch, not shell commands, for every file modification, and modify only approved paths.",
    "For repository inspection, issue only one structured read at a time using ls, find, rg, cat, head, tail, or wc. Never use pwd or sed because Codex 0.144.4 reports them as unknown actions.",
    "Never use shell redirection, command chaining, interpreters, package-manager commands, or ad hoc verification during the implementation turn.",
    "Do not use network access, MCP/apps, browser/computer tools, subagents, dependency changes, permission expansion, external services, Git writes, deploy, release, or migration actions.",
    "Do not run verification commands; PromptTripwire runs the exact required checks after your turn.",
    "If the contract is insufficient, stop without guessing or requesting broader authority.",
    "Do not modify .git or secret-like files. Do not expose chain-of-thought.",
    "",
    "Machine-readable execution contract:",
    JSON.stringify(machinePolicy),
  ].join("\n");
}

function executionPrompt(contract: ExecutionContract): string {
  return [
    "Implement the approved contract in this disposable execution worktree.",
    "",
    `Approved goal: ${contract.approvedGoal}`,
    ...contract.approvedBehaviors.map((behavior) => `- ${behavior}`),
    "",
    "Finish with a concise summary of workspace-local changes only.",
  ].join("\n");
}

function emptyEvidence(contract: ExecutionContract, unknown: string): RuntimeExecutionEvidence {
  return {
    threadIds: [],
    modelIds: [contract.modelVersions.codex, contract.modelVersions.comparator],
    observedActions: [],
    changedPaths: [],
    diffWithinContract: null,
    diffEvidenceRefs: [],
    checks: contract.requiredChecks.map((command, index) => ({
      checkId: `check_${sha256(`${command}:${String(index)}`).slice(0, 24)}`,
      command,
      outcome: "not_run" as const,
      exitCode: null,
      reason: unknown,
      evidenceRefs: [],
    })),
    deviations: [],
    remainingUnknowns: [unknown],
  };
}

export class ContractExecutionPort {
  private readonly options: ContractExecutionPortOptions;
  private readonly now: () => string;
  private readonly active = new Map<string, ActiveExecution>();

  constructor(options: ContractExecutionPortOptions = {}) {
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async start(context: RuntimeExecutionContext): Promise<RuntimeExecutionResult> {
    if (unsupportedP0Contract(context.contract)) {
      return {
        outcome: "failed",
        errorCode: "UNSUPPORTED_P0_CONTRACT",
        evidence: emptyEvidence(
          context.contract,
          "Execution did not start because the contract requested a capability unavailable in the P0 executor.",
        ),
      };
    }
    const prepared = context.preparedSnapshot;
    if (
      prepared === undefined ||
      prepared.snapshot.snapshotHash !== context.snapshot.snapshotHash ||
      prepared.snapshot.snapshotHash !== context.contract.snapshotHash
    ) {
      return {
        outcome: "failed",
        errorCode: "PREPARED_SNAPSHOT_REQUIRED",
        evidence: emptyEvidence(
          context.contract,
          "Execution did not start because the approved prepared snapshot was unavailable.",
        ),
      };
    }

    let worktree: DisposableWorktree | null = null;
    let client: CodexAppServerClient | null = null;
    let execution: ExecutionRecord | null = null;
    let gate: ContractExecutionGate | null = null;
    let changedPaths: readonly string[] = [];
    let diffWithinContract: boolean | null = null;
    let threadId: string | null = null;
    let modelId = context.contract.modelVersions.codex;
    let outcome: RuntimeExecutionResult["outcome"] = "failed";
    let code: string | null = "EXECUTION_FAILED";
    const unknowns: string[] = [];

    try {
      worktree = await createDisposableWorktree(prepared, {
        kind: "execution",
        ...(this.options.temporaryParent === undefined
          ? {}
          : { temporaryParent: this.options.temporaryParent }),
      });
      context.store.recordWorktree({
        worktreeId: worktree.worktreeId,
        runId: context.run.runId,
        kind: "execution",
        path: worktree.path,
        branch: worktree.branch,
        snapshotHash: worktree.snapshotHash,
        createdAt: worktree.createdAt,
      });
      execution = {
        executionId: `execution_${randomUUID()}`,
        runId: context.run.runId,
        threadId: null,
        contractId: context.contract.contractId,
        state: "starting",
        worktreeId: worktree.worktreeId,
        lastErrorCode: null,
      };
      context.store.recordExecution(execution, this.now());

      const baseline = await inspectRepository(worktree.path);
      const monitor = new ExecutionChangeMonitor({
        root: worktree.path,
        baselineChanges: baseline.changes,
        allowedPaths: context.contract.allowedPaths,
        protectedPaths: context.contract.protectedPaths,
      });
      gate = new ContractExecutionGate(context.contract, monitor);
      const transport =
        this.options.createTransport?.(worktree.cwd) ??
        ProcessJsonRpcTransport.start({ cwd: worktree.cwd });
      client = new CodexAppServerClient(transport);
      const active: ActiveExecution = { client, threadId: null, turnId: null };
      this.active.set(context.run.runId, active);
      await client.initialize();
      const result = await client.runContractExecution({
        cwd: worktree.cwd,
        model: context.contract.modelVersions.codex,
        reasoningEffort: context.snapshot.model.reasoningEffort,
        developerInstructions: executionInstructions(context.contract),
        prompt: executionPrompt(context.contract),
        policy: gate,
        signal: context.signal,
        onSessionStarted: (startedThreadId, startedTurnId) => {
          active.threadId = startedThreadId;
          active.turnId = startedTurnId;
          threadId = startedThreadId;
          if (execution !== null) {
            execution = {
              ...execution,
              threadId: startedThreadId,
              state: "running",
            };
            context.store.updateExecution(execution, this.now());
          }
        },
      });
      threadId = result.threadId;
      modelId = result.model;

      if (result.status === "completed" && !gate.hasDeviation) {
        for (const command of context.contract.requiredChecks) {
          if (context.signal.aborted) {
            gate.recordCheck(command, null, "execution was cancelled before the check ran");
            break;
          }
          const allowed = gate.validateRequiredCheck(command);
          if (!allowed.allowed) {
            gate.recordCheck(command, null, `required check denied: ${allowed.reason}`);
            break;
          }
          try {
            const check = await client.execSandboxedCommand({
              command: allowed.argv,
              cwd: worktree.cwd,
            });
            gate.recordCheck(
              command,
              check.exitCode,
              check.exitCode === 0 ? null : `process exited ${String(check.exitCode)}`,
            );
          } catch {
            gate.recordCheck(command, null, "required check outcome was unavailable");
          }
          if (gate.checks.at(-1)?.outcome !== "passed") break;
          changedPaths = await monitor.changedPaths();
          if (!gate.validateChangedPaths(changedPaths)) break;
        }
      }

      changedPaths = await monitor.changedPaths();
      const diffAllowed = gate.validateChangedPaths(changedPaths);
      diffWithinContract = diffAllowed;
      gate.finalizePolicyObservations();
      if (gate.hasDeviation || result.status === "interrupted") {
        outcome = "paused";
        code = gate.primaryErrorCode ?? "EXECUTION_INTERRUPTED";
      } else if (result.status === "failed") {
        outcome = "failed";
        code = "CODEX_TURN_FAILED";
      } else if (
        !diffAllowed ||
        gate.checks.some((check) => check.outcome !== "passed") ||
        gate.checks.length !== context.contract.requiredChecks.length
      ) {
        outcome = "paused";
        code = gate.primaryErrorCode ?? "REQUIRED_CHECK_INCOMPLETE";
      } else {
        outcome = "completed";
        code = null;
      }
    } catch (error) {
      code = errorCode(error);
      outcome =
        code === "EXECUTION_CANCELLED" || code === "EXECUTION_TIMEOUT" ? "paused" : "failed";
      unknowns.push("Execution ended before all App Server outcomes could be observed.");
    } finally {
      this.active.delete(context.run.runId);
      if (client !== null) {
        try {
          await client.close();
        } catch {
          outcome = "failed";
          code = "APP_SERVER_CLOSE_FAILED";
          unknowns.push("App Server shutdown could not be confirmed.");
        }
      }
      if (worktree !== null) {
        const cleanup = await cleanupDisposableWorktree(worktree);
        context.store.recordWorktreeCleanup({
          worktreeId: worktree.worktreeId,
          status: cleanup.success ? "removed" : "failed",
          cleanedAt: this.now(),
          errorCode: cleanup.success ? null : "WORKTREE_CLEANUP_FAILED",
        });
        if (!cleanup.success) {
          outcome = "failed";
          code = "WORKTREE_CLEANUP_FAILED";
          unknowns.push("Disposable execution worktree cleanup failed.");
        }
      }
    }

    if (execution !== null) {
      if (outcome === "paused") {
        execution = { ...execution, state: "pausing", lastErrorCode: code };
        context.store.updateExecution(execution, this.now());
      }
      execution = {
        ...execution,
        state: outcome === "completed" ? "completed" : outcome === "paused" ? "paused" : "failed",
        lastErrorCode: code,
      };
      context.store.updateExecution(execution, this.now());
      for (const deviation of gate?.deviations ?? []) {
        context.store.recordDeviation({
          deviationId: deviation.deviationId,
          runId: context.run.runId,
          executionId: execution.executionId,
          state: outcome === "paused" ? "paused" : "rejected",
          category: deviation.category,
          contractClause: deviation.category,
          evidenceRefs: deviation.evidenceRefs,
          observedAt: this.now(),
        });
      }
    }

    const diffEvidenceRefs =
      changedPaths.length === 0
        ? []
        : [`evidence_diff_${sha256(changedPaths.join("\0")).slice(0, 24)}`];
    return {
      outcome,
      errorCode: code,
      evidence:
        gate === null
          ? emptyEvidence(context.contract, unknowns[0] ?? "Execution evidence was unavailable.")
          : {
              threadIds: threadId === null ? [] : [threadId],
              modelIds: [...new Set([modelId, context.contract.modelVersions.comparator])],
              observedActions: [...gate.actions],
              changedPaths: [...changedPaths],
              diffWithinContract,
              diffEvidenceRefs,
              checks: [...gate.checks],
              deviations: [...gate.deviations],
              remainingUnknowns: [...gate.remainingUnknowns, ...unknowns],
            },
    };
  }

  async interrupt(runId: string): Promise<void> {
    const active = this.active.get(runId);
    if (active === undefined) return;
    if (active.threadId !== null && active.turnId !== null) {
      await active.client.interrupt(active.threadId, active.turnId);
      return;
    }
    await active.client.close();
  }
}
