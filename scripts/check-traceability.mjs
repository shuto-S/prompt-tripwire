#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function files(root) {
  const result = [];
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) result.push(...files(path));
    else if (entry.endsWith(".test.mjs")) result.push(path);
  }
  return result;
}

const testText = files(resolve("tests"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const specification = readFileSync(resolve("docs/SPECIFICATION.md"), "utf8");

for (let value = 1; value <= 19; value += 1) {
  const id = String(value).padStart(3, "0");
  const direct = testText.includes(`AC-${id}`);
  const grouped = new RegExp(`AC-[0-9]{3}(?:/[0-9]{3})*/${id}(?:\\D|$)`, "u").test(testText);
  assert.equal(direct || grouped, true, `AC-${id} has no executable test evidence`);
}

for (let value = 1; value <= 18; value += 1) {
  const id = String(value).padStart(3, "0");
  assert.match(
    specification,
    new RegExp(`\\| FR-${id} \\| AC-`, "u"),
    `FR-${id} is missing from requirement traceability`,
  );
}

process.stdout.write("P0 traceability: FR-001..018 and AC-001..019 passed\n");
