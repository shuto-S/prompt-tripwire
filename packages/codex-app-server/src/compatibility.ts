import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  canonicalHash,
  CodexCompatibilityAttestationSchema,
  type CodexCompatibilityAttestation,
} from "@prompt-tripwire/domain";

import { CodexAppServerClient } from "./client.js";
import {
  canaryProfileFingerprint,
  CODEX_COMPATIBILITY_PROFILE,
  validateGeneratedCompatibilitySchema,
} from "./compatibility-profile.js";
import { AppServerError } from "./errors.js";
import {
  detectedCodexVersion,
  minimalAppServerEnvironment,
  ProcessJsonRpcTransport,
} from "./transport.js";

const SCHEMA_PROBE_TIMEOUT_MS = 30_000;

export interface CodexCompatibilitySession {
  readonly attestation: CodexCompatibilityAttestation;
  readonly client: CodexAppServerClient;
  readonly runtimeRoot: string;
  close(): Promise<void>;
}

export interface CodexCompatibilityVerifierOptions {
  readonly codexPath?: string;
  readonly temporaryParent?: string;
  readonly canaryTimeoutMs?: number;
}

function resolvedExecutable(codexPath: string): string {
  let candidate = codexPath;
  if (!codexPath.includes("/")) {
    const found = spawnSync("/usr/bin/which", [codexPath], {
      cwd: tmpdir(),
      env: minimalAppServerEnvironment(),
      encoding: "utf8",
      timeout: 5_000,
    });
    if (found.status !== 0 || found.stdout.trim().split(/\r?\n/u).length !== 1) {
      throw new AppServerError(
        "CODEX_COMPATIBILITY_FAILED",
        "The Codex executable could not be resolved",
      );
    }
    candidate = found.stdout.trim();
  }
  try {
    const realpath = realpathSync(candidate);
    const metadata = statSync(realpath);
    if (!metadata.isFile()) throw new Error("resolved executable was not a regular file");
    return realpath;
  } catch (error) {
    throw new AppServerError(
      "CODEX_COMPATIBILITY_FAILED",
      "The resolved Codex executable was unavailable",
      { cause: error },
    );
  }
}

function executableDigest(realpath: string): string {
  try {
    return createHash("sha256").update(readFileSync(realpath)).digest("hex");
  } catch (error) {
    throw new AppServerError(
      "CODEX_COMPATIBILITY_FAILED",
      "The resolved Codex executable could not be attested",
      { cause: error },
    );
  }
}

function generateNormalSchema(executable: string, cwd: string, output: string): void {
  const result = spawnSync(executable, ["app-server", "generate-json-schema", "--out", output], {
    cwd,
    env: minimalAppServerEnvironment(),
    encoding: "utf8",
    timeout: SCHEMA_PROBE_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new AppServerError(
      "CODEX_COMPATIBILITY_FAILED",
      "Codex normal-schema generation failed",
      result.error === undefined ? undefined : { cause: result.error },
    );
  }
}

function buildAttestation(input: {
  readonly executableRealpath: string;
  readonly executableSha256: string;
  readonly codexVersion: string;
  readonly schemaFingerprint: string;
}): CodexCompatibilityAttestation {
  const base = {
    ...input,
    profileVersion: CODEX_COMPATIBILITY_PROFILE.profileVersion,
    canaryFingerprint: canaryProfileFingerprint(),
  };
  return CodexCompatibilityAttestationSchema.parse({
    ...base,
    compatibilityFingerprint: canonicalHash(base),
  });
}

export function compatibilityAttestationsEqual(
  expected: CodexCompatibilityAttestation | undefined,
  actual: CodexCompatibilityAttestation,
): boolean {
  return expected !== undefined && canonicalHash(expected) === canonicalHash(actual);
}

export class CodexCompatibilityVerifier {
  constructor(private readonly options: CodexCompatibilityVerifierOptions = {}) {}

  async open(): Promise<CodexCompatibilitySession> {
    const executable = resolvedExecutable(this.options.codexPath ?? "codex");
    const version = detectedCodexVersion(executable);
    const digest = executableDigest(executable);
    const root = await mkdtemp(
      join(this.options.temporaryParent ?? tmpdir(), "prompt-tripwire-compatibility-"),
    );
    let client: CodexAppServerClient | null = null;
    try {
      await chmod(root, 0o700);
      const schemaDirectory = join(root, "normal-schema");
      generateNormalSchema(executable, root, schemaDirectory);
      const { schemaFingerprint } = validateGeneratedCompatibilitySchema(schemaDirectory);

      const shellStartupDirectory = join(root, "zsh-startup");
      await mkdir(shellStartupDirectory, { mode: 0o700 });
      client = new CodexAppServerClient(
        ProcessJsonRpcTransport.start({
          codexPath: executable,
          cwd: root,
          shellStartupDirectory,
        }),
      );
      await client.initialize();
      const models = await client.listModels();
      const canary = CODEX_COMPATIBILITY_PROFILE.canary;
      const model = models.find(
        (candidate) =>
          candidate.id === canary.model &&
          candidate.supportedReasoningEfforts.includes(canary.reasoningEffort),
      );
      if (model === undefined) {
        throw new AppServerError(
          "CODEX_COMPATIBILITY_FAILED",
          "Codex did not expose the required canary model and reasoning effort",
        );
      }
      await client.runCompatibilityCanary({
        cwd: root,
        model: model.id,
        reasoningEffort: canary.reasoningEffort,
        nonce: `pt_canary_${randomUUID()}`,
        ...(this.options.canaryTimeoutMs === undefined
          ? {}
          : { timeoutMs: this.options.canaryTimeoutMs }),
      });
      if (executableDigest(executable) !== digest || detectedCodexVersion(executable) !== version) {
        throw new AppServerError(
          "CODEX_COMPATIBILITY_DRIFT",
          "The resolved Codex executable changed during compatibility verification",
        );
      }
      const attestation = buildAttestation({
        executableRealpath: executable,
        executableSha256: digest,
        codexVersion: version,
        schemaFingerprint,
      });
      let closed = false;
      const sessionClient = client;
      return {
        attestation,
        client: sessionClient,
        runtimeRoot: root,
        async close(): Promise<void> {
          if (closed) return;
          closed = true;
          try {
            await sessionClient.close();
          } finally {
            await rm(root, { recursive: true, force: true });
          }
        },
      };
    } catch (error) {
      try {
        await client?.close();
      } catch {
        // Preserve the compatibility failure; the temporary root is still removed below.
      }
      await rm(root, { recursive: true, force: true });
      if (error instanceof AppServerError && error.code === "CODEX_COMPATIBILITY_DRIFT") {
        throw error;
      }
      throw new AppServerError(
        "CODEX_COMPATIBILITY_FAILED",
        `Codex compatibility verification failed for ${basename(executable)}`,
        { cause: error },
      );
    }
  }
}
