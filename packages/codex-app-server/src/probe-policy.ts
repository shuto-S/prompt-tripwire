import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { isSecretLikePath } from "@prompt-tripwire/policy";

import {
  CommandActionSchema,
  CommandApprovalParamsSchema,
  FileApprovalParamsSchema,
  PermissionApprovalParamsSchema,
  type ParsedThreadItem,
  type ProtocolCommandAction,
} from "./protocol.js";
import { AppServerError } from "./errors.js";
import type { ApprovalObservation, JsonRpcId } from "./types.js";

export interface ProbeApprovalDecision {
  readonly response: unknown;
  readonly observation: ApprovalObservation;
}

export function decideComparatorApproval(
  requestId: JsonRpcId,
  method: string,
  params: unknown,
): ProbeApprovalDecision {
  if (method === "item/commandExecution/requestApproval") {
    const parsed = CommandApprovalParamsSchema.parse(params);
    return {
      response: { decision: "decline" },
      observation: {
        requestId,
        method,
        itemId: parsed.itemId,
        decision: "decline",
        reasonCode: "comparison_tools_denied",
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
        reasonCode: "comparison_tools_denied",
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
        itemId: parsed.itemId,
        decision: "deny_permissions",
        reasonCode: "comparison_tools_denied",
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
      reasonCode: "comparison_tools_denied",
    },
  };
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
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

function hasParentSegment(path: string): boolean {
  return path.split(/[\\/]/u).includes("..");
}

function hasAmbiguousStructuredPath(path: string): boolean {
  // Structured paths are still untrusted App Server data. Reject values whose
  // shell interpretation can differ from their lexical filesystem meaning.
  return /[\0\r\n$`*?[\]{}~]/u.test(path);
}

function canonicalContained(root: string, candidate: string): boolean {
  if (hasParentSegment(candidate) || hasAmbiguousStructuredPath(candidate)) return false;
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    return false;
  }

  const lexicalRoot = resolve(root);
  const lexicalCandidate = resolve(candidate);
  if (!contained(lexicalRoot, lexicalCandidate) && !contained(canonicalRoot, lexicalCandidate)) {
    return false;
  }

  let existing = lexicalCandidate;
  const suffix: string[] = [];
  while (!existsSync(existing) && existing !== dirname(existing)) {
    suffix.unshift(relative(dirname(existing), existing));
    existing = dirname(existing);
  }
  if (!existsSync(existing)) return false;

  try {
    const canonicalCandidate = resolve(realpathSync(existing), ...suffix);
    return contained(canonicalRoot, canonicalCandidate);
  } catch {
    return false;
  }
}

function tokenizeStaticCommand(command: string): readonly string[] | null {
  const tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: "single" | "double" | null = null;

  const finishToken = (): void => {
    if (!tokenStarted) return;
    tokens.push(token);
    token = "";
    tokenStarted = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    if (character === "\0" || character === "\r" || character === "\n") return null;

    if (quote === "single") {
      if (character === "'") quote = null;
      else token += character;
      continue;
    }

    if (quote === "double") {
      if (character === '"') {
        quote = null;
        continue;
      }
      if (character === "$" || character === "`") return null;
      if (character === "\\") {
        const next = command[index + 1];
        if (next === undefined || next === "\r" || next === "\n") return null;
        if (new Set(['"', "$", "`", "\\"]).has(next)) {
          token += next;
          index += 1;
          continue;
        }
        token += character;
        continue;
      }
      token += character;
      continue;
    }

    if (/\s/u.test(character)) {
      finishToken();
      continue;
    }
    if (character === "'") {
      quote = "single";
      tokenStarted = true;
      continue;
    }
    if (character === '"') {
      quote = "double";
      tokenStarted = true;
      continue;
    }
    if (character === "\\") {
      const next = command[index + 1];
      if (next === undefined || next === "\r" || next === "\n") return null;
      token += next;
      tokenStarted = true;
      index += 1;
      continue;
    }
    if (/[|&;<>()[\]{}$`*?~^!#]/u.test(character)) return null;
    if (character === "=" && !tokenStarted) return null;
    token += character;
    tokenStarted = true;
  }

  if (quote !== null) return null;
  finishToken();
  return tokens.length === 0 ? null : tokens;
}

function sameTokens(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function actualCommandMatchesAction(
  actualCommand: string,
  actionTokens: readonly string[],
): boolean {
  const actualTokens = tokenizeStaticCommand(actualCommand);
  if (actualTokens === null) return false;
  if (sameTokens(actionTokens, actualTokens)) return true;

  // Codex App Server 0.144.4 reports macOS command items through this exact
  // process envelope even when the structured action is a direct static read.
  // Unwrap only that observed shape, then apply the same fail-closed grammar to
  // the single inner command. Other shells, flags, and extra argv stay denied.
  if (
    actualTokens.length !== 3 ||
    actualTokens[0] !== "/bin/zsh" ||
    !new Set(["-c", "-lc"]).has(actualTokens[1] ?? "")
  ) {
    return false;
  }
  const innerTokens = tokenizeStaticCommand(actualTokens[2] ?? "");
  return innerTokens !== null && sameTokens(actionTokens, innerTokens);
}

function canonicalTarget(root: string, cwd: string, path: string): string | null {
  if (hasParentSegment(path) || hasAmbiguousStructuredPath(path)) return null;
  const candidate = resolve(cwd, path);
  if (!canonicalContained(root, candidate)) return null;

  let existing = candidate;
  const suffix: string[] = [];
  while (!existsSync(existing) && existing !== dirname(existing)) {
    suffix.unshift(relative(dirname(existing), existing));
    existing = dirname(existing);
  }
  if (!existsSync(existing)) return null;
  try {
    return resolve(realpathSync(existing), ...suffix);
  } catch {
    return null;
  }
}

function actionPathMatches(
  root: string,
  cwd: string,
  actionPath: string | null | undefined,
  commandPath: string | null,
): boolean {
  if (actionPath === null || actionPath === undefined) return commandPath === null;
  if (commandPath === null) return false;
  const actionTarget = canonicalTarget(root, cwd, actionPath);
  const commandTarget = canonicalTarget(root, cwd, commandPath);
  return actionTarget !== null && commandTarget !== null && actionTarget === commandTarget;
}

function isProtectedAbsolutePath(root: string, target: string): boolean {
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    return true;
  }
  for (const candidateRoot of new Set([resolve(root), canonicalRoot])) {
    if (!contained(candidateRoot, target)) continue;
    const repositoryPath = relative(candidateRoot, target).split(sep).join("/");
    const normalized = repositoryPath.toLowerCase();
    if (
      repositoryPath !== "" &&
      (normalized === ".git" || normalized.startsWith(".git/") || isSecretLikePath(repositoryPath))
    ) {
      return true;
    }
  }
  return false;
}

function isProtectedActionPath(root: string, cwd: string, path: string): boolean {
  const lexicalTarget = resolve(cwd, path);
  const canonical = canonicalTarget(root, cwd, path);
  return (
    canonical === null ||
    isProtectedAbsolutePath(root, lexicalTarget) ||
    isProtectedAbsolutePath(root, canonical)
  );
}

function searchCanReachProtectedContent(
  root: string,
  cwd: string,
  path: string | null,
  includeHidden: boolean,
): boolean {
  const requestedPath = path ?? ".";
  if (isProtectedActionPath(root, cwd, requestedPath)) return true;
  const target = canonicalTarget(root, cwd, requestedPath);
  if (target === null) return true;
  if (!existsSync(target)) return false;

  try {
    if (!statSync(target).isDirectory()) return false;
  } catch {
    return true;
  }

  const pending = [target];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith(".")) continue;
      const entryPath = join(directory, entry.name);
      if (isProtectedAbsolutePath(root, entryPath)) return true;
      if (entry.isSymbolicLink()) {
        try {
          if (isProtectedAbsolutePath(root, realpathSync(entryPath))) return true;
        } catch {
          return true;
        }
      } else if (entry.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }
  return false;
}

function searchCanIncludeHiddenFiles(tokens: readonly string[]): boolean {
  let optionsEnded = false;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!optionsEnded && token === "--") {
      optionsEnded = true;
      continue;
    }
    if (optionsEnded) continue;
    if (token === "--hidden") return true;
    if (token === "-g" || token === "--glob") {
      const pattern = tokens[index + 1];
      if (pattern !== undefined && !pattern.startsWith("!")) return true;
      index += 1;
      continue;
    }
    if (token.startsWith("--glob=")) {
      const pattern = token.slice("--glob=".length);
      if (!pattern.startsWith("!")) return true;
    }
  }
  return false;
}

function readCommandPath(tokens: readonly string[]): string | null {
  const [program, ...arguments_] = tokens;
  if (program === undefined || program.includes("/")) return null;
  if (program === "sed") {
    let index = 0;
    let quiet = false;
    if (arguments_[index] === "-n") {
      quiet = true;
      index += 1;
    }
    if (arguments_[index] === "-e") index += 1;
    const script = arguments_[index];
    const path = arguments_[index + 1];
    if (
      !quiet ||
      script === undefined ||
      path === undefined ||
      index + 2 !== arguments_.length ||
      !/^(?:\d+|\$)(?:,(?:\d+|\$))?p$/u.test(script)
    ) {
      return null;
    }
    return path;
  }
  const operands: string[] = [];
  let optionsEnded = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? "";
    if (!optionsEnded && argument === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && argument.startsWith("-")) {
      if (program === "cat" && /^-[bensuvt]+$/u.test(argument)) continue;
      if (program === "wc" && /^-[clmwL]+$/u.test(argument)) continue;
      if ((program === "head" || program === "tail") && /^-\d+$/u.test(argument)) continue;
      if ((program === "head" || program === "tail") && /^-[nc]\d+$/u.test(argument)) continue;
      if (program === "head" || program === "tail") {
        if (argument === "-n" || argument === "-c") {
          const value = arguments_[index + 1];
          if (value === undefined || !/^[+-]?\d+$/u.test(value)) return null;
          index += 1;
          continue;
        }
        if (/^--(?:lines|bytes)=[+-]?\d+$/u.test(argument)) continue;
      }
      return null;
    }
    operands.push(argument);
  }

  return new Set(["cat", "head", "tail", "wc"]).has(program) && operands.length === 1
    ? (operands[0] ?? null)
    : null;
}

function listCommandPath(tokens: readonly string[]): string | null | undefined {
  const [program, ...arguments_] = tokens;
  if (program === undefined || program.includes("/")) return undefined;
  if (program === "ls") {
    const operands: string[] = [];
    let optionsEnded = false;
    for (const argument of arguments_) {
      if (!optionsEnded && argument === "--") {
        optionsEnded = true;
      } else if (!optionsEnded && argument.startsWith("-")) {
        if (!/^-[1AaCcdFfhHilRrSstux]+$/u.test(argument)) return undefined;
      } else {
        operands.push(argument);
      }
    }
    if (operands.length > 1) return undefined;
    return operands[0] ?? null;
  }

  if (program === "rg") {
    const booleanOptions = new Set([
      "--files",
      "--hidden",
      "--no-ignore",
      "--no-ignore-dot",
      "--no-ignore-global",
      "--no-ignore-vcs",
      "--no-messages",
      "--null",
      "--one-file-system",
      "-0",
    ]);
    const valueOptions = new Set([
      "--glob",
      "--max-depth",
      "--max-filesize",
      "--type",
      "--type-not",
      "-T",
      "-g",
      "-t",
    ]);
    const valueOptionWithEquals = /^(?:--glob|--max-depth|--max-filesize|--type|--type-not)=.+$/u;
    const operands: string[] = [];
    let sawFiles = false;
    let optionsEnded = false;
    for (let index = 0; index < arguments_.length; index += 1) {
      const argument = arguments_[index] ?? "";
      if (!optionsEnded && argument === "--") {
        optionsEnded = true;
      } else if (!optionsEnded && booleanOptions.has(argument)) {
        if (argument === "--files") sawFiles = true;
      } else if (!optionsEnded && valueOptions.has(argument)) {
        if (arguments_[index + 1] === undefined) return undefined;
        index += 1;
      } else if (!optionsEnded && valueOptionWithEquals.test(argument)) {
        continue;
      } else if (!optionsEnded && argument.startsWith("-")) {
        return undefined;
      } else {
        operands.push(argument);
      }
    }
    if (!sawFiles || operands.length > 1) return undefined;
    return operands[0] ?? null;
  }

  if (program !== "find") return undefined;
  let index = 0;
  let path: string | null = null;
  if (arguments_[0] !== undefined && !arguments_[0].startsWith("-")) {
    path = arguments_[0];
    index = 1;
  }
  const valueOptions = new Map<string, RegExp>([
    ["-maxdepth", /^\d+$/u],
    ["-mindepth", /^\d+$/u],
    ["-type", /^[bcdpflsD]$/u],
    ["-name", /^.+$/u],
    ["-iname", /^.+$/u],
    ["-path", /^.+$/u],
    ["-ipath", /^.+$/u],
  ]);
  const noValueOptions = new Set([
    "-a",
    "-and",
    "-depth",
    "-empty",
    "-false",
    "-mount",
    "-not",
    "-o",
    "-one-file-system",
    "-or",
    "-print",
    "-print0",
    "-true",
    "-xdev",
  ]);
  for (; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? "";
    if (/^-(?:exec|execdir|ok|okdir|delete|fprint|fprintf|fls)/u.test(argument)) return undefined;
    if (noValueOptions.has(argument)) continue;
    const valuePattern = valueOptions.get(argument);
    if (valuePattern === undefined) return undefined;
    const value = arguments_[index + 1];
    if (value === undefined || !valuePattern.test(value)) return undefined;
    index += 1;
  }
  return path;
}

function searchCommandPath(
  tokens: readonly string[],
  expectedQuery: string | null | undefined,
): string | null | undefined {
  const [program, ...arguments_] = tokens;
  if (program !== "rg") return undefined;
  const booleanOptions = new Set([
    "--case-sensitive",
    "--count",
    "--count-matches",
    "--crlf",
    "--files-with-matches",
    "--files-without-match",
    "--fixed-strings",
    "--heading",
    "--hidden",
    "--ignore-case",
    "--invert-match",
    "--json",
    "--line-number",
    "--line-regexp",
    "--multiline",
    "--multiline-dotall",
    "--no-heading",
    "--no-ignore",
    "--no-ignore-dot",
    "--no-ignore-global",
    "--no-ignore-vcs",
    "--no-line-number",
    "--no-messages",
    "--null",
    "--one-file-system",
    "--pcre2",
    "--smart-case",
    "--stats",
    "--trim",
    "--word-regexp",
    "-F",
    "-N",
    "-P",
    "-S",
    "-U",
    "-c",
    "-i",
    "-l",
    "-n",
    "-s",
    "-v",
    "-w",
    "-x",
  ]);
  const valueOptions = new Set([
    "--after-context",
    "--before-context",
    "--context",
    "--dfa-size-limit",
    "--encoding",
    "--engine",
    "--glob",
    "--max-count",
    "--max-depth",
    "--max-filesize",
    "--regex-size-limit",
    "--type",
    "--type-not",
    "-A",
    "-B",
    "-C",
    "-T",
    "-g",
    "-m",
    "-t",
  ]);
  const valueOptionWithEquals =
    /^(?:--after-context|--before-context|--context|--dfa-size-limit|--encoding|--engine|--glob|--max-count|--max-depth|--max-filesize|--regex-size-limit|--type|--type-not)=.+$/u;
  const operands: string[] = [];
  let optionPattern: string | null = null;
  let optionsEnded = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? "";
    if (!optionsEnded && argument === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && (argument === "-e" || argument === "--regexp")) {
      const value = arguments_[index + 1];
      if (value === undefined || optionPattern !== null) return undefined;
      optionPattern = value;
      index += 1;
      continue;
    }
    if (!optionsEnded && /^(?:--regexp)=/u.test(argument)) {
      if (optionPattern !== null) return undefined;
      optionPattern = argument.slice(argument.indexOf("=") + 1);
      continue;
    }
    if (!optionsEnded && booleanOptions.has(argument)) continue;
    if (!optionsEnded && /^-[FNPUScilnsvwx]+$/u.test(argument)) continue;
    if (!optionsEnded && valueOptions.has(argument)) {
      if (arguments_[index + 1] === undefined) return undefined;
      index += 1;
      continue;
    }
    if (!optionsEnded && valueOptionWithEquals.test(argument)) continue;
    if (!optionsEnded && argument.startsWith("-")) return undefined;
    operands.push(argument);
  }

  const query = optionPattern ?? operands.shift();
  if (query === undefined || expectedQuery === null || expectedQuery === undefined)
    return undefined;
  if (query !== expectedQuery || operands.length > 1) return undefined;
  return operands[0] ?? null;
}

export function assertProbeRootSymlinkContainment(root: string): void {
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    throw new AppServerError(
      "PROBE_CONTAINMENT_VIOLATION",
      "probe root could not be resolved canonically",
    );
  }

  const pending = [canonicalRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      throw new AppServerError(
        "PROBE_CONTAINMENT_VIOLATION",
        "probe root could not be audited for symlink escape",
      );
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = realpathSync(path);
        } catch {
          throw new AppServerError(
            "PROBE_CONTAINMENT_VIOLATION",
            "probe root contains an unresolved symlink",
          );
        }
        if (!contained(canonicalRoot, target)) {
          throw new AppServerError(
            "PROBE_CONTAINMENT_VIOLATION",
            "probe root contains a symlink outside the repository snapshot",
          );
        }
      } else if (entry.isDirectory()) {
        pending.push(path);
      }
    }
  }
}

function safeAction(
  root: string,
  cwd: string,
  action: ProtocolCommandAction,
  actualCommand: string | null | undefined,
): boolean {
  if (!canonicalContained(root, cwd)) return false;
  if (action.type === "unknown") return false;
  if (actualCommand === null || actualCommand === undefined) return false;
  if (
    action.path !== null &&
    action.path !== undefined &&
    (hasParentSegment(action.path) || hasAmbiguousStructuredPath(action.path))
  ) {
    return false;
  }

  const actionTokens = tokenizeStaticCommand(action.command);
  if (actionTokens === null) return false;
  if (!actualCommandMatchesAction(actualCommand, actionTokens)) return false;

  let commandPath: string | null | undefined;
  if (action.type === "read") commandPath = readCommandPath(actionTokens);
  else if (action.type === "listFiles") commandPath = listCommandPath(actionTokens);
  else commandPath = searchCommandPath(actionTokens, action.query);
  if (
    commandPath === undefined ||
    commandPath === "-" ||
    !actionPathMatches(root, cwd, action.path, commandPath)
  ) {
    return false;
  }
  if (action.type === "read") {
    return !isProtectedActionPath(root, cwd, action.path);
  }
  if (action.type === "search") {
    return !searchCanReachProtectedContent(
      root,
      cwd,
      commandPath,
      searchCanIncludeHiddenFiles(actionTokens),
    );
  }
  // listFiles may expose repository-relative names and metadata, but never file
  // contents. Keeping that boundary makes protected paths discoverable enough
  // to avoid them without granting a content read.
  return true;
}

function staticReadReason(
  root: string,
  cwd: string | null | undefined,
  actions: readonly ProtocolCommandAction[] | null | undefined,
  actualCommand?: string | null,
): "static_read" | "missing_structured_actions" | "outside_probe_root" | "unsafe_action" {
  if (cwd === null || cwd === undefined || !canonicalContained(root, cwd)) {
    return "outside_probe_root";
  }
  if (actions === null || actions === undefined || actions.length === 0) {
    return "missing_structured_actions";
  }
  if (actions.length !== 1) return "unsafe_action";
  const action = actions[0];
  return action !== undefined && safeAction(root, cwd, action, actualCommand)
    ? "static_read"
    : "unsafe_action";
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
      : staticReadReason(probeRoot, parsed.cwd, parsed.commandActions, parsed.command);
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
        itemId: parsed.itemId,
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
    "command" in item &&
    typeof item.command === "string" &&
    "commandActions" in item &&
    Array.isArray(item.commandActions)
  ) {
    if (item.status === "declined") return null;
    const actions = item.commandActions.map((action) => CommandActionSchema.parse(action));
    const reason = staticReadReason(probeRoot, item.cwd, actions, item.command);
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
    return item.status === "declined" ? null : "file_change_observed";
  }
  if (new Set(["agentMessage", "plan", "reasoning", "userMessage"]).has(item.type)) return null;
  return `unexpected_tool_item:${item.type}`;
}

export function comparisonItemViolation(item: ParsedThreadItem): string | null {
  if (new Set(["agentMessage", "plan", "reasoning", "userMessage"]).has(item.type)) return null;
  return `comparison_tool_item:${item.type}`;
}
