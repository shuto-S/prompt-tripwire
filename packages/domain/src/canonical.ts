import { createHash } from "node:crypto";

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export const DISPLAY_ONLY_KEYS = new Set([
  "approvedAt",
  "approved_at",
  "createdAt",
  "created_at",
  "decidedAt",
  "decided_at",
  "observedAt",
  "observed_at",
  "updatedAt",
  "updated_at",
]);

interface CanonicalOptions {
  readonly omitKeys?: ReadonlySet<string>;
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function normalize(value: unknown, omitKeys: ReadonlySet<string>, path: string): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return typeof value === "string" ? normalizeLineEndings(value) : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalize(item, omitKeys, `${path}[${String(index)}]`));
  }
  if (typeof value === "object") {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`unsupported object prototype at ${path}`);
    }
    const result: Record<string, CanonicalValue> = {};
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      if (omitKeys.has(key)) continue;
      const item = record[key];
      if (item === undefined) throw new TypeError(`undefined value at ${path}.${key}`);
      result[key] = normalize(item, omitKeys, `${path}.${key}`);
    }
    return result;
  }
  throw new TypeError(`unsupported canonical value at ${path}`);
}

export function canonicalJson(value: unknown, options: CanonicalOptions = {}): string {
  return JSON.stringify(normalize(value, options.omitKeys ?? new Set(), "$"));
}

export function sha256(value: string): string {
  return createHash("sha256").update(normalizeLineEndings(value), "utf8").digest("hex");
}

export function canonicalHash(
  value: unknown,
  options: CanonicalOptions = { omitKeys: DISPLAY_ONLY_KEYS },
): string {
  return createHash("sha256").update(canonicalJson(value, options), "utf8").digest("hex");
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
