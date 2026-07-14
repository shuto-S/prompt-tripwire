#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const checks = [
  "format:check",
  "lint",
  "typecheck",
  "build",
  "test:unit",
  "test:integration",
  "test:e2e",
  "check:boundaries",
  "check:versions",
  "check:schema",
  "check:licenses",
  "check:security",
  "check:traceability",
];

for (const check of checks) {
  const result = spawnSync("npm", ["run", check], { stdio: "inherit" });
  assert.equal(result.status, 0, `npm run ${check} failed`);
}
