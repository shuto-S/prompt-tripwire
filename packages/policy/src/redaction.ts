const REDACTED = "[REDACTED]";
const REDACTED_PATH = "[REDACTED_PATH]";

const SECRET_VALUE_PATTERNS = [
  /\bsk-(?:proj-)?[a-z0-9_-]{16,}\b/giu,
  /\bgh[pousr]_[a-z0-9]{20,}\b/giu,
  /\bxox[baprs]-[a-z0-9-]{16,}\b/giu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\b(?:authorization\s*:\s*)?(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}\b/giu,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|private[_-]?key|secret)\s*[:=]\s*["']?[^\s"',;\]}]{4,}["']?/giu,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'@]+@[^\s"']+/giu,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
] as const;

const SECRET_PATH_PATTERNS = [
  /(?<![a-z0-9_-])(?:~\/|\/)?(?:[a-z0-9._-]+\/)*(?:\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.config\/(?:gh|gcloud)|\.docker)\/[a-z0-9._/-]+/giu,
  /(?:^|(?<=[\s"'(]))(?:[a-z0-9._-]+\/)*\.env(?:\.[a-z0-9._-]+)?(?=$|[\s"',)])/gimu,
  /(?:^|(?<=[\s"'(]))(?:[a-z0-9._-]+\/)*(?:\.npmrc|\.pypirc|\.netrc|\.git-credentials)(?=$|[\s"',)])/gimu,
] as const;

const FORBIDDEN_CONTENT_KEY =
  /^(?:chainOfThought|env|environmentVariables|fullEnvironment|processEnv|rawReasoning|reasoning)$/iu;

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_]/gu, "").toLowerCase();
  return (
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "credential" ||
    normalized === "credentials" ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("token")
  );
}

export interface RedactionOptions {
  readonly knownSecrets?: readonly string[];
}

export interface RedactionResult {
  readonly text: string;
  readonly redactionCount: number;
}

function replacePattern(value: string, pattern: RegExp, replacement: string): RedactionResult {
  let redactionCount = 0;
  const text = value.replace(pattern, () => {
    redactionCount += 1;
    return replacement;
  });
  return { text, redactionCount };
}

export function redactText(value: string, options: RedactionOptions = {}): RedactionResult {
  let text = value;
  let redactionCount = 0;
  const knownSecrets = [...new Set(options.knownSecrets ?? [])]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const secret of knownSecrets) {
    const occurrences = text.split(secret).length - 1;
    if (occurrences > 0) {
      text = text.split(secret).join(REDACTED);
      redactionCount += occurrences;
    }
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    const result = replacePattern(text, pattern, REDACTED);
    text = result.text;
    redactionCount += result.redactionCount;
  }
  for (const pattern of SECRET_PATH_PATTERNS) {
    const result = replacePattern(text, pattern, REDACTED_PATH);
    text = result.text;
    redactionCount += result.redactionCount;
  }
  return { text, redactionCount };
}

export function containsSecretLikeText(value: string, options: RedactionOptions = {}): boolean {
  if ((options.knownSecrets ?? []).some((secret) => secret.length > 0 && value.includes(secret))) {
    return true;
  }
  return [...SECRET_VALUE_PATTERNS, ...SECRET_PATH_PATTERNS].some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export type SanitizedValue =
  | null
  | boolean
  | number
  | string
  | readonly SanitizedValue[]
  | { readonly [key: string]: SanitizedValue };

export type SanitizedExportResult =
  | {
      readonly allowed: true;
      readonly value: SanitizedValue;
      readonly json: string;
      readonly redactionCount: number;
    }
  | {
      readonly allowed: false;
      readonly reason: "unsupported_value" | "redaction_verification_failed";
    };

interface SanitizeState {
  readonly options: RedactionOptions;
  readonly stack: WeakSet<object>;
  redactionCount: number;
}

function sanitizeValue(value: unknown, state: SanitizeState): SanitizedValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const redacted = redactText(value, state.options);
    state.redactionCount += redacted.redactionCount;
    return redacted.text;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("unsupported_value");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new TypeError("unsupported_value");
  if (state.stack.has(value)) throw new TypeError("unsupported_value");
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    throw new TypeError("unsupported_value");
  }

  state.stack.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, state));
    const result: Record<string, SanitizedValue> = {};
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      if (isSensitiveKey(key) || FORBIDDEN_CONTENT_KEY.test(key)) {
        result[key] = REDACTED;
        state.redactionCount += 1;
      } else {
        result[key] = sanitizeValue(record[key], state);
      }
    }
    return result;
  } finally {
    state.stack.delete(value);
  }
}

export function sanitizeForExport(
  value: unknown,
  options: RedactionOptions = {},
): SanitizedExportResult {
  const state: SanitizeState = { options, stack: new WeakSet(), redactionCount: 0 };
  try {
    const sanitized = sanitizeValue(value, state);
    const json = JSON.stringify(sanitized);
    if (containsSecretLikeText(json, options)) {
      return { allowed: false, reason: "redaction_verification_failed" };
    }
    return { allowed: true, value: sanitized, json, redactionCount: state.redactionCount };
  } catch {
    return { allowed: false, reason: "unsupported_value" };
  }
}
