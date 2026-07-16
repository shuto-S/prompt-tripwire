#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowedSecretPaths = new Set([
  "fixtures/security/secret-redaction.json",
  "tests/unit/policy.test.mjs",
]);
const allowedEmails = new Set([
  "build-week-event@openai.com",
  "fixture@example.invalid",
  "fixture@example.test",
  "support@devpost.com",
  "test@example.invalid",
  "testing@devpost.com",
]);
const patterns = [
  { name: "absolute macOS user path", regex: /\/Users\/[A-Za-z0-9._-]+\//gu },
  { name: "SSH Git remote", regex: /git@github\.com:/gu },
  { name: "OpenAI-style secret", regex: /sk-[A-Za-z0-9_-]{20,}/gu },
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/gu },
  {
    name: "private key block",
    regex: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/gu,
  },
];
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;

function command(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function allowedPattern(path, name) {
  return (
    allowedSecretPaths.has(path) && ["OpenAI-style secret", "private key block"].includes(name)
  );
}

function scan(path, content, revision) {
  const violations = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(content) && !allowedPattern(path, pattern.name)) {
      violations.push(`${revision}:${path}: ${pattern.name}`);
    }
  }
  emailPattern.lastIndex = 0;
  for (const match of content.matchAll(emailPattern)) {
    if (!allowedEmails.has(match[0].toLowerCase())) {
      violations.push(`${revision}:${path}: unreviewed email address`);
    }
  }
  return violations;
}

const currentFiles = command(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  .split("\0")
  .filter(Boolean);
const violations = [];
for (const path of currentFiles) {
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue;
  violations.push(...scan(path, bytes.toString("utf8"), "working-tree"));
}

const revisions = command(["rev-list", "--all"]).split("\n").filter(Boolean);
for (const revision of revisions) {
  const paths = command(["ls-tree", "-r", "--name-only", "-z", revision])
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    const result = spawnSync("git", ["show", `${revision}:${path}`], {
      encoding: "buffer",
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `could not inspect ${revision}:${path}`);
    if (result.stdout.includes(0)) continue;
    violations.push(...scan(path, result.stdout.toString("utf8"), revision.slice(0, 12)));
  }
}

assert.deepEqual(violations, [], `submission content review failed:\n${violations.join("\n")}`);
process.stdout.write(
  `submission content: ${String(currentFiles.length)} current files and ${String(revisions.length)} revisions passed\n`,
);
