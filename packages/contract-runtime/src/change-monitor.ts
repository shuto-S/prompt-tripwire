import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { inspectRepository, type RepositoryChange } from "@prompt-tripwire/git-snapshot";
import {
  matchPathRequest,
  normalizeRepositoryRelativePath,
  type PathMatchResult,
} from "@prompt-tripwire/policy";

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

function contained(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

function entryDigest(root: string, path: string): string {
  const candidate = resolve(root, ...path.split("/"));
  if (!existsSync(candidate)) return "missing";
  const metadata = lstatSync(candidate);
  const digest = createHash("sha256");
  digest.update(String(metadata.mode & 0o7777));
  if (metadata.isSymbolicLink()) {
    digest.update("symlink\0");
    digest.update(readlinkSync(candidate, "utf8"));
  } else if (metadata.isFile()) {
    digest.update("file\0");
    digest.update(readFileSync(candidate));
  } else if (metadata.isDirectory()) {
    digest.update("directory\0");
  } else {
    digest.update("unsupported\0");
  }
  return digest.digest("hex");
}

export interface ResolvedRepositoryPath {
  readonly requestedPath: string;
  readonly resolvedPath: string | null;
  readonly caseAmbiguous: boolean;
}

export class ExecutionChangeMonitor {
  private readonly root: string;
  private readonly allowedPaths: readonly string[];
  private readonly protectedPaths: readonly string[];
  private readonly baseline = new Map<string, string>();

  constructor(input: {
    readonly root: string;
    readonly baselineChanges: readonly RepositoryChange[];
    readonly allowedPaths: readonly string[];
    readonly protectedPaths: readonly string[];
  }) {
    this.root = realpathSync(input.root);
    this.allowedPaths = [...input.allowedPaths];
    this.protectedPaths = [".git", ".git/**", ...input.protectedPaths];
    for (const change of input.baselineChanges) {
      this.baseline.set(change.path, entryDigest(this.root, change.path));
    }
  }

  resolvePath(value: string): ResolvedRepositoryPath {
    const candidate = isAbsolute(value) ? resolve(value) : resolve(this.root, value);
    if (!contained(this.root, candidate)) {
      return { requestedPath: value, resolvedPath: null, caseAmbiguous: false };
    }
    const requestedPath = toPosix(relative(this.root, candidate));
    const normalized = normalizeRepositoryRelativePath(requestedPath);
    if (!normalized.ok) {
      return { requestedPath, resolvedPath: null, caseAmbiguous: false };
    }

    let existing = candidate;
    const suffix: string[] = [];
    while (!existsSync(existing) && existing !== this.root) {
      suffix.unshift(relative(dirname(existing), existing));
      existing = dirname(existing);
    }
    if (!existsSync(existing)) {
      return { requestedPath: normalized.path, resolvedPath: null, caseAmbiguous: false };
    }
    const canonicalExisting = realpathSync(existing);
    const canonical = resolve(canonicalExisting, ...suffix);
    if (!contained(this.root, canonical)) {
      return { requestedPath: normalized.path, resolvedPath: null, caseAmbiguous: false };
    }
    const resolvedPath = toPosix(relative(this.root, canonical));
    const caseAmbiguous =
      candidate !== canonical && candidate.toLowerCase() === canonical.toLowerCase();
    return { requestedPath: normalized.path, resolvedPath, caseAmbiguous };
  }

  matchWritePath(value: string): PathMatchResult {
    return matchPathRequest(this.resolvePath(value), {
      allowedPaths: this.allowedPaths,
      protectedPaths: this.protectedPaths,
    });
  }

  matchReadPath(value: string): PathMatchResult {
    const candidate = isAbsolute(value) ? resolve(value) : resolve(this.root, value);
    if (candidate === this.root) {
      return { outcome: "allow", reason: "allowed_path", normalizedPath: null };
    }
    return matchPathRequest(this.resolvePath(value), {
      allowedPaths: ["**"],
      protectedPaths: this.protectedPaths,
    });
  }

  async changedPaths(): Promise<readonly string[]> {
    const current = await inspectRepository(this.root);
    const currentPaths = new Set(current.changes.map((change) => change.path));
    const candidates = new Set([...this.baseline.keys(), ...currentPaths]);
    const changed: string[] = [];
    for (const path of candidates) {
      const before = this.baseline.get(path);
      const after = entryDigest(this.root, path);
      if (before === undefined || before !== after) changed.push(path);
    }
    return changed.sort((left, right) => left.localeCompare(right));
  }
}
