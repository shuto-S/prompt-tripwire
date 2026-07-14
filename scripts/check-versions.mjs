#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const MINIMUM_NODE_MAJOR = 24;
const MINIMUM_NPM_MAJOR = 11;
const REQUIRED_CODEX_VERSION = "0.144.4";

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
  return result.stdout.trim();
}

const nodeVersion = process.versions.node;
const npmVersion = commandOutput("npm", ["--version"]);
const codexOutput = commandOutput("codex", ["--version"]);
const codexMatch = codexOutput.match(/codex-cli\s+(\S+)/u);
assert(codexMatch, `unexpected codex version output: ${codexOutput}`);

assert(
  Number.parseInt(nodeVersion, 10) >= MINIMUM_NODE_MAJOR,
  `Node ${MINIMUM_NODE_MAJOR}+ required, detected ${nodeVersion}`,
);
assert(
  Number.parseInt(npmVersion, 10) >= MINIMUM_NPM_MAJOR,
  `npm ${MINIMUM_NPM_MAJOR}+ required, detected ${npmVersion}`,
);
assert.equal(
  codexMatch[1],
  REQUIRED_CODEX_VERSION,
  `Codex ${REQUIRED_CODEX_VERSION} required, detected ${codexMatch[1]}`,
);

process.stdout.write(
  `${JSON.stringify({ node: nodeVersion, npm: npmVersion, codex: codexMatch[1] })}\n`,
);
