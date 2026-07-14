import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("compiled CLI reports its foundation version", () => {
  const result = spawnSync(process.execPath, ["apps/cli/dist/index.js", "--version"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "prompt-tripwire 0.1.0-foundation");
  assert.equal(result.stderr, "");
});
