import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const scenarios = JSON.parse(
  readFileSync(new URL("../../fixtures/repositories/spec-scenarios.json", import.meta.url), "utf8"),
);

test("seven specification fixtures are reproducible through executable acceptance evidence", async (t) => {
  assert.equal(scenarios.length, 7);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 7);
  for (const scenario of scenarios) {
    await t.test(scenario.id, () => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(
        process.execPath,
        [
          "--test",
          "--test-reporter=spec",
          "--test-name-pattern",
          scenario.namePattern,
          scenario.testFile,
        ],
        { encoding: "utf8", timeout: 30_000, env },
      );
      assert.equal(
        result.status,
        0,
        `${scenario.id} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
      assert.match(result.stdout, /ℹ pass [1-9]/u, `${scenario.id} executed no matching test`);
    });
  }
});
