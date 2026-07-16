import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("compiled CLI reports its version and complete command surface", () => {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", "--version"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "prompt-tripwire 0.1.1");
  assert.equal(result.stderr, "");

  const help = spawnSync(process.execPath, ["apps/cli/dist/index.js", "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  for (const command of [
    "inspect",
    "replay",
    "review",
    "approve",
    "run",
    "status",
    "report",
    "cancel",
    "export",
    "archive",
    "unarchive",
    "delete",
    "purge-expired",
  ]) {
    assert.match(help.stdout, new RegExp(`\\b${command}\\b`, "u"));
  }
});

test("compiled CLI starts through a symlinked or canonicalized entry path", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-cli-entry-"));
  const entry = join(root, "tripwire.mjs");
  try {
    symlinkSync(resolve("apps/cli/dist/index.js"), entry);
    const result = spawnSync(process.execPath, [entry, "--version"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "prompt-tripwire 0.1.1");
    assert.equal(realpathSync(entry), resolve("apps/cli/dist/index.js"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
