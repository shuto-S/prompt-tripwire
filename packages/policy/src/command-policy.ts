export type CommandClass =
  | "static_read"
  | "git_read"
  | "test"
  | "lint"
  | "typecheck"
  | "build"
  | "verification"
  | "file_write"
  | "git_write"
  | "dependency"
  | "network"
  | "remote_write"
  | "destructive"
  | "permission"
  | "secret_access"
  | "migration"
  | "deploy"
  | "release"
  | "interpreter";

export interface CommandAction {
  readonly program: string;
  readonly args: readonly string[];
}

export type CommandClassification =
  | { readonly known: true; readonly commandClass: CommandClass }
  | { readonly known: false; readonly reason: "invalid_action" | "unknown_program" };

const STATIC_READ_PROGRAMS = new Set([
  "cat",
  "cut",
  "echo",
  "file",
  "find",
  "head",
  "jq",
  "ls",
  "pwd",
  "rg",
  "sort",
  "stat",
  "tail",
  "tr",
  "tree",
  "uniq",
  "wc",
]);
const TEST_PROGRAMS = new Set(["jest", "node:test", "pytest", "vitest"]);
const LINT_PROGRAMS = new Set(["eslint", "pylint", "ruff", "shellcheck"]);
const TYPECHECK_PROGRAMS = new Set(["mypy", "pyright", "tsc"]);
const BUILD_PROGRAMS = new Set(["cargo", "go", "gradle", "mvn", "xcodebuild"]);
const INTERPRETERS = new Set(["bun", "deno", "node", "perl", "php", "python", "python3", "ruby"]);
const SHELLS = new Set(["bash", "dash", "fish", "sh", "zsh"]);
const NETWORK_PROGRAMS = new Set(["curl", "ftp", "nc", "scp", "sftp", "ssh", "wget"]);
const DEPLOY_PROGRAMS = new Set([
  "ansible",
  "flyctl",
  "gcloud",
  "helm",
  "kubectl",
  "netlify",
  "pulumi",
  "serverless",
  "terraform",
  "vercel",
]);
const MIGRATION_PROGRAMS = new Set(["alembic", "flyway", "liquibase"]);
const FILE_WRITE_PROGRAMS = new Set(["cp", "install", "mkdir", "mv", "tee", "touch"]);
const PERMISSION_PROGRAMS = new Set(["chmod", "chown", "chgrp", "sudo"]);
const SECRET_PROGRAMS = new Set(["env", "keychain", "printenv", "security"]);
const CONTROL_TOKENS = new Set(["&&", "||", ";", "|", "&"]);

function programName(program: string): string | null {
  if (
    program.length === 0 ||
    program.includes("/") ||
    program.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(program)
  ) {
    return null;
  }
  return program.toLowerCase();
}

function isReadOnlySed(args: readonly string[]): boolean {
  const values = [...args];
  if (values[0] === "-n" || values[0] === "--quiet" || values[0] === "--silent") values.shift();
  if (values[0] === "-e") values.shift();
  const expression = values.shift();
  return (
    expression !== undefined &&
    /^(?:\d+|\$)(?:,(?:\d+|\$))?p$/u.test(expression) &&
    values.length > 0 &&
    values.every((value) => !value.startsWith("-"))
  );
}

function classifyPackageManager(program: string, args: readonly string[]): CommandClass | null {
  const command = args[0]?.toLowerCase();
  if (program === "npm" || program === "pnpm" || program === "yarn") {
    if (command === "test") return "test";
    if (command === "publish" || command === "pack") return "release";
    if (
      command === "add" ||
      command === "ci" ||
      command === "install" ||
      command === "remove" ||
      command === "uninstall" ||
      command === "update" ||
      command === "upgrade"
    ) {
      return "dependency";
    }
    if (command === "run") {
      const script = args[1]?.toLowerCase();
      if (script?.includes("lint")) return "lint";
      if (script?.includes("typecheck")) return "typecheck";
      if (script?.includes("build")) return "build";
      if (script?.includes("test")) return "test";
      if (script?.includes("check")) return "verification";
    }
    return null;
  }
  if (program === "uv") {
    if (command === "add" || command === "remove" || command === "sync") return "dependency";
    if (command === "publish") return "release";
    if (command === "run") {
      const child = args[1]?.toLowerCase();
      if (child === "pytest") return "test";
      if (child === "ruff") return "lint";
      if (child === "mypy" || child === "pyright") return "typecheck";
      return "interpreter";
    }
  }
  return null;
}

