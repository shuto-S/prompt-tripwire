import {
  CommandApprovalParamsSchema,
  DynamicToolCallParamsSchema,
  FileApprovalParamsSchema,
  McpElicitationParamsSchema,
  PermissionApprovalParamsSchema,
  ToolRequestUserInputParamsSchema,
  type ExecutionGateDecision,
  type ExecutionObservationDecision,
  type ExecutionPolicyHooks,
  type JsonRpcId,
  type ParsedThreadItem,
  type ProtocolCommandAction,
} from "@prompt-tripwire/codex-app-server";
import {
  sha256,
  type AuditAction,
  type AuditCheck,
  type AuditDeviation,
  type ExecutionContract,
} from "@prompt-tripwire/domain";
import {
  classifyCommandAction,
  matchCommandRequest,
  type CommandClass,
} from "@prompt-tripwire/policy";

import { ExecutionChangeMonitor } from "./change-monitor.js";
import { parseContractCommand } from "./command-parser.js";

interface EvaluatedCommand {
  readonly allowed: boolean;
  readonly reason: string;
  readonly classes: readonly CommandClass[];
}

function itemString(item: ParsedThreadItem, key: string): string | null {
  const value = item[key];
  return typeof value === "string" ? value : null;
}

function itemArray(item: ParsedThreadItem, key: string): readonly unknown[] {
  const value = item[key];
  return Array.isArray(value) ? value : [];
}

function diffPaths(diff: string): readonly string[] | null {
  if (diff.trim().length === 0) return [];
  const paths = new Set<string>();
  for (const line of diff.split(/\r?\n/u)) {
    const git = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
    if (git !== null) {
      if (git[1] !== undefined) paths.add(git[1]);
      if (git[2] !== undefined) paths.add(git[2]);
      continue;
    }
    const marker = /^(?:--- a|\+\+\+ b)\/(.+)$/u.exec(line);
    if (marker?.[1] !== undefined && marker[1] !== "/dev/null") paths.add(marker[1]);
  }
  return paths.size === 0 ? null : [...paths];
}

export class ContractExecutionGate implements ExecutionPolicyHooks {
  readonly actions: AuditAction[] = [];
  readonly checks: AuditCheck[] = [];
  readonly deviations: AuditDeviation[] = [];
  readonly remainingUnknowns: string[] = [];
  private readonly contract: ExecutionContract;
  private readonly monitor: ExecutionChangeMonitor;
  private readonly recorded = new Set<string>();
  private readonly validatedFileItems = new Set<string>();
  private sequence = 0;

  constructor(contract: ExecutionContract, monitor: ExecutionChangeMonitor) {
    this.contract = contract;
    this.monitor = monitor;
  }

  get hasDeviation(): boolean {
    return this.deviations.length > 0;
  }

  get primaryErrorCode(): string | null {
    const category = this.deviations[0]?.category;
    return category === undefined ? null : `DEVIATION_${category.toUpperCase()}`;
  }

