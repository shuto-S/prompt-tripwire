export interface MatchResult<T extends string = string> {
  readonly outcome: "allow" | "deny";
  readonly reason: T;
}

export type NetworkAction = "read" | "write";

export interface NetworkPolicy {
  readonly mode: "deny" | "allowlist";
  readonly hosts: readonly string[];
  readonly actions: readonly NetworkAction[];
}

export interface NetworkRequest {
  readonly host: string;
  readonly action: string;
}

export type NetworkMatchReason =
  | "network_denied"
  | "invalid_network_policy"
  | "unknown_network_host"
  | "unknown_network_action"
  | "network_host_not_allowed"
  | "network_action_not_allowed"
  | "network_allowed";

function normalizeHost(host: string): string | null {
  const normalized = host.toLowerCase().replace(/\.$/u, "");
  if (
    normalized.length === 0 ||
    normalized.includes("*") ||
    normalized.includes("://") ||
    /[/\\@:#?\s]/u.test(normalized)
  ) {
    return null;
  }
  const labels = normalized.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    return null;
  }
  return normalized;
}

function isNetworkAction(value: string): value is NetworkAction {
  return value === "read" || value === "write";
}

export function matchNetworkRequest(
  request: NetworkRequest,
  policy: NetworkPolicy,
): MatchResult<NetworkMatchReason> {
  if (policy.mode === "deny") {
    if (policy.hosts.length > 0 || policy.actions.length > 0) {
      return { outcome: "deny", reason: "invalid_network_policy" };
    }
    return { outcome: "deny", reason: "network_denied" };
  }
  const normalizedHost = normalizeHost(request.host);
  if (normalizedHost === null) {
    return { outcome: "deny", reason: "unknown_network_host" };
  }
  if (!isNetworkAction(request.action)) {
    return { outcome: "deny", reason: "unknown_network_action" };
  }
  const allowedHosts = policy.hosts.map(normalizeHost);
  if (allowedHosts.some((host) => host === null)) {
    return { outcome: "deny", reason: "invalid_network_policy" };
  }
  if (!allowedHosts.includes(normalizedHost)) {
    return { outcome: "deny", reason: "network_host_not_allowed" };
  }
  if (!policy.actions.includes(request.action)) {
    return { outcome: "deny", reason: "network_action_not_allowed" };
  }
  return { outcome: "allow", reason: "network_allowed" };
}

export interface NamedActionPolicy {
  readonly mode: "deny" | "allowlist";
  readonly allowed: readonly string[];
}

export type NamedActionMatchReason =
  | "action_denied"
  | "invalid_action_policy"
  | "unknown_action"
  | "action_not_allowed"
  | "action_allowed";

function normalizeAction(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || /[*?\u0000-\u001f\u007f]/u.test(normalized)) return null;
  return normalized;
}

export function matchNamedAction(
  action: string,
  policy: NamedActionPolicy,
): MatchResult<NamedActionMatchReason> {
  if (policy.mode === "deny") {
    if (policy.allowed.length > 0) {
      return { outcome: "deny", reason: "invalid_action_policy" };
    }
    return { outcome: "deny", reason: "action_denied" };
  }
  const normalized = normalizeAction(action);
  if (normalized === null) return { outcome: "deny", reason: "unknown_action" };
  const allowed = policy.allowed.map(normalizeAction);
  if (allowed.some((item) => item === null)) {
    return { outcome: "deny", reason: "invalid_action_policy" };
  }
  return allowed.includes(normalized)
    ? { outcome: "allow", reason: "action_allowed" }
    : { outcome: "deny", reason: "action_not_allowed" };
}

export function denyPermissionExpansion(): MatchResult<"permission_expansion_denied"> {
  return { outcome: "deny", reason: "permission_expansion_denied" };
}
