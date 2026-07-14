import { relative, resolve, sep } from "node:path";

import {
  CommandActionSchema,
  CommandApprovalParamsSchema,
  FileApprovalParamsSchema,
  PermissionApprovalParamsSchema,
  type ParsedThreadItem,
  type ProtocolCommandAction,
} from "./protocol.js";
import type { ApprovalObservation, JsonRpcId } from "./types.js";

export interface ProbeApprovalDecision {
  readonly response: unknown;
  readonly observation: ApprovalObservation;
}

function unknownCommandShape(command: string): string {
  if (/[|;&<>`]|\$\(/u.test(command)) return "compound_or_redirected";
  const first = command.trim().split(/\s+/u)[0] ?? "";
  const program = first.split("/").at(-1)?.toLowerCase() ?? "";
  if (new Set(["pwd", "ls", "find", "rg", "cat", "head", "tail", "wc", "sed"]).has(program)) {
    return `single_static_${program}`;
  }
  if (new Set(["node", "python", "python3", "ruby", "perl", "bash", "sh", "zsh"]).has(program)) {
    return "interpreter_or_shell";
  }
  if (new Set(["npm", "pnpm", "yarn", "uv", "pip", "cargo", "make"]).has(program)) {
    return "package_or_build_tool";
  }
  if (new Set(["curl", "wget", "ssh", "gh"]).has(program)) return "network_tool";
  return "other";
}

function contained(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const fromRoot = relative(normalizedRoot, normalizedCandidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

function safeAction(root: string, cwd: string, action: ProtocolCommandAction): boolean {
  if (!contained(root, cwd)) return false;
  if (action.type === "unknown") return false;
  if (action.path === null || action.path === undefined) return true;
  return contained(root, resolve(cwd, action.path));
}

function staticReadReason(
  root: string,
  cwd: string | null | undefined,
  actions: readonly ProtocolCommandAction[] | null | undefined,
): "static_read" | "missing_structured_actions" | "outside_probe_root" | "unsafe_action" {
  if (cwd === null || cwd === undefined || !contained(root, cwd)) return "outside_probe_root";
  if (actions === null || actions === undefined || actions.length === 0) {
    return "missing_structured_actions";
  }
  return actions.every((action) => safeAction(root, cwd, action)) ? "static_read" : "unsafe_action";
}

export function decideProbeApproval(
  requestId: JsonRpcId,
  method: string,
  params: unknown,
  probeRoot: string,
): ProbeApprovalDecision {
  if (method === "item/commandExecution/requestApproval") {
    const parsed = CommandApprovalParamsSchema.parse(params);
    const hasExpansion =
      (parsed.networkApprovalContext !== null && parsed.networkApprovalContext !== undefined) ||
      (parsed.proposedExecpolicyAmendment?.length ?? 0) > 0 ||
      (parsed.proposedNetworkPolicyAmendments?.length ?? 0) > 0;
    const reason = hasExpansion
      ? "permission_or_network_expansion"
      : staticReadReason(probeRoot, parsed.cwd, parsed.commandActions);
    const accepted = reason === "static_read";
    return {
      response: { decision: accepted ? "accept" : "decline" },
      observation: {
        requestId,
        method,
        itemId: parsed.itemId,
        decision: accepted ? "accept_static_read" : "decline",
        reasonCode: reason,
      },
    };
  }
  if (method === "item/fileChange/requestApproval") {
    const parsed = FileApprovalParamsSchema.parse(params);
    return {
      response: { decision: "decline" },
      observation: {
        requestId,
        method,
        itemId: parsed.itemId,
        decision: "decline",
        reasonCode: "probe_file_change_denied",
      },
    };
  }
  if (method === "item/permissions/requestApproval") {
    const parsed = PermissionApprovalParamsSchema.parse(params);
    return {
      response: { permissions: {}, scope: "turn", strictAutoReview: true },
      observation: {
        requestId,
        method,
        itemId: parsed.itemId ?? null,
        decision: "deny_permissions",
        reasonCode: "probe_permission_expansion_denied",
      },
    };
  }
  return {
    response: { action: "decline", content: null },
    observation: {
      requestId,
      method,
      itemId: null,
      decision: "decline",
      reasonCode: "unexpected_server_request",
    },
  };
}

export function probeItemViolation(item: ParsedThreadItem, probeRoot: string): string | null {
  if (
    item.type === "commandExecution" &&
    "status" in item &&
    "cwd" in item &&
    typeof item.cwd === "string" &&
    "commandActions" in item &&
    Array.isArray(item.commandActions)
  ) {
    if (item.status === "declined" || item.status === "failed") return null;
    const actions = item.commandActions.map((action) => CommandActionSchema.parse(action));
    const reason = staticReadReason(probeRoot, item.cwd, actions);
    return reason === "static_read"
      ? null
      : `unsafe_command_observed:${reason}:${[
          ...new Set(
            actions.map((action) =>
              action.type === "unknown" ? unknownCommandShape(action.command) : action.type,
            ),
          ),
        ].join(",")}`;
  }
  if (item.type === "fileChange" && "status" in item) {
    return item.status === "declined" || item.status === "failed" ? null : "file_change_observed";
  }
  if (new Set(["agentMessage", "plan", "reasoning", "userMessage"]).has(item.type)) return null;
  return `unexpected_tool_item:${item.type}`;
}
