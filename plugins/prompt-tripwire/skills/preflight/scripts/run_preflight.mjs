#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_CODEX_VERSION = "0.144.4";
export const REQUIRED_TRIPWIRE_VERSION = "0.1.3";
export const REENTRY_ENV = "PROMPT_TRIPWIRE_PLUGIN_REENTRY";

const NESTED_APP_SERVER_REQUEST_FAILURE = /\bINSUFFICIENT_VALID_PROBES:\s*request failed\b/iu;
const CALLER_SANDBOX_HINT =
  "The caller shell sandbox may have blocked the nested authenticated Codex App Server request. " +
  "Ask for normal Codex command permission to run only this adapter outside the caller shell " +
  "sandbox, then retry the same inspect once. This permission is not a PromptTripwire decision " +
  "or contract approval. If permission is denied or the retry fails, stop; never remove " +
  `${REENTRY_ENV} or weaken PromptTripwire restrictions.`;

export class PluginError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PluginError";
    this.code = code;
  }
}

function text(value) {
  return [...String(value ?? "")]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return (codePoint < 32 && codePoint !== 9 && codePoint !== 10) || codePoint === 127
        ? " "
        : character;
    })
    .join("")
    .trim();
}

export function redactOutput(value) {
  const preservedDecisionInboxUrls = [];
  const output = text(value).replace(
    /http:\/\/127\.0\.0\.1:\d{1,5}\/runs\/run_[a-z0-9-]+#token=[a-z0-9_-]{16,}/giu,
    (url) => {
      const index = preservedDecisionInboxUrls.push(url) - 1;
      return `\uE000${String(index)}\uE001`;
    },
  );
  return output
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/giu,
      "[REDACTED]",
    )
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^/\s"'@:]+(?::[^/\s"'@]*)?@[^\s"'<>]+/giu, "[REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/gu, "sk-****")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, "gh_****")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/gu, "xox-****")
    .replace(/\bAKIA[0-9A-Z]{16}\b/gu, "AKIA****")
    .replace(/("authorization"\s*:\s*"(?:bearer|basic)\s+)(?:\\.|[^"\\])+(?=")/giu, "$1****")
    .replace(/\b(authorization\s*:\s*(?:bearer|basic)\s+)[^\r\n]+/giu, "$1****")
    .replace(/\b((?:bearer|basic)\s+)\\"[^\r\n]*?\\"/giu, "$1****")
    .replace(/\b((?:bearer|basic)\s+)\\'[^\r\n]*?\\'/giu, "$1****")
    .replace(/\b((?:bearer|basic)\s+)\\["'][^\r\n]*/giu, "$1****")
    .replace(/\b((?:bearer|basic)\s+)"(?:\\.|[^"\\])*"/giu, "$1****")
    .replace(/\b((?:bearer|basic)\s+)'(?:\\.|[^'\\])*'/giu, "$1****")
    .replace(/\b((?:bearer|basic)\s+)["'][^\r\n]*/giu, "$1****")
    .replace(
      /\b((?:bearer|basic)\s+)(?!\*{4}(?=[\s"',;.!?)}\]]|$))\S+?(?=(?:[,;.!?](?=\s|$))|\s|$)/giu,
      "$1****",
    )
    .replace(
      /\b((?:(?:[a-z0-9]+[_-])*(?:api[_-]?key|token|password|secret|credential|cookie|private[_-]?key|signing[_-]?key))\s*[:=]\s*)(["'])[^"'\r\n]*\2/giu,
      "$1$2****$2",
    )
    .replace(
      /\b((?:(?:[a-z0-9]+[_-])*(?:api[_-]?key|token|password|secret|credential|cookie|private[_-]?key|signing[_-]?key))\s*[:=]\s*)[^\s"',;\]}]{4,}/giu,
      "$1****",
    )
    .replace(/\uE000(\d+)\uE001/gu, (_placeholder, index) => {
      return preservedDecisionInboxUrls[Number(index)] ?? "[REDACTED]";
    });
}

export function assertSupportedPlatform(platform = process.platform, arch = process.arch) {
  if (platform !== "darwin" || arch !== "arm64") {
    throw new PluginError(
      "UNSUPPORTED_PLATFORM",
      `PromptTripwire Plugin requires macOS arm64 (detected ${platform}/${arch})`,
    );
  }
}

function commandOutput(
  command,
  args,
  {
    notFoundCode = "RUNTIME_NOT_FOUND",
    failureCode = "RUNTIME_VERSION_CHECK_FAILED",
    failureMessage = "required executable is unavailable or returned an invalid response",
  } = {},
) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    const code = error?.code === "ENOENT" ? notFoundCode : failureCode;
    throw new PluginError(code, failureMessage);
  }
}

function executableOnPath(name) {
  try {
    return text(commandOutput("which", [name]));
  } catch {
    return null;
  }
}

function bundledRuntime() {
  const configPath = fileURLToPath(new URL("../../../runtime.json", import.meta.url));
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new PluginError("RUNTIME_CONFIG_INVALID", "installed runtime metadata is invalid");
  }
  const runtime = parsed?.runtime;
  if (typeof runtime !== "string" || !isAbsolute(runtime) || runtime.includes("\0")) {
    throw new PluginError("RUNTIME_CONFIG_INVALID", "installed runtime metadata is invalid");
  }
  return runtime;
}

export function resolveRuntime(env = process.env) {
  const configured = env.PROMPT_TRIPWIRE_BIN?.trim();
  const command = configured || bundledRuntime() || executableOnPath("tripwire");
  if (!command) {
    throw new PluginError(
      "RUNTIME_NOT_FOUND",
      "tripwire runtime was not found; install the existing PromptTripwire macOS arm64 artifact or set PROMPT_TRIPWIRE_BIN",
    );
  }
  return resolve(command);
}

export function assertRuntimeVersions(runtime, env = process.env) {
  const tripwireVersion = commandOutput(runtime, ["--version"]);
  if (text(tripwireVersion) !== `prompt-tripwire ${REQUIRED_TRIPWIRE_VERSION}`) {
    throw new PluginError("RUNTIME_VERSION_MISMATCH", "PromptTripwire runtime 0.1.3 is required");
  }
  const codex = env.PROMPT_TRIPWIRE_CODEX_BIN?.trim() || executableOnPath("codex");
  if (!codex) {
    throw new PluginError(
      "CODEX_NOT_FOUND",
      `Codex CLI ${REQUIRED_CODEX_VERSION} is required; sign in with the existing Codex CLI`,
    );
  }
  const codexVersion = commandOutput(codex, ["--version"], {
    notFoundCode: "CODEX_NOT_FOUND",
    failureCode: "CODEX_VERSION_CHECK_FAILED",
    failureMessage: "Codex CLI is unavailable or returned an invalid version",
  });
  if (text(codexVersion) !== `codex-cli ${REQUIRED_CODEX_VERSION}`) {
    throw new PluginError(
      "CODEX_VERSION_MISMATCH",
      `Codex CLI ${REQUIRED_CODEX_VERSION} is required`,
    );
  }
  try {
    execFileSync(codex, ["login", "status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    throw new PluginError(
      "CODEX_LOGIN_REQUIRED",
      "sign in with the normal Codex CLI login flow before running PromptTripwire",
    );
  }
}

export function parseArgs(argv) {
  const [action = "inspect", ...rest] = argv;
  const options = {
    action: action === "--help" ? "inspect" : action,
    repo: process.cwd(),
    task: null,
    taskFile: null,
    taskStdin: false,
    dirty: null,
    runId: null,
    contract: null,
    format: "markdown",
  };
  if (action === "--help") options.help = true;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    const value = () => {
      const next = rest[index + 1];
      if (!next || next.startsWith("--"))
        throw new PluginError("INVALID_ARGUMENT", `${argument} requires a value`);
      index += 1;
      return next;
    };
    switch (argument) {
      case "--repo":
        options.repo = value();
        break;
      case "--task":
        options.task = value();
        break;
      case "--task-file":
        options.taskFile = value();
        break;
      case "--task-stdin":
        options.taskStdin = true;
        break;
      case "--dirty":
        options.dirty = value();
        break;
      case "--run-id":
        options.runId = value();
        break;
      case "--contract":
        options.contract = value();
        break;
      case "--format":
        options.format = value();
        break;
      case "--help":
        options.help = true;
        break;
      default:
        throw new PluginError("INVALID_ARGUMENT", `unknown option ${argument}`);
    }
  }
  return options;
}

function readTask(options) {
  const sourceCount =
    Number(options.task !== null) + Number(options.taskFile !== null) + Number(options.taskStdin);
  if (options.action !== "inspect") return null;
  if (sourceCount !== 1)
    throw new PluginError(
      "INVALID_ARGUMENT",
      "inspect requires exactly one of --task, --task-file, or --task-stdin",
    );
  const task = options.taskStdin
    ? readFileSync(0, "utf8")
    : options.taskFile
      ? readFileSync(options.taskFile, "utf8")
      : options.task;
  if (!task || task.trim().length === 0)
    throw new PluginError("INVALID_ARGUMENT", "task must not be empty");
  return task;
}

function runRuntime(runtime, args, input = undefined, env = process.env) {
  const result = spawnSync(runtime, args, {
    cwd: process.cwd(),
    env: { ...env, [REENTRY_ENV]: "1" },
    encoding: "utf8",
    input,
    maxBuffer: 8 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .map(redactOutput)
    .filter(Boolean)
    .join("\n");
  if (result.error?.code === "ENOENT")
    throw new PluginError("RUNTIME_NOT_FOUND", "tripwire runtime could not be started");
  if ((result.status ?? 1) !== 0) {
    const message = output || "tripwire command failed";
    throw new PluginError(
      "RUNTIME_FAILED",
      NESTED_APP_SERVER_REQUEST_FAILURE.test(message)
        ? `${message}\n${CALLER_SANDBOX_HINT}`
        : message,
    );
  }
  return output;
}

export function buildRuntimeArgs(options, taskFile = null, task = null) {
  switch (options.action) {
    case "inspect": {
      const args = ["inspect", "--repo", resolve(options.repo), "--terminal"];
      if (taskFile) args.push("--task-file", taskFile);
      else args.push("--task", task ?? options.task);
      if (options.dirty !== null) args.push("--dirty", options.dirty);
      return args;
    }
    case "status":
      return ["status", options.runId];
    case "review-url":
      return ["review", options.runId];
    case "run":
      return ["run", "--contract", options.contract, "--terminal"];
    case "report":
      return ["report", options.runId, "--format", options.format];
    default:
      throw new PluginError("INVALID_ARGUMENT", `unsupported action ${options.action}`);
  }
}

export async function openReviewUrl(runtime, runId, env = process.env) {
  const tempRoot = mkdtempSync(join(tmpdir(), "prompt-tripwire-review-"));
  const logPath = join(tempRoot, "review.log");
  const logFd = openSync(logPath, "w", 0o600);
  let child;
  try {
    child = spawn(runtime, buildRuntimeArgs({ action: "review-url", runId }), {
      cwd: process.cwd(),
      detached: true,
      env: { ...env, [REENTRY_ENV]: "1" },
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
  } finally {
    closeSync(logFd);
  }
  child.unref();
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const output = readFileSync(logPath, "utf8");
      const match = output.match(/Decision Inbox:\s+(https?:\/\/\S+)/u);
      if (match) return `Decision Inbox: ${redactOutput(match[1])}`;
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 100));
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  if (child.pid !== undefined) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      // The child may already have exited; the actionable error below is enough.
    }
  }
  throw new PluginError("REVIEW_SERVER_FAILED", "Decision Inbox did not start within 10 seconds");
}

export function runPreflight(argv, env = process.env) {
  if (env[REENTRY_ENV] === "1")
    throw new PluginError(
      "REENTRY_BLOCKED",
      "PromptTripwire Plugin re-entry is blocked in this execution thread",
    );
  const options = parseArgs(argv);
  if (options.help)
    return "Usage: run_preflight.mjs inspect|status|review-url|run|report [options]";
  assertSupportedPlatform();
  const runtime = resolveRuntime(env);
  assertRuntimeVersions(runtime, env);
  if (options.action === "inspect") {
    const task = readTask(options);
    return runRuntime(runtime, buildRuntimeArgs(options, null, task), undefined, env);
  }
  if (
    options.action === "status" ||
    options.action === "report" ||
    options.action === "review-url"
  ) {
    if (!options.runId)
      throw new PluginError("INVALID_ARGUMENT", `${options.action} requires --run-id`);
  }
  if (options.action === "run" && !options.contract)
    throw new PluginError("INVALID_ARGUMENT", "run requires --contract");
  if (options.action !== "review-url")
    return runRuntime(runtime, buildRuntimeArgs(options), undefined, env);
  return openReviewUrl(runtime, options.runId, env);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.resolve()
    .then(() => runPreflight(process.argv.slice(2)))
    .then((output) => process.stdout.write(`${output}\n`))
    .catch((error) => {
      const code = error?.code || "PLUGIN_ERROR";
      process.stderr.write(`${code}: ${redactOutput(error?.message || "request failed")}\n`);
      process.exitCode = 1;
    });
}
