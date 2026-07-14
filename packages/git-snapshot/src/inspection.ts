import { realpath } from "node:fs/promises";
import { relative, sep } from "node:path";

import { GitSnapshotError } from "./errors.js";
import { runGit, textOutput } from "./git.js";

export interface RepositoryChange {
  readonly path: string;
  readonly kind: "tracked" | "untracked";
  readonly submoduleState: string | null;
}

export interface RepositoryInspection {
  readonly repositoryPath: string;
  readonly workingDirectory: string;
  readonly workingDirectoryRelative: string;
  readonly commitSha: string;
  readonly branch: string | null;
  readonly submodules: Readonly<Record<string, string>>;
  readonly changes: readonly RepositoryChange[];
  readonly trackedChangeCount: number;
  readonly untrackedFileCount: number;
  readonly isDirty: boolean;
  readonly hasUnrepresentableSubmoduleChange: boolean;
}

function pathAfterSpaces(record: string, spaceCount: number): string {
  let position = -1;
  for (let index = 0; index < spaceCount; index += 1) {
    position = record.indexOf(" ", position + 1);
    if (position < 0) return "";
  }
  return record.slice(position + 1);
}

function submoduleState(record: string): string | null {
  const fields = record.split(" ", 4);
  const value = fields[2];
  return value?.startsWith("S") ? value : null;
}

function changedSubmodule(state: string | null): boolean {
  return state !== null && /[^.]/u.test(state.slice(1));
}

export function parsePorcelainV2(output: Buffer): {
  readonly changes: readonly RepositoryChange[];
  readonly hasUnrepresentableSubmoduleChange: boolean;
} {
  const records = output.toString("utf8").split("\0");
  const changes: RepositoryChange[] = [];
  let hasUnrepresentableSubmoduleChange = false;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.length === 0 || record.startsWith("# ")) continue;
    if (record.startsWith("? ")) {
      changes.push({ path: record.slice(2), kind: "untracked", submoduleState: null });
      continue;
    }
    if (record.startsWith("1 ")) {
      const state = submoduleState(record);
      if (changedSubmodule(state)) hasUnrepresentableSubmoduleChange = true;
      changes.push({ path: pathAfterSpaces(record, 8), kind: "tracked", submoduleState: state });
      continue;
    }
    if (record.startsWith("2 ")) {
      const state = submoduleState(record);
      if (changedSubmodule(state)) hasUnrepresentableSubmoduleChange = true;
      changes.push({ path: pathAfterSpaces(record, 9), kind: "tracked", submoduleState: state });
      index += 1;
      continue;
    }
    if (record.startsWith("u ")) {
      hasUnrepresentableSubmoduleChange = true;
      changes.push({
        path: pathAfterSpaces(record, 10),
        kind: "tracked",
        submoduleState: submoduleState(record),
      });
    }
  }
  return { changes, hasUnrepresentableSubmoduleChange };
}

async function readSubmoduleShas(
  repositoryPath: string,
  commitSha: string,
): Promise<Readonly<Record<string, string>>> {
  const result = await runGit(repositoryPath, ["ls-tree", "-rz", commitSha]);
  const submodules: Record<string, string> = {};
  for (const entry of result.stdout.toString("utf8").split("\0")) {
    if (entry.length === 0) continue;
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const metadata = entry.slice(0, tab).split(" ");
    if (metadata[0] === "160000" && metadata[2] !== undefined) {
      submodules[entry.slice(tab + 1)] = metadata[2];
    }
  }
  return Object.fromEntries(
    Object.entries(submodules).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

export async function inspectRepository(inputPath: string): Promise<RepositoryInspection> {
  let workingDirectory: string;
  try {
    workingDirectory = await realpath(inputPath);
  } catch {
    throw new GitSnapshotError(
      "NOT_A_GIT_REPOSITORY",
      "inspect",
      "The requested repository path does not exist.",
    );
  }

  let repositoryPath: string;
  try {
    const rootResult = await runGit(workingDirectory, ["rev-parse", "--show-toplevel"]);
    repositoryPath = await realpath(textOutput(rootResult).trim());
  } catch {
    throw new GitSnapshotError(
      "NOT_A_GIT_REPOSITORY",
      "inspect",
      "The requested path is not inside a Git repository.",
    );
  }

  const relativeWorkingDirectory = relative(repositoryPath, workingDirectory);
  if (relativeWorkingDirectory === ".." || relativeWorkingDirectory.startsWith(`..${sep}`)) {
    throw new GitSnapshotError(
      "NOT_A_GIT_REPOSITORY",
      "inspect",
      "The canonical working directory is outside the repository root.",
    );
  }

  const [commitResult, branchResult, statusResult] = await Promise.all([
    runGit(repositoryPath, ["rev-parse", "HEAD"]),
    runGit(repositoryPath, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      allowedExitCodes: [0, 1],
    }),
    runGit(repositoryPath, [
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]),
  ]);
  const commitSha = textOutput(commitResult).trim();
  const branch = branchResult.exitCode === 0 ? textOutput(branchResult).trim() : null;
  const status = parsePorcelainV2(statusResult.stdout);
  const trackedChangeCount = status.changes.filter((change) => change.kind === "tracked").length;
  const untrackedFileCount = status.changes.filter((change) => change.kind === "untracked").length;
  const changes = Object.freeze(status.changes.map((change) => Object.freeze({ ...change })));
  return Object.freeze({
    repositoryPath,
    workingDirectory,
    workingDirectoryRelative:
      relativeWorkingDirectory.length === 0 ? "." : toPosix(relativeWorkingDirectory),
    commitSha,
    branch,
    submodules: Object.freeze(await readSubmoduleShas(repositoryPath, commitSha)),
    changes,
    trackedChangeCount,
    untrackedFileCount,
    isDirty: status.changes.length > 0,
    hasUnrepresentableSubmoduleChange: status.hasUnrepresentableSubmoduleChange,
  });
}