function classifyGit(args: readonly string[]): CommandClass | null {
  const command = args[0]?.toLowerCase();
  if (command === undefined) return null;
  if (args.some((argument) => argument === "--ext-diff" || argument === "--textconv")) {
    return null;
  }
  if (args.some((argument) => argument === "--output" || argument.startsWith("--output="))) {
    return "file_write";
  }
  if (new Set(["diff", "log", "rev-parse", "show", "status", "ls-files", "ls-tree"]).has(command)) {
    return "git_read";
  }
  if (
    command === "branch" &&
    (args.length === 1 || (args.length === 2 && args[1] === "--show-current"))
  ) {
    return "git_read";
  }
  if (command === "push") return "remote_write";
  if (new Set(["clone", "fetch", "pull"]).has(command)) return "network";
  if (new Set(["clean", "reset"]).has(command)) return "destructive";
  if (new Set(["commit", "tag"]).has(command)) return "git_write";
  if (
    new Set([
      "add",
      "am",
      "apply",
      "checkout",
      "merge",
      "rebase",
      "restore",
      "switch",
      "worktree",
    ]).has(command)
  ) {
    return "git_write";
  }
  return null;
}

function classifyGitHub(args: readonly string[]): CommandClass | null {
  const area = args[0]?.toLowerCase();
  const action = args[1]?.toLowerCase();
  if (area === undefined) return null;
  if (area === "api") {
    let method = "GET";
    for (const [index, argument] of args.entries()) {
      if (argument === "--method" || argument === "-X") {
        const suppliedMethod = args[index + 1];
        if (suppliedMethod === undefined) return null;
        method = suppliedMethod.toUpperCase();
      } else if (argument.startsWith("--method=")) {
        method = argument.slice("--method=".length).toUpperCase();
      } else if (/^-X.+/u.test(argument)) {
        method = argument.slice(2).toUpperCase();
      } else if (
        argument === "--input" ||
        argument === "-f" ||
        argument === "-F" ||
        argument === "--field" ||
        argument === "--raw-field" ||
        argument.startsWith("--input=") ||
        argument.startsWith("--field=") ||
        argument.startsWith("--raw-field=") ||
        /^-[fF].+/u.test(argument)
      ) {
        method = "POST";
      }
    }
    return method === "GET" ? "network" : "remote_write";
  }
  if (new Set(["auth", "secret", "variable"]).has(area)) return "secret_access";
  if (
    new Set(["issue", "pr", "release", "repo", "workflow"]).has(area) &&
    action !== undefined &&
    new Set([
      "close",
      "comment",
      "create",
      "delete",
      "edit",
      "merge",
      "ready",
      "reopen",
      "review",
      "run",
      "upload",
    ]).has(action)
  ) {
    return "remote_write";
  }
  if (new Set(["browse", "issue", "pr", "repo", "run", "search", "workflow"]).has(area)) {
    return "network";
  }
  return null;
}

function classifyMake(args: readonly string[]): CommandClass | null {
  const targets = args.filter((argument) => !argument.startsWith("-"));
  if (targets.length !== 1) return null;
  const target = targets[0]?.toLowerCase() ?? "";
  if (target.includes("lint")) return "lint";
  if (target.includes("typecheck")) return "typecheck";
  if (target.includes("test")) return "test";
  if (target.includes("check")) return "verification";
  if (target.includes("build")) return "build";
  return null;
}

