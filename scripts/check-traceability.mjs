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

const testSources = files(resolve("tests")).map((path) => readFileSync(path, "utf8"));
const testTitles = testSources.flatMap((source) =>
  [...source.matchAll(/\btest(?:\.only)?\(\s*(["'`])([\s\S]*?)\1/gu)].map(
    (match) => match[2] ?? "",
  ),
);
const testTitleText = testTitles.join("\n");
const specification = readFileSync(resolve("docs/SPECIFICATION.md"), "utf8");

for (let value = 1; value <= 19; value += 1) {
  const id = String(value).padStart(3, "0");
  const direct = testTitleText.includes(`AC-${id}`);
  const grouped = new RegExp(`AC-[0-9]{3}(?:/[0-9]{3})*/${id}(?:\\D|$)`, "u").test(testTitleText);
  assert.equal(direct || grouped, true, `AC-${id} has no executable test evidence`);
}

for (let value = 1; value <= 18; value += 1) {
  const id = String(value).padStart(3, "0");
  const row = specification.match(new RegExp(`^\\| FR-${id} \\| ([^|]+)\\|$`, "mu"));
  assert.ok(row?.[1], `FR-${id} is missing from requirement traceability`);
  const acceptanceIds = [...row[1].matchAll(/AC-([0-9]{3})/gu)].map((match) => match[1]);
  assert.ok(acceptanceIds.length > 0, `FR-${id} has no acceptance evidence`);
  assert.equal(
    acceptanceIds.every((acceptanceId) => {
      const numeric = Number(acceptanceId);
      return numeric >= 1 && numeric <= 19;
    }),
    true,
    `FR-${id} references an unknown acceptance criterion`,
  );
}

process.stdout.write("P0 traceability: FR-001..018 and AC-001..019 passed\n");