  decideApproval(requestId: JsonRpcId, method: string, params: unknown): ExecutionGateDecision {
    if (method === "item/commandExecution/requestApproval") {
      const parsed = CommandApprovalParamsSchema.parse(params);
      if (parsed.networkApprovalContext !== null && parsed.networkApprovalContext !== undefined) {
        return this.declineApproval(
          method,
          parsed.itemId,
          "network",
          "network action could not be proven inside the approved policy",
          { decision: "decline" },
          requestId,
        );
      }
      if (
        (parsed.proposedExecpolicyAmendment?.length ?? 0) > 0 ||
        (parsed.proposedNetworkPolicyAmendments?.length ?? 0) > 0
      ) {
        return this.declineApproval(
          method,
          parsed.itemId,
          "permission",
          "runtime policy amendment was denied",
          { decision: "decline" },
          requestId,
        );
      }
      const evaluated = this.evaluateCommand(parsed.cwd, parsed.commandActions);
      if (!evaluated.allowed) {
        const category = evaluated.classes.includes("dependency")
          ? "dependency"
          : evaluated.classes.includes("remote_write")
            ? "external_effect"
            : "command";
        return this.declineApproval(
          method,
          parsed.itemId,
          category,
          `command approval denied: ${evaluated.reason}`,
          { decision: "decline" },
          requestId,
        );
      }
      return { response: { decision: "accept" }, pause: false };
    }
    if (method === "item/fileChange/requestApproval") {
      const parsed = FileApprovalParamsSchema.parse(params);
      if (this.validatedFileItems.has(parsed.itemId)) {
        return { response: { decision: "accept" }, pause: false };
      }
      return this.declineApproval(
        method,
        parsed.itemId,
        "file_path",
        "file approval could not be correlated with validated item paths",
        { decision: "decline" },
        requestId,
      );
    }
    if (method === "item/permissions/requestApproval") {
      const parsed = PermissionApprovalParamsSchema.parse(params);
      return this.declineApproval(
        method,
        parsed.itemId,
        "permission",
        "permission expansion was denied",
        { permissions: {}, scope: "turn", strictAutoReview: true },
        requestId,
      );
    }
    if (method === "item/tool/call") {
      const parsed = DynamicToolCallParamsSchema.parse(params);
      return this.declineApproval(
        method,
        parsed.callId,
        "external_effect",
        "dynamic tool call was not in the approved runtime surface",
        { success: false, contentItems: [] },
        requestId,
      );
    }
    if (method === "mcpServer/elicitation/request") {
      McpElicitationParamsSchema.parse(params);
      return this.declineApproval(
        method,
        null,
        "external_effect",
        "MCP elicitation was denied",
        { action: "decline", content: null },
        requestId,
      );
    }
    if (method === "item/tool/requestUserInput") {
      const parsed = ToolRequestUserInputParamsSchema.parse(params);
      return this.declineApproval(
        method,
        parsed.itemId,
        "unknown_action",
        "execution requested a new human decision outside the contract",
        { answers: {} },
        requestId,
      );
    }
    return this.declineApproval(
      method,
      null,
      "unknown_action",
      "unexpected App Server request was denied",
      { decision: "decline" },
      requestId,
    );
  }

  observeItem(
    item: ParsedThreadItem,
    method: "item/started" | "item/completed",
  ): ExecutionObservationDecision {
    if (item.type === "commandExecution") {
      const status = itemString(item, "status");
      if (status === "declined" || status === "failed") return { pause: false };
      const cwd = itemString(item, "cwd");
      const actions = itemArray(item, "commandActions") as readonly ProtocolCommandAction[];
      const evaluated = this.evaluateCommand(cwd, actions);
      if (!evaluated.allowed) {
        return this.observedDeviation(
          `item:${item.id}:command`,
          "command",
          `unapproved command observed: ${evaluated.reason}`,
          "failed",
        );
      }
      if (method === "item/completed") {
        this.recordAction("command", "structured command completed", "completed", [
          this.evidence("item", item.id),
        ]);
      }
      return { pause: false };
    }
    if (item.type === "fileChange") {
      const status = itemString(item, "status");
      if (status === "declined" || status === "failed") return { pause: false };
      const changes = itemArray(item, "changes");
      if (changes.length === 0) {
        return this.observedDeviation(
          `item:${item.id}:empty-file-change`,
          "unknown_action",
          "file change item disclosed no path",
          "failed",
        );
      }
      for (const change of changes) {
        if (change === null || typeof change !== "object" || !("path" in change)) {
          return this.observedDeviation(
            `item:${item.id}:invalid-file-change`,
            "unknown_action",
            "file change item had no valid path",
            "failed",
          );
        }
        const paths = [typeof change.path === "string" ? change.path : ""];
        if (
          "kind" in change &&
          change.kind !== null &&
          typeof change.kind === "object" &&
          "move_path" in change.kind &&
          typeof change.kind.move_path === "string"
        ) {
          paths.push(change.kind.move_path);
        }
        for (const path of paths) {
          const match = this.monitor.matchWritePath(path);
          if (match.outcome === "deny") {
            return this.observedDeviation(
              `item:${item.id}:${path}`,
              "file_path",
              `contained file change exceeded contract scope: ${match.reason}`,
              "detected_after_contained_write",
              path,
            );
          }
        }
      }
      if (method === "item/started") this.validatedFileItems.add(item.id);
      if (method === "item/completed") {
        this.recordAction("file_change", "contract-scoped file change completed", "completed", [
          this.evidence("item", item.id),
        ]);
      }
      return { pause: false };
    }
    if (item.type === "imageView") {
      const path = itemString(item, "path");
      const match = path === null ? null : this.monitor.matchReadPath(path);
      return match?.outcome === "allow"
        ? { pause: false }
        : this.observedDeviation(
            `item:${item.id}:image-view`,
            "file_path",
            "image read exceeded the approved repository boundary",
            "failed",
          );
    }
    if (
      new Set([
        "agentMessage",
        "contextCompaction",
        "plan",
        "reasoning",
        "sleep",
        "userMessage",
      ]).has(item.type)
    ) {
      return { pause: false };
    }
    const category = item.type === "webSearch" ? "network" : "external_effect";
    return this.observedDeviation(
      `item:${item.id}:${item.type}`,
      category,
      `unapproved tool item observed: ${item.type}`,
      "failed",
    );
  }

