import { DatabaseSync } from "node:sqlite";

import { PersistenceError } from "./errors.js";

const MINIMUM_SQLITE_NODE_MAJOR = 24;
const MINIMUM_SQLITE_NODE_MINOR = 15;

export function assertSupportedSqliteRuntime(version = process.versions.node): void {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  const supported =
    major > MINIMUM_SQLITE_NODE_MAJOR ||
    (major === MINIMUM_SQLITE_NODE_MAJOR && minor >= MINIMUM_SQLITE_NODE_MINOR);
  if (!supported || typeof DatabaseSync !== "function") {
    throw new PersistenceError(
      "SQLITE_RUNTIME_UNSUPPORTED",
      `Node ${String(MINIMUM_SQLITE_NODE_MAJOR)}.${String(MINIMUM_SQLITE_NODE_MINOR)}+ with node:sqlite is required`,
    );
  }
}
