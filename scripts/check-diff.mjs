#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const diff = spawnSync("git", ["diff", "--exit-code"], { stdio: "inherit" });
assert.equal(diff.status, 0, "tracked files changed during verification");

const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
  encoding: "utf8",
});
assert.equal(status.status, 0, "git status failed");
assert.equal(status.stdout, "", `verification left unexpected files:\n${status.stdout}`);
process.stdout.write("working tree diff check: passed\n");