  observeDiff(diff: string): ExecutionObservationDecision {
    const paths = diffPaths(diff);
    if (paths === null) {
      return this.observedDeviation(
        `diff:${sha256(diff)}`,
        "unknown_action",
        "aggregate diff could not be mapped to repository paths",
        "failed",
      );
    }
    for (const path of paths) {
      const match = this.monitor.matchWritePath(path);
      if (match.outcome === "deny") {
        return this.observedDeviation(
          `diff:${path}`,
          "file_path",
          `aggregate diff exceeded contract scope: ${match.reason}`,
          "detected_after_contained_write",
          path,
        );
      }
    }
    return { pause: false };
  }

  validateChangedPaths(paths: readonly string[]): boolean {
    let allowed = true;
    for (const path of paths) {
      const match = this.monitor.matchWritePath(path);
      if (match.outcome === "deny") {
        allowed = false;
        this.observedDeviation(
          `final-diff:${path}`,
          "file_path",
          `final diff exceeded contract scope: ${match.reason}`,
          "detected_after_contained_write",
          path,
        );
      }
    }
    return allowed;
  }

  validateRequiredCheck(
    command: string,
  ):
    | { readonly allowed: true; readonly argv: readonly string[] }
    | { readonly allowed: false; readonly reason: string } {
    const parsed = parseContractCommand(command);
    if (!parsed.ok) return { allowed: false, reason: parsed.reason };
    const match = matchCommandRequest(
      { source: "structured", actions: [parsed.action] },
      this.contract,
    );
    if (match.outcome === "deny") return { allowed: false, reason: match.reason };
    if (
      !match.commandClasses.every((value) =>
        new Set(["test", "lint", "typecheck", "build", "verification"]).has(value),
      )
    ) {
      return { allowed: false, reason: "required_check_class_not_verification" };
    }
    return { allowed: true, argv: parsed.argv };
  }

  recordCheck(command: string, exitCode: number | null, reason: string | null): void {
    const outcome = exitCode === 0 ? "passed" : exitCode === null ? "not_run" : "failed";
    const evidence = this.evidence("check", `${command}:${String(exitCode)}:${reason ?? ""}`);
    this.checks.push({
      checkId: this.identifier("check", command),
      command,
      outcome,
      exitCode,
      reason,
      evidenceRefs: [evidence],
    });
    this.recordAction(
      "check",
      `required check ${outcome}`,
      outcome === "passed" ? "completed" : outcome === "not_run" ? "not_observed" : "failed",
      [evidence],
    );
    if (outcome !== "passed") {
      this.recordDeviation(
        `check:${command}`,
        "check",
        reason ?? `required check exited ${String(exitCode)}`,
        [evidence],
      );
    }
  }

  finalizePolicyObservations(): void {
    const observedKinds = new Set(this.actions.map((action) => action.kind));
    for (const [kind, summary] of [
      ["network", "network action not observed"],
      ["permission", "permission expansion not observed"],
      ["external_effect", "external effect not observed"],
    ] as const) {
      if (!observedKinds.has(kind)) this.recordAction(kind, summary, "not_observed", []);
    }
  }

