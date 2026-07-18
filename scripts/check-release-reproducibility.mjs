#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const version = String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
const archive = join(root, "artifacts", `prompt-tripwire-v${version}-macos-arm64.tar.gz`);
const maxArchiveBytes = 8 * 1024 * 1024;
const releaseTag =
  process.env.GITHUB_REF_TYPE === "tag"
    ? process.env.GITHUB_REF_NAME
    : process.env.PROMPT_TRIPWIRE_RELEASE_TAG;
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.ok(releaseTag, "GITHUB_REF_NAME is required for tag release verification");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

function buildResult() {
  run(process.execPath, ["scripts/clean.mjs"]);
  run("npm", ["run", "package:macos-arm64"]);
  return {
    digest: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    entries: run("/usr/bin/tar", ["-tzf", archive]).trim().split("\n").filter(Boolean),
  };
}

const firstBuild = buildResult();
const secondBuild = buildResult();
assert.equal(
  secondBuild.digest,
  firstBuild.digest,
  "identical source inputs must create the same archive digest",
);
assert.deepEqual(
  secondBuild.entries,
  firstBuild.entries,
  "identical source inputs must create the same archive entry order",
);

const entries = secondBuild.entries;
assert.ok(entries.length > 0, "release archive must not be empty");
assert.equal(
  new Set(entries).size,
  entries.length,
  "release archive must not contain duplicate entries",
);
const forbiddenEntries = entries.filter(
  (entry) =>
    /\/(?:docs\/assets|docs\/demo)(?:\/|$)/u.test(entry) ||
    /\.(?:aiff|m4v|mov|mp4|srt)$/iu.test(entry),
);
assert.deepEqual(forbiddenEntries, [], "release archive must exclude demo media and intermediates");

const verboseEntries = run("/usr/bin/tar", ["-tvzf", archive], {
  env: { ...process.env, LC_ALL: "C" },
})
  .trim()
  .split("\n")
  .filter(Boolean);
assert.equal(verboseEntries.length, entries.length);
for (const entry of verboseEntries) {
  assert.match(
    entry,
    /^(?:drwxr-xr-x|-rwxr-xr-x|-rw-r--r--)\s+0\s+root\s+root\s+/u,
    `archive ownership or mode is not normalized: ${entry}`,
  );
}
const archiveTimestamps = new Set(
  verboseEntries.map((entry) => entry.trim().split(/\s+/u).slice(5, 8).join(" ")),
);
assert.equal(archiveTimestamps.size, 1, "release archive entries must use one fixed mtime");

const artifactName = `prompt-tripwire-v${version}-macos-arm64`;
const manifest = JSON.parse(
  run("/usr/bin/tar", ["-xOzf", archive, `${artifactName}/release-manifest.json`]),
);
assert.equal(manifest.version, version);
assert.equal(manifest.sourceCommit, run("git", ["rev-parse", "HEAD"]).trim());
const sourceDirty = run("git", ["status", "--porcelain=v1", "--untracked-files=normal"])
  .split("\n")
  .some(Boolean);
assert.equal(manifest.sourceDirty, sourceDirty);
const expectedEpoch = Number(
  process.env.SOURCE_DATE_EPOCH ?? run("git", ["show", "-s", "--format=%ct", "HEAD"]).trim(),
);
assert.ok(
  Number.isSafeInteger(expectedEpoch) && expectedEpoch >= 0,
  "SOURCE_DATE_EPOCH must be a non-negative integer",
);
assert.equal(manifest.sourceDateEpoch, expectedEpoch);
assert.equal(manifest.releaseTag, releaseTag ?? null);
if (releaseTag !== undefined) {
  assert.equal(releaseTag, `v${version}`);
  assert.equal(manifest.sourceDirty, false);
  assert.equal(
    run("git", ["rev-parse", `refs/tags/${releaseTag}^{commit}`]).trim(),
    manifest.sourceCommit,
  );
  assert.equal(
    manifest.sourceDateEpoch,
    Number(run("git", ["show", "-s", "--format=%ct", "HEAD"]).trim()),
  );
}
assert.equal(manifest.archiveFormat, "ustar+gzip");
assert.equal(manifest.maximumArchiveBytes, maxArchiveBytes);

const archiveBytes = statSync(archive).size;
assert.ok(
  archiveBytes <= maxArchiveBytes,
  `${basename(archive)} exceeds ${String(maxArchiveBytes)} bytes`,
);
process.stdout.write(
  `release reproducibility: ${firstBuild.digest} (${String(archiveBytes)} bytes, ${String(entries.length)} entries)\n`,
);
