#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const allowedSuites = new Set(["unit", "integration", "e2e"]);
const suites = process.argv.slice(2);
assert(suites.length > 0, "provide at least one suite: unit, integration, or e2e");
for (const suite of suites) assert(allowedSuites.has(suite), `unknown test suite: ${suite}`);

function testFiles(root) {
  const result = [];
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) result.push(...testFiles(path));
    else if (entry.endsWith(".test.mjs")) result.push(path);
  }
  return result;
}

const files = suites.flatMap((suite) => testFiles(resolve("tests", suite)));
assert(files.length > 0, `no tests found for: ${suites.join(", ")}`);

const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...files], {
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
