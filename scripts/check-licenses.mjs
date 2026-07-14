#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8"));
const packages = Object.entries(lockfile.packages ?? {}).filter(
  ([path, metadata]) => path.startsWith("node_modules/") && metadata.link !== true,
);
assert(packages.length > 0, "package-lock.json contains no installed dependency metadata");

const missing = [];
const prohibited = [];
const licenseCounts = new Map();
for (const [path, metadata] of packages) {
  const license = metadata.license;
  if (typeof license !== "string" || license.length === 0) {
    missing.push(path);
    continue;
  }
  licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
  if (/\b(?:AGPL|GPL|SSPL)(?:-|\b)/iu.test(license)) prohibited.push({ path, license });
}

assert.deepEqual(missing, [], `dependencies missing license metadata: ${missing.join(", ")}`);
assert.deepEqual(prohibited, [], `prohibited dependency licenses: ${JSON.stringify(prohibited)}`);
process.stdout.write(
  `${JSON.stringify(Object.fromEntries([...licenseCounts.entries()].sort()), null, 2)}\n`,
);
