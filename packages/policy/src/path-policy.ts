export const DEFAULT_PROTECTED_PATH_PATTERNS = Object.freeze([
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.cer",
  "**/*.crt",
  "**/*.der",
  "**/id_rsa",
  "**/id_ed25519",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.azure/**",
  "**/.gnupg/**",
  "**/.kube/**",
  "**/.config/gh/**",
  "**/.config/gcloud/**",
  "**/.cargo/credentials*",
  "**/.gem/credentials",
  "**/.git-credentials",
  "**/.npmrc",
  "**/.pypirc",
  "**/.netrc",
  "**/.terraformrc",
  "**/.yarnrc.yml",
  "**/.docker/config.json",
]);

export type PathNormalizationError =
  | "empty_path"
  | "absolute_path"
  | "parent_traversal"
  | "non_posix_path"
  | "unsupported_pattern"
  | "invalid_path";

export type PathNormalizationResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: PathNormalizationError };

export interface NormalizePathOptions {
  readonly allowPattern?: boolean;
}

export function normalizeRepositoryRelativePath(
  value: string,
  options: NormalizePathOptions = {},
): PathNormalizationResult {
  if (value.length === 0) return { ok: false, reason: "empty_path" };
  if (value.length > 4096) return { ok: false, reason: "invalid_path" };
  if (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    /^[a-z]:/iu.test(value) ||
    /^\\\\/u.test(value)
  ) {
    return { ok: false, reason: "absolute_path" };
  }
  if (value.includes("\\")) return { ok: false, reason: "non_posix_path" };
  if (/\0|[\u0001-\u001f\u007f]/u.test(value)) {
    return { ok: false, reason: "invalid_path" };
  }

  const segments = value.split("/");
  if (segments.length > 512) return { ok: false, reason: "invalid_path" };
  if (segments.includes("..")) return { ok: false, reason: "parent_traversal" };
  if (!options.allowPattern && /[*?[\]]/u.test(value)) {
    return { ok: false, reason: "unsupported_pattern" };
  }
  if (options.allowPattern) {
    if (/[?[\]]/u.test(value)) return { ok: false, reason: "unsupported_pattern" };
    if (segments.some((segment) => segment.includes("**") && segment !== "**")) {
      return { ok: false, reason: "unsupported_pattern" };
    }
  }

  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (normalized.length === 0) return { ok: false, reason: "empty_path" };
  return { ok: true, path: normalized };
}

function segmentMatches(value: string, pattern: string): boolean {
  let valueIndex = 0;
  let patternIndex = 0;
  let starIndex = -1;
  let starValueIndex = -1;

  while (valueIndex < value.length) {
    if (patternIndex < pattern.length && pattern[patternIndex] === value[valueIndex]) {
      valueIndex += 1;
      patternIndex += 1;
      continue;
    }
    if (patternIndex < pattern.length && pattern[patternIndex] === "*") {
      starIndex = patternIndex;
      starValueIndex = valueIndex;
      patternIndex += 1;
      continue;
    }
    if (starIndex >= 0) {
      patternIndex = starIndex + 1;
      starValueIndex += 1;
      valueIndex = starValueIndex;
      continue;
    }
    return false;
  }
  while (patternIndex < pattern.length && pattern[patternIndex] === "*") patternIndex += 1;
  return patternIndex === pattern.length;
}