export function classifyCommandAction(action: CommandAction): CommandClassification {
  const program = programName(action.program);
  if (
    program === null ||
    action.args.some(
      (argument) => /[\u0000-\u001f\u007f]/u.test(argument) || CONTROL_TOKENS.has(argument),
    )
  ) {
    return { known: false, reason: "invalid_action" };
  }
  if (SHELLS.has(program)) return { known: false, reason: "unknown_program" };
  if (program === "sed") {
    return isReadOnlySed(action.args)
      ? { known: true, commandClass: "static_read" }
      : { known: false, reason: "unknown_program" };
  }
  if (
    program === "find" &&
    action.args.some((argument) => new Set(["-exec", "-execdir", "-ok", "-okdir"]).has(argument))
  ) {
    return { known: false, reason: "unknown_program" };
  }
  if (
    (program === "find" &&
      action.args.some((argument) => new Set(["-delete", "-fls", "-fprint"]).has(argument))) ||
    (program === "sort" &&
      action.args.some((argument) => argument === "-o" || argument.startsWith("--output")))
  ) {
    return { known: true, commandClass: "file_write" };
  }
  if (program === "rg" && action.args.some((argument) => argument.startsWith("--pre"))) {
    return { known: false, reason: "unknown_program" };
  }
  if (STATIC_READ_PROGRAMS.has(program)) return { known: true, commandClass: "static_read" };
  if (TEST_PROGRAMS.has(program)) return { known: true, commandClass: "test" };
  if (LINT_PROGRAMS.has(program)) return { known: true, commandClass: "lint" };
  if (TYPECHECK_PROGRAMS.has(program)) return { known: true, commandClass: "typecheck" };
  if (INTERPRETERS.has(program)) return { known: true, commandClass: "interpreter" };
  if (program === "curl") {
    const writes = action.args.some(
      (argument) =>
        /^(?:-[dFT].*|--data(?:-.+)?(?:=|$)|--form(?:-string)?(?:=|$)|--json(?:=|$)|--request=(?:POST|PUT|PATCH|DELETE)|--upload-file(?:=|$))$/iu.test(
          argument,
        ) || /^-X(?:POST|PUT|PATCH|DELETE)$/iu.test(argument),
    );
    const methodIndex = action.args.findIndex(
      (argument) => argument === "-X" || argument === "--request",
    );
    const method = methodIndex >= 0 ? action.args[methodIndex + 1]?.toUpperCase() : undefined;
    return {
      known: true,
      commandClass:
        writes || (method !== undefined && method !== "GET" && method !== "HEAD")
          ? "remote_write"
          : "network",
    };
  }
  if (program === "wget") {
    return {
      known: true,
      commandClass: action.args.some((argument) => /^--post-(?:data|file)(?:=|$)/u.test(argument))
        ? "remote_write"
        : "network",
    };
  }
  if (new Set(["ftp", "nc", "scp", "sftp", "ssh"]).has(program)) {
    return { known: true, commandClass: "remote_write" };
  }
  if (NETWORK_PROGRAMS.has(program)) return { known: true, commandClass: "network" };
  if (DEPLOY_PROGRAMS.has(program)) return { known: true, commandClass: "deploy" };
  if (MIGRATION_PROGRAMS.has(program)) return { known: true, commandClass: "migration" };
  if (FILE_WRITE_PROGRAMS.has(program)) return { known: true, commandClass: "file_write" };
  if (PERMISSION_PROGRAMS.has(program)) return { known: true, commandClass: "permission" };
  if (SECRET_PROGRAMS.has(program)) return { known: true, commandClass: "secret_access" };
  if (program === "rm") return { known: true, commandClass: "destructive" };
  if (program === "git") {
    const commandClass = classifyGit(action.args);
    return commandClass === null
      ? { known: false, reason: "unknown_program" }
      : { known: true, commandClass };
  }
  if (program === "gh") {
    const commandClass = classifyGitHub(action.args);
    return commandClass === null
      ? { known: false, reason: "unknown_program" }
      : { known: true, commandClass };
  }
  if (program === "make") {
    const commandClass = classifyMake(action.args);
    return commandClass === null
      ? { known: false, reason: "unknown_program" }
      : { known: true, commandClass };
  }
  const packageManagerClass = classifyPackageManager(program, action.args);
  if (packageManagerClass !== null) return { known: true, commandClass: packageManagerClass };
  if (BUILD_PROGRAMS.has(program)) {
    const command = action.args[0]?.toLowerCase();
    if (command === "test") return { known: true, commandClass: "test" };
    if (command === "check") return { known: true, commandClass: "verification" };
    if (command === "build") return { known: true, commandClass: "build" };
  }
  if (program === "prisma" && action.args[0]?.toLowerCase() === "migrate") {
    return { known: true, commandClass: "migration" };
  }
  return { known: false, reason: "unknown_program" };
}

export interface CommandRequest {
  readonly source: "structured" | "raw";
  readonly actions: readonly CommandAction[];
}

export interface CommandContract {
  readonly allowedCommandClasses: readonly string[];
  readonly deniedCommandClasses: readonly string[];
}

export type CommandMatchReason =
  | "raw_command_denied"
  | "empty_command"
  | "invalid_command_policy"
  | "unknown_command"
  | "command_class_denied"
  | "command_class_not_allowed"
  | "command_allowed";

export interface CommandMatchResult {
  readonly outcome: "allow" | "deny";
  readonly reason: CommandMatchReason;
  readonly commandClasses: readonly CommandClass[];
}

function hasInvalidPolicyClass(values: readonly string[]): boolean {
  return values.some((value) => value.length === 0 || /[*?\s\u0000-\u001f\u007f]/u.test(value));
}

export function matchCommandRequest(
  request: CommandRequest,
  contract: CommandContract,
): CommandMatchResult {
  if (request.source !== "structured") {
    return { outcome: "deny", reason: "raw_command_denied", commandClasses: [] };
  }
  if (request.actions.length === 0) {
    return { outcome: "deny", reason: "empty_command", commandClasses: [] };
  }
  if (
    hasInvalidPolicyClass(contract.allowedCommandClasses) ||
    hasInvalidPolicyClass(contract.deniedCommandClasses)
  ) {
    return { outcome: "deny", reason: "invalid_command_policy", commandClasses: [] };
  }

  const classifications = request.actions.map(classifyCommandAction);
  if (classifications.some((classification) => !classification.known)) {
    return { outcome: "deny", reason: "unknown_command", commandClasses: [] };
  }
  const commandClasses = classifications.flatMap((classification) =>
    classification.known ? [classification.commandClass] : [],
  );
  if (commandClasses.some((commandClass) => contract.deniedCommandClasses.includes(commandClass))) {
    return { outcome: "deny", reason: "command_class_denied", commandClasses };
  }
  if (
    commandClasses.some((commandClass) => !contract.allowedCommandClasses.includes(commandClass))
  ) {
    return { outcome: "deny", reason: "command_class_not_allowed", commandClasses };
  }
  return { outcome: "allow", reason: "command_allowed", commandClasses };
}