  private evaluateCommand(
    cwd: string | null | undefined,
    actions: readonly ProtocolCommandAction[] | null | undefined,
  ): EvaluatedCommand {
    if (cwd === null || cwd === undefined || this.monitor.matchReadPath(cwd).outcome === "deny") {
      return { allowed: false, reason: "command_cwd_outside_repository", classes: [] };
    }
    if (actions === null || actions === undefined || actions.length === 0) {
      return { allowed: false, reason: "missing_structured_actions", classes: [] };
    }
    const parsedActions = [];
    for (const action of actions) {
      const parsed = parseContractCommand(action.command);
      const classification = parsed.ok ? classifyCommandAction(parsed.action) : null;
      const classes = classification?.known ? [classification.commandClass] : [];
      if (action.type === "unknown" || !parsed.ok) {
        return { allowed: false, reason: "unknown_command", classes };
      }
      const path = action.path ?? cwd;
      if (this.monitor.matchReadPath(path).outcome === "deny") {
        return { allowed: false, reason: "command_path_denied", classes };
      }
      parsedActions.push(parsed.action);
    }
    const match = matchCommandRequest(
      { source: "structured", actions: parsedActions },
      this.contract,
    );
    return {
      allowed: match.outcome === "allow",
      reason: match.reason,
      classes: match.commandClasses,
    };
  }

  private declineApproval(
    method: string,
    itemId: string | null,
    category: string,
    summary: string,
    response: unknown,
    requestId: JsonRpcId,
  ): ExecutionGateDecision {
    const evidence = this.evidence("approval", requestId);
    const kind =
      category === "network"
        ? "network"
        : category === "permission"
          ? "permission"
          : category === "external_effect"
            ? "external_effect"
            : category === "file_path"
              ? "file_change"
              : "command";
    this.recordAction(kind, summary, "declined_before_execution", [evidence]);
    this.recordDeviation(`approval:${method}:${itemId ?? "none"}`, category, summary, [evidence]);
    return { response, pause: true };
  }

  private observedDeviation(
    key: string,
    category: string,
    summary: string,
    outcome: AuditAction["outcome"],
    path?: string,
  ): ExecutionObservationDecision {
    if (this.recorded.has(key)) return { pause: true };
    this.recorded.add(key);
    const evidence = this.evidence("observation", key);
    const kind =
      category === "file_path"
        ? "file_change"
        : category === "network"
          ? "network"
          : category === "permission"
            ? "permission"
            : category === "command" || category === "dependency"
              ? "command"
              : "external_effect";
    this.recordAction(kind, summary, outcome, [evidence]);
    this.recordDeviation(key, category, summary, [evidence]);
    if (path !== undefined)
      this.remainingUnknowns.push(`Partial worktree discarded after ${path}.`);
    return { pause: true };
  }

  private recordAction(
    kind: AuditAction["kind"],
    summary: string,
    outcome: AuditAction["outcome"],
    evidenceRefs: readonly string[],
  ): void {
    this.actions.push({
      actionId: this.identifier("action", `${kind}:${summary}:${String(this.sequence)}`),
      kind,
      summary,
      outcome,
      evidenceRefs: [...evidenceRefs],
    });
  }

  private recordDeviation(
    key: string,
    category: string,
    summary: string,
    evidenceRefs: readonly string[],
  ): void {
    const recordKey = `deviation:${key}`;
    if (this.recorded.has(recordKey)) return;
    this.recorded.add(recordKey);
    this.deviations.push({
      deviationId: this.identifier("deviation", key),
      category,
      summary,
      resolution: "clean contract restart required",
      evidenceRefs: [...evidenceRefs],
    });
  }

  private evidence(kind: string, value: JsonRpcId | string): string {
    return this.identifier("evidence", `${kind}:${String(value)}`);
  }

  private identifier(kind: string, value: string): string {
    this.sequence += 1;
    return `${kind}_${sha256(`${value}:${String(this.sequence)}`).slice(0, 24)}`;
  }
}
