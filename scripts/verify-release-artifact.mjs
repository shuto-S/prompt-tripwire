#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const archive = resolve(process.argv[2] ?? "artifacts/prompt-tripwire-v0.1.0-macos-arm64.tar.gz");
const sshGitRemotePrefix = ["git", "github.com:"].join("@");
assert.ok(existsSync(archive), `artifact does not exist: ${archive}`);
const checksums = readFileSync(join(dirname(archive), "SHA256SUMS.txt"), "utf8");
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
assert.match(checksums, new RegExp(`^${digest}  ${basename(archive)}$`, "mu"));
const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-release-verify-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

function files(path) {
  const result = [];
  for (const entry of readdirSync(path).sort()) {
    const candidate = join(path, entry);
    if (statSync(candidate).isDirectory()) result.push(...files(candidate));
    else result.push(candidate);
  }
  return result;
}

try {
  run("/usr/bin/tar", ["-xzf", archive, "-C", root]);
  const entries = readdirSync(root);
  assert.equal(entries.length, 1, "archive must contain one top-level directory");
  const distribution = join(root, entries[0]);
  assert.match(
    readFileSync(join(distribution, "LICENSE"), "utf8"),
    /Apache License\s+Version 2\.0, January 2004/u,
  );
  assert.equal(
    JSON.parse(readFileSync(join(distribution, "release-manifest.json"), "utf8")).projectLicense,
    "Apache-2.0 (see LICENSE)",
  );
  assert.match(run(join(distribution, "bin", "tripwire"), ["--version"]), /0\.1\.0/u);
  assert.match(run(join(distribution, "bin", "tripwire"), ["--help"]), /tripwire inspect/u);
  assert.match(
    run(join(distribution, "bin", "tripwire"), ["replay", "--terminal"]),
    /Recorded replay · read-only/u,
  );

  const fixture = join(root, "safe-fixture");
  run(join(distribution, "bin", "create-judge-fixture"), [fixture]);
  assert.match(run("npm", ["test"], { cwd: fixture }), /pass 1/u);
  assert.equal(run("git", ["status", "--short"], { cwd: fixture }), "");

  const installedPrefix = join(root, "installed-prefix");
  const installEnv = { ...process.env, PROMPT_TRIPWIRE_PREFIX: installedPrefix };
  run(join(distribution, "install.sh"), [], { env: installEnv });
  assert.match(run(join(installedPrefix, "bin", "tripwire"), ["--version"]), /0\.1\.0/u);
  assert.match(
    readFileSync(join(installedPrefix, "lib", "prompt-tripwire", "0.1.0", "LICENSE"), "utf8"),
    /Apache License\s+Version 2\.0, January 2004/u,
  );
  run(join(installedPrefix, "lib", "prompt-tripwire", "0.1.0", "uninstall.sh"), [], {
    env: installEnv,
  });
  assert.equal(existsSync(join(installedPrefix, "bin", "tripwire")), false);

  const ownRuntimeRoot = join(distribution, "payload", "node_modules", "@prompt-tripwire");
  for (const path of files(ownRuntimeRoot)) {
    assert.doesNotMatch(path, /(?:\/src\/|\.d\.ts$|\.map$|\.tsbuildinfo$)/u);
  }
  const inspected = files(distribution).filter(
    (path) =>
      !path.includes(`${join("payload", "node_modules", "zod")}`) &&
      !path.includes(`${join("payload", "node_modules", "react")}`) &&
      !path.includes(`${join("payload", "node_modules", "react-dom")}`) &&
      !path.includes(`${join("payload", "node_modules", "scheduler")}`),
  );
  for (const path of inspected) {
    const content = readFileSync(path);
    assert.equal(content.includes(Buffer.from("/Users/")), false, `local path leaked in ${path}`);
    assert.equal(
      content.includes(Buffer.from(sshGitRemotePrefix)),
      false,
      `SSH URL leaked in ${path}`,
    );
    assert.doesNotMatch(
      content.toString("utf8"),
      /sk-[A-Za-z0-9_-]{12,}/u,
      `secret-like value in ${path}`,
    );
  }
  process.stdout.write(
    `release artifact verified: ${basename(archive)} (${String(files(distribution).length)} files)\n`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
