#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

assert.equal(process.platform, "darwin", "P0 security regression is verified on macOS only");

const root = resolve(".");
const fixturePath = resolve("fixtures/security/secret-redaction.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const secretValues = Object.values(fixture).filter((value) => typeof value === "string");

for (const secret of secretValues) {
  const result = spawnSync("git", ["grep", "-l", "-F", secret, "--", "."], {
    cwd: root,
    encoding: "utf8",
  });
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  const matches = result.stdout.trim().length === 0 ? [] : result.stdout.trim().split("\n");
  const allowed =
    secret === fixture.secretPath
      ? [relative(root, fixturePath), "tests/unit/policy.test.mjs"]
      : [relative(root, fixturePath)];
  assert.deepEqual(matches, allowed, "secret fixture escaped its allowlisted source files");
}

function generatedFiles(path) {
  if (!existsSync(path)) return [];
  const result = [];
  for (const entry of readdirSync(path).sort()) {
    const candidate = join(path, entry);
    if (statSync(candidate).isDirectory()) result.push(...generatedFiles(candidate));
    else result.push(candidate);
  }
  return result;
}

const generated = [
  ...generatedFiles(resolve("apps")),
  ...generatedFiles(resolve("packages")),
].filter((path) => path.includes(`${join("", "dist")}`) || path.includes("web-dist"));
for (const path of generated) {
  const content = readFileSync(path);
  for (const secret of [...secretValues, "synthetic-secret-value"]) {
    assert.equal(
      content.includes(Buffer.from(secret)),
      false,
      `secret-like fixture found in ${path}`,
    );
  }
}

process.stdout.write(
  `macOS secret regression: ${String(generated.length)} generated files passed\n`,
);