function matchSegments(
  pathSegments: readonly string[],
  patternSegments: readonly string[],
  pathIndex = 0,
  patternIndex = 0,
  memo: Map<string, boolean> = new Map(),
): boolean {
  const memoKey = `${String(pathIndex)}:${String(patternIndex)}`;
  const cached = memo.get(memoKey);
  if (cached !== undefined) return cached;
  if (patternIndex === patternSegments.length) {
    const result = pathIndex === pathSegments.length;
    memo.set(memoKey, result);
    return result;
  }
  const pattern = patternSegments[patternIndex];
  if (pattern === "**") {
    const result =
      matchSegments(pathSegments, patternSegments, pathIndex, patternIndex + 1, memo) ||
      (pathIndex < pathSegments.length &&
        matchSegments(pathSegments, patternSegments, pathIndex + 1, patternIndex, memo));
    memo.set(memoKey, result);
    return result;
  }
  const result =
    pathIndex < pathSegments.length &&
    pattern !== undefined &&
    segmentMatches(pathSegments[pathIndex] ?? "", pattern) &&
    matchSegments(pathSegments, patternSegments, pathIndex + 1, patternIndex + 1, memo);
  memo.set(memoKey, result);
  return result;
}

export function matchesRepositoryPath(path: string, pattern: string): boolean {
  const normalizedPath = normalizeRepositoryRelativePath(path);
  const normalizedPattern = normalizeRepositoryRelativePath(pattern, { allowPattern: true });
  if (!normalizedPath.ok || !normalizedPattern.ok) return false;
  return matchSegments(normalizedPath.path.split("/"), normalizedPattern.path.split("/"));
}

export interface PathRequest {
  readonly requestedPath: string;
  readonly resolvedPath: string | null;
  readonly caseAmbiguous: boolean;
}

export interface PathContract {
  readonly allowedPaths: readonly string[];
  readonly protectedPaths: readonly string[];
}

export type PathMatchReason =
  | PathNormalizationError
  | "case_ambiguity"
  | "unresolved_path"
  | "invalid_contract_pattern"
  | "protected_path"
  | "outside_allowed_paths"
  | "allowed_path";

export interface PathMatchResult {
  readonly outcome: "allow" | "deny";
  readonly reason: PathMatchReason;
  readonly normalizedPath: string | null;
}

export function matchPathRequest(request: PathRequest, contract: PathContract): PathMatchResult {
  if (request.caseAmbiguous) {
    return { outcome: "deny", reason: "case_ambiguity", normalizedPath: null };
  }
  const requested = normalizeRepositoryRelativePath(request.requestedPath);
  if (!requested.ok) {
    return { outcome: "deny", reason: requested.reason, normalizedPath: null };
  }
  if (request.resolvedPath === null) {
    return { outcome: "deny", reason: "unresolved_path", normalizedPath: null };
  }
  const resolved = normalizeRepositoryRelativePath(request.resolvedPath);
  if (!resolved.ok) {
    return { outcome: "deny", reason: resolved.reason, normalizedPath: null };
  }

  const protectedPatterns = [...DEFAULT_PROTECTED_PATH_PATTERNS, ...contract.protectedPaths];
  const allPatterns = [...protectedPatterns, ...contract.allowedPaths];
  if (
    allPatterns.some(
      (pattern) => !normalizeRepositoryRelativePath(pattern, { allowPattern: true }).ok,
    )
  ) {
    return {
      outcome: "deny",
      reason: "invalid_contract_pattern",
      normalizedPath: resolved.path,
    };
  }
  if (
    protectedPatterns.some(
      (pattern) =>
        matchesRepositoryPath(requested.path, pattern) ||
        matchesRepositoryPath(resolved.path, pattern),
    )
  ) {
    return { outcome: "deny", reason: "protected_path", normalizedPath: resolved.path };
  }
  if (!contract.allowedPaths.some((pattern) => matchesRepositoryPath(resolved.path, pattern))) {
    return {
      outcome: "deny",
      reason: "outside_allowed_paths",
      normalizedPath: resolved.path,
    };
  }
  return { outcome: "allow", reason: "allowed_path", normalizedPath: resolved.path };
}

export function isSecretLikePath(path: string): boolean {
  const normalized = normalizeRepositoryRelativePath(path);
  return (
    normalized.ok &&
    DEFAULT_PROTECTED_PATH_PATTERNS.some((pattern) =>
      matchesRepositoryPath(normalized.path, pattern),
    )
  );
}
