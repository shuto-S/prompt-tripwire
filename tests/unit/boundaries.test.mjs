import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findBoundaryViolations } from "../../scripts/check-boundaries.mjs";

test("domain and policy sources do not import UI, filesystem, network, or process modules", () => {
  assert.deepEqual(findBoundaryViolations(), []);
});

test("boundary checker rejects forbidden imports without rejecting pure crypto", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-boundary-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "src", "bad.ts"),
      [
        'import { readFile } from "node:fs";',
        'import { render } from "@prompt-tripwire/ui";',
        'import { createHash } from "node:crypto";',
        "void readFile; void render; void createHash;",
      ].join("\n"),
    );
    assert.deepEqual(
      findBoundaryViolations([join(root, "src")]).map(({ specifier }) => specifier),
      ["node:fs", "@prompt-tripwire/ui"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
