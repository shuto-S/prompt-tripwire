import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, posix } from "node:path";

import { canonicalHash } from "@prompt-tripwire/domain";

import { GitSnapshotError } from "./errors.js";
import { runGit } from "./git.js";

export type SnapshotContentMode = "committed_only" | "include_patch";

export const DEFAULT_CONFIG_PATHS = Object.freeze([
  ".prompt-tripwire.json",
  ".prompt-tripwire.yaml",
  ".prompt-tripwire.yml",
  "prompt-tripwire.config.json",
]);

export interface ApprovedFileRecord {
  readonly path: string;
  readonly sha256: string;
  readonly byteCount: number;
}

function contentHash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateRepositoryPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..") ||
    /\0|[\u0001-\u001f\u007f]/u.test(path)
  ) {
    throw new GitSnapshotError(
      "UNSAFE_INSTRUCTION_PATH",
      "hash-approved-files",
      "An instruction or configuration path is not repository-relative POSIX form.",
    );
  }
}

async function committedFile(
  repositoryPath: string,
  commitSha: string,
  path: string,
): Promise<Buffer | null> {
  const tree = await runGit(repositoryPath, ["ls-tree", "-z", commitSha, "--", path]);
  if (tree.stdout.length === 0) return null;
  const metadata = tree.stdout.toString("utf8").split("\t", 1)[0]?.split(" ");
  const mode = metadata?.[0];
  if (mode === "120000") {
    throw new GitSnapshotError(
      "UNSAFE_INSTRUCTION_PATH",
      "hash-approved-files",
      "Symlinked instruction and configuration files are not accepted.",
    );
  }
  if (mode !== "100644" && mode !== "100755") return null;
  return (await runGit(repositoryPath, ["show", `${commitSha}:${path}`])).stdout;
}

async function includedFile(repositoryPath: string, path: string): Promise<Buffer | null> {
  const tracked = await runGit(repositoryPath, ["ls-files", "--error-unmatch", "--", path], {
    allowedExitCodes: [0, 1],
  });
  if (tracked.exitCode !== 0) return null;
  const absolutePath = join(repositoryPath, ...path.split("/"));
  let metadata;
  try {
    metadata = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new GitSnapshotError(
      "UNSAFE_INSTRUCTION_PATH",
      "hash-approved-files",
      "Symlinked instruction and configuration files are not accepted.",
    );
  }
  if (!metadata.isFile()) return null;
  return await readFile(absolutePath);
}

export async function readApprovedFileRecords(
  repositoryPath: string,
  commitSha: string,
  paths: readonly string[],
  mode: SnapshotContentMode,
): Promise<readonly ApprovedFileRecord[]> {
  const records: ApprovedFileRecord[] = [];
  for (const path of [...new Set(paths)].sort()) {
    validateRepositoryPath(path);
    const content =
      mode === "committed_only"
        ? await committedFile(repositoryPath, commitSha, path)
        : await includedFile(repositoryPath, path);
    if (content !== null) {
      records.push({ path, sha256: contentHash(content), byteCount: content.byteLength });
    }
  }
  return records;
}

export function applicableInstructionPaths(workingDirectoryRelative: string): readonly string[] {
  const directories = [""];
  if (workingDirectoryRelative !== ".") {
    const segments = workingDirectoryRelative.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      directories.push(segments.slice(0, index).join("/"));
    }
  }
  return directories.flatMap((directory) =>
    ["AGENTS.md", "AGENTS.override.md"].map((name) =>
      directory.length === 0 ? name : posix.join(directory, name),
    ),
  );
}

export async function instructionHash(
  repositoryPath: string,
  commitSha: string,
  workingDirectoryRelative: string,
  mode: SnapshotContentMode,
  externalInstructionHashes: Readonly<Record<string, string>>,
): Promise<string> {
  const files = await readApprovedFileRecords(
    repositoryPath,
    commitSha,
    applicableInstructionPaths(workingDirectoryRelative),
    mode,
  );
  return canonicalHash({
    files,
    externalInstructionHashes: Object.fromEntries(
      Object.entries(externalInstructionHashes).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  });
}

export async function configurationHash(
  repositoryPath: string,
  commitSha: string,
  mode: SnapshotContentMode,
  paths: readonly string[],
  effectiveConfigHash: string,
): Promise<string> {
  const files = await readApprovedFileRecords(repositoryPath, commitSha, paths, mode);
  return canonicalHash({ files, effectiveConfigHash });
}
