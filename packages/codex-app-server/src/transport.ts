import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";

import { redactText } from "@prompt-tripwire/policy";

import { AppServerError } from "./errors.js";
import type { JsonRpcTransport, JsonRpcTransportClose } from "./types.js";

export const REQUIRED_CODEX_VERSION = "0.144.4";
const MAX_JSON_LINE_BYTES = 2 * 1024 * 1024;
const PLUGIN_REENTRY_ENV = "PROMPT_TRIPWIRE_PLUGIN_REENTRY";

type MessageListener = (message: unknown) => void;
type CloseListener = (event: JsonRpcTransportClose) => void;

function minimalAppServerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = [
    "HOME",
    "LANG",
    "LC_ALL",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TERM",
    "TMPDIR",
    "USER",
  ] as const;
  const result: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    const value = source[name];
    if (value !== undefined) result[name] = value;
  }
  // This non-secret sentinel is the deterministic boundary that prevents a
  // PromptTripwire-launched Codex thread from invoking the Plugin again. Do
  // not broaden this to arbitrary Plugin or caller environment variables.
  if (source[PLUGIN_REENTRY_ENV] === "1") {
    result[PLUGIN_REENTRY_ENV] = "1";
  }
  return result;
}

function isolatedShellStartupDirectory(path: string): string {
  if (/[\0\r\n]/u.test(path)) {
    throw new AppServerError(
      "PROTOCOL_VALIDATION_FAILED",
      "The isolated shell startup directory path was invalid.",
    );
  }
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("symlink shell startup directory");
    const canonical = realpathSync(path);
    const metadata = statSync(canonical);
    if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0) {
      throw new Error("unsafe shell startup directory permissions");
    }
    if (readdirSync(canonical).length !== 0) {
      throw new Error("nonempty shell startup directory");
    }
    return canonical;
  } catch (error) {
    throw new AppServerError(
      "PROTOCOL_VALIDATION_FAILED",
      "The isolated shell startup directory was unavailable.",
      { cause: error },
    );
  }
}

function shellEnvironmentConfig(zDotDir: string, pluginReentry: boolean): string {
  const values = [`ZDOTDIR=${JSON.stringify(zDotDir)}`];
  if (pluginReentry) values.push(`${PLUGIN_REENTRY_ENV}="1"`);
  return `shell_environment_policy.set={${values.join(",")}}`;
}

export function detectedCodexVersion(codexPath = "codex"): string {
  const result = spawnSync(codexPath, ["--version"], {
    encoding: "utf8",
    env: minimalAppServerEnvironment(),
  });
  if (result.status !== 0) {
    throw new AppServerError("CODEX_VERSION_MISMATCH", "Codex version could not be verified");
  }
  const match = result.stdout.trim().match(/^codex-cli\s+(\S+)$/u);
  if (!match?.[1]) {
    throw new AppServerError("CODEX_VERSION_MISMATCH", "Codex version output was invalid");
  }
  return match[1];
}

export function assertCodexVersion(version: string): void {
  if (version !== REQUIRED_CODEX_VERSION) {
    throw new AppServerError(
      "CODEX_VERSION_MISMATCH",
      `Codex ${REQUIRED_CODEX_VERSION} is required; detected ${version}`,
    );
  }
}

export interface ProcessTransportOptions {
  readonly codexPath?: string;
  readonly cwd: string;
  readonly detectedVersion?: () => string;
  readonly shellStartupDirectory: string;
}

export class ProcessJsonRpcTransport implements JsonRpcTransport {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly closeListeners = new Set<CloseListener>();
  private expectedClose = false;
  private closed = false;
  private buffer = "";

