import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  REENTRY_ENV,
  assertSupportedPlatform,
  buildRuntimeArgs,
  runPreflight,
} from "../../plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs";

test("plugin blocks deterministic re-entry before invoking the runtime", () => {
  assert.throws(
    () => runPreflight(["inspect", "--task", "do not implement"], { [REENTRY_ENV]: "1" }),
    (error) => error.code === "REENTRY_BLOCKED",
  );
});

test("plugin rejects unsupported platforms", () => {
  assert.throws(
    () => assertSupportedPlatform("linux", "x64"),
    (error) => error.code === "UNSUPPORTED_PLATFORM",
  );
});

test("plugin delegates inspect without changing the target repository", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-plugin-test-"));
  const runtime = join(root, "tripwire");
  const codex = join(root, "codex");
  const marker = join(root, "args.txt");
  const fake = `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'prompt-tripwire 0.1.0'
  exit 0
fi
printf '%s' "$*" > "$MARKER"
printf '%s\\n' 'Run: fixture-run'
printf '%s\\n' 'State: needs_review'
printf '%s\\n' 'Snapshot: fixture-snapshot'
printf '%s\\n' 'Contract: not approved'
`;
  const fakeCodex = `#!/bin/sh
printf '%s\\n' 'codex-cli 0.144.4'
`;
  writeFileSync(runtime, fake, { encoding: "utf8", mode: 0o700 });
  writeFileSync(codex, fakeCodex, { encoding: "utf8", mode: 0o700 });
  chmodSync(runtime, 0o700);
  chmodSync(codex, 0o700);
  const before = readFileSync(runtime, "utf8");
  const output = runPreflight(
    ["inspect", "--repo", root, "--task", "inspect this fixture", "--dirty", "committed"],
    {
      ["PROMPT_TRIPWIRE_BIN"]: runtime,
      ["PROMPT_TRIPWIRE_CODEX_BIN"]: codex,
      MARKER: marker,
    },
  );
  assert.match(output, /Run: fixture-run/u);
  assert.match(output, /State: needs_review/u);
  assert.equal(readFileSync(runtime, "utf8"), before);
  assert.match(readFileSync(marker, "utf8"), /inspect --repo/u);
});

test("plugin exposes only non-mutating adapter actions and terminal execution", () => {
  assert.deepEqual(buildRuntimeArgs({ action: "status", runId: "run-1" }), ["status", "run-1"]);
  assert.deepEqual(buildRuntimeArgs({ action: "report", runId: "run-1", format: "json" }), [
    "report",
    "run-1",
    "--format",
    "json",
  ]);
  assert.deepEqual(buildRuntimeArgs({ action: "run", contract: "contract-1" }), [
    "run",
    "--contract",
    "contract-1",
    "--terminal",
  ]);
});
