import { spawn } from "node:child_process";

import { GitSnapshotError } from "./errors.js";

const DEFAULT_OUTPUT_LIMIT = 128 * 1024 * 1024;

export interface GitRunOptions {
  readonly input?: Uint8Array;
  readonly allowedExitCodes?: readonly number[];
  readonly outputLimit?: number;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface GitRunResult {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number;
}

function minimalGitEnvironment(
  overrides: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
  };
  if (process.env.TMPDIR !== undefined) environment.TMPDIR = process.env.TMPDIR;
  return { ...environment, ...overrides };
}

export async function runGit(
  cwd: string,
  args: readonly string[],
  options: GitRunOptions = {},
): Promise<GitRunResult> {
  const allowedExitCodes = options.allowedExitCodes ?? [0];
  const outputLimit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
  return await new Promise<GitRunResult>((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "-c",
        "diff.external=",
        "-c",
        "core.quotepath=false",
        ...args,
      ],
      {
        cwd,
        env: minimalGitEnvironment(options.environment),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(error);
    }

    function collect(target: Buffer[], chunk: Buffer): void {
      outputBytes += chunk.byteLength;
      if (outputBytes > outputLimit) {
        fail(
          new GitSnapshotError(
            "GIT_OUTPUT_LIMIT",
            args[0] ?? "git",
            "Git output exceeded the configured in-memory limit.",
          ),
        );
        return;
      }
      target.push(chunk);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      collect(stdoutChunks, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      collect(stderrChunks, chunk);
    });
    child.on("error", () => {
      fail(
        new GitSnapshotError(
          "GIT_COMMAND_FAILED",
          args[0] ?? "git",
          "Unable to start the Git command.",
        ),
      );
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      const normalizedExitCode = exitCode ?? -1;
      if (!allowedExitCodes.includes(normalizedExitCode)) {
        reject(
          new GitSnapshotError(
            "GIT_COMMAND_FAILED",
            args[0] ?? "git",
            "Git command failed without exposing command output.",
          ),
        );
        return;
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        exitCode: normalizedExitCode,
      });
    });

    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });
}

export function textOutput(result: GitRunResult): string {
  return result.stdout.toString("utf8").replace(/\r\n?/gu, "\n");
}