  private constructor(process: ChildProcessWithoutNullStreams) {
    this.process = process;
    process.stdout.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      this.receiveChunk(chunk);
    });
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk: string) => {
      redactText(chunk.slice(-2_000));
    });
    process.on("error", () => {
      this.finish({ expected: false, code: "spawn_error" });
    });
    process.on("exit", (code, signal) => {
      this.finish({
        expected: this.expectedClose,
        code: code === 0 ? "exited" : `exit_${String(code ?? signal ?? "unknown")}`,
      });
    });
  }

  static start(options: ProcessTransportOptions): ProcessJsonRpcTransport {
    const codexPath = options.codexPath ?? "codex";
    assertCodexVersion((options.detectedVersion ?? (() => detectedCodexVersion(codexPath)))());
    const environment = minimalAppServerEnvironment();
    const shellEnvironmentArgs = [
      "-c",
      shellEnvironmentConfig(
        isolatedShellStartupDirectory(options.shellStartupDirectory),
        environment[PLUGIN_REENTRY_ENV] === "1",
      ),
    ];
    const child = spawn(
      codexPath,
      [
        "app-server",
        "--stdio",
        "-c",
        "shell_environment_policy.inherit=none",
        ...shellEnvironmentArgs,
        "-c",
        "analytics.enabled=false",
        "-c",
        "mcp_servers={}",
        "--disable",
        "apps",
        "--disable",
        "browser_use",
        "--disable",
        "computer_use",
        "--disable",
        "goals",
        "--disable",
        "hooks",
        "--disable",
        "image_generation",
        "--disable",
        "multi_agent",
        "--disable",
        "plugin_sharing",
        "--disable",
        "remote_plugin",
        "--disable",
        "skill_mcp_dependency_install",
        "--disable",
        "tool_suggest",
        "--disable",
        "workspace_dependencies",
      ],
      {
        cwd: options.cwd,
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return new ProcessJsonRpcTransport(child);
  }

  send(message: unknown): void {
    if (this.closed || this.process.stdin.destroyed) {
      throw new AppServerError("APP_SERVER_DISCONNECTED", "App Server transport is closed");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.expectedClose = true;
    this.process.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.process.exitCode === null) this.process.kill("SIGTERM");
        resolve();
      }, 1_000);
      this.process.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private receiveChunk(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_JSON_LINE_BYTES) {
      this.process.kill("SIGTERM");
      this.finish({ expected: false, code: "json_line_too_large" });
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;
      try {
        const message = JSON.parse(line) as unknown;
        for (const listener of this.messageListeners) listener(message);
      } catch {
        this.process.kill("SIGTERM");
        this.finish({ expected: false, code: "invalid_json" });
        return;
      }
    }
  }

  private finish(event: JsonRpcTransportClose): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener(event);
  }
}

export class MemoryJsonRpcTransport implements JsonRpcTransport {
  private readonly messageListeners = new Set<MessageListener>();
  private readonly closeListeners = new Set<CloseListener>();
  private peer: MemoryJsonRpcTransport | null = null;
  private closed = false;

  connect(peer: MemoryJsonRpcTransport): void {
    if (this.peer !== null) throw new Error("memory transport is already connected");
    this.peer = peer;
  }

  send(message: unknown): void {
    if (this.closed || this.peer === null || this.peer.closed) {
      throw new AppServerError("APP_SERVER_DISCONNECTED", "memory transport is closed");
    }
    const cloned = structuredClone(message);
    queueMicrotask(() => this.peer?.receive(cloned));
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): Promise<void> {
    this.finish({ expected: true, code: "closed" });
    this.peer?.finish({ expected: false, code: "peer_closed" });
    return Promise.resolve();
  }

  disconnect(code = "fixture_disconnect"): void {
    this.finish({ expected: false, code });
    this.peer?.finish({ expected: false, code });
  }

  private receive(message: unknown): void {
    if (this.closed) return;
    for (const listener of this.messageListeners) listener(message);
  }

  private finish(event: JsonRpcTransportClose): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener(event);
  }
}

export function createMemoryTransportPair(): readonly [
  MemoryJsonRpcTransport,
  MemoryJsonRpcTransport,
] {
  const client = new MemoryJsonRpcTransport();
  const server = new MemoryJsonRpcTransport();
  client.connect(server);
  server.connect(client);
  return [client, server];
}
