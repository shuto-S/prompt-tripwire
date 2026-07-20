#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { submissionMetadataViolations } from "./submission-metadata.mjs";

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
const slackApiTokenPattern = /xox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}/gu;
const patterns = [
  { name: "absolute macOS user path", regex: /\/Users\/[A-Za-z0-9._-]+\//gu },
  { name: "SSH Git remote", regex: /git@github\.com:/gu },
  { name: "OpenAI-style secret", regex: /sk-[A-Za-z0-9_-]{20,}/gu },
  { name: "Slack API token", regex: slackApiTokenPattern },
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/gu },
  {
    name: "private key block",
    regex: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/gu,
  },
  { name: "Codex thread URI", regex: /codex:\/\/threads\//gu },
  {
    name: "Codex Session ID value",
    regex:
      /(?:Codex\s+\/feedback\s+)?Session ID[^\r\n]{0,80}\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
  },
];
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const packageMetadata = JSON.parse(readFileSync("package.json", "utf8"));
const judgeFacingDocuments = [
  "README.md",
  "docs/BUILD_WEEK.md",
  "docs/BUILD_WEEK_REQUIREMENTS_MATRIX.md",
  "docs/DEVPOST_SUBMISSION.md",
  "docs/JUDGE_GUIDE.md",
  "docs/demo/README.md",
];
const sourcePreviewManifestPath = "docs/demo/issue-43-source-preview.json";

assert.equal(typeof packageMetadata.version, "string", "package version is required");
assert.equal(
  typeof packageMetadata.promptTripwire?.demoCaptureVersion,
  "string",
  "demo capture version is required",
);
assert.notEqual(
  packageMetadata.version,
  packageMetadata.promptTripwire.demoCaptureVersion,
  "recorded demo and judge distribution must remain explicitly distinct",
);

assert.equal(
  slackApiTokenPattern.test(["xoxb", "1234567890", "abcdefghijklmnop"].join("-")),
  true,
  "Slack token pattern self-test failed",
);
slackApiTokenPattern.lastIndex = 0;

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
for (const path of judgeFacingDocuments) {
  violations.push(
    ...submissionMetadataViolations({
      content: readFileSync(path, "utf8"),
      demoCaptureVersion: packageMetadata.promptTripwire.demoCaptureVersion,
      distributionVersion: packageMetadata.version,
      path,
    }),
  );
}

const sourcePreviewManifest = JSON.parse(readFileSync(sourcePreviewManifestPath, "utf8"));
const sourcePreviewEntries = [
  sourcePreviewManifest.video,
  ...sourcePreviewManifest.screenshots,
  sourcePreviewManifest.thumbnail,
];
for (const entry of sourcePreviewEntries) {
  const relativePath = normalize(join(dirname(sourcePreviewManifestPath), entry.path));
  if (!relativePath.startsWith("docs/assets/demo/")) {
    violations.push(`${sourcePreviewManifestPath}: source preview path escapes media root`);
    continue;
  }
  const bytes = readFileSync(relativePath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== entry.sha256) {
    violations.push(`${relativePath}: source preview digest does not match manifest`);
  }
  if (entry === sourcePreviewManifest.video && bytes.byteLength !== entry.sizeBytes) {
    violations.push(`${relativePath}: source preview size does not match manifest`);
  }
}

// Review every revision that can ship from the current branch, a tag, or a
// fetched remote ref. Unpublished sibling scratch branches are not submission
// content and must not make an otherwise clean release checkout non-reproducible.
const revisions = command(["rev-list", "HEAD", "--tags", "--remotes"]).split("\n").filter(Boolean);
for (const revision of revisions) {
  const paths = command(["ls-tree", "-r", "--name-only", "-z", revision])
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    const result = spawnSync("git", ["show", `${revision}:${path}`], {
      encoding: "buffer",
      // Owned demo media is committed for review and may exceed Node's small
      // child-process default. Keep the history scanner's bound aligned with
      // the git inventory helper, then skip binary blobs before text scanning.
      maxBuffer: 64 * 1024 * 1024,
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
