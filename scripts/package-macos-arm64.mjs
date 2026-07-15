#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = String(packageJson.version);
const artifactName = `prompt-tripwire-v${version}-macos-arm64`;
const artifactsRoot = join(root, "artifacts");
const stagingRoot = join(artifactsRoot, artifactName);
const archivePath = join(artifactsRoot, `${artifactName}.tar.gz`);
const tarPath = join(artifactsRoot, `${artifactName}.tar`);
const checksumsPath = join(artifactsRoot, "SHA256SUMS.txt");

assert.equal(process.platform, "darwin", "the release artifact is verified for macOS only");
assert.equal(process.arch, "arm64", "the release artifact is verified for arm64 only");
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
assert.ok(
  nodeMajor > 24 || (nodeMajor === 24 && nodeMinor >= 15),
  "Node.js 24.15 or newer is required",
);

rmSync(stagingRoot, { recursive: true, force: true });
rmSync(archivePath, { force: true });
rmSync(tarPath, { force: true });
mkdirSync(stagingRoot, { recursive: true, mode: 0o755 });

function copyFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}

function copyRuntimePackage(sourceRelative, packageName, includeWeb = false) {
  const source = join(root, sourceRelative);
  const destination = join(stagingRoot, "payload", "node_modules", "@prompt-tripwire", packageName);
  copyFile(join(source, "package.json"), join(destination, "package.json"));
  cpSync(join(source, "dist"), join(destination, "dist"), {
    recursive: true,
    filter: (candidate) => {
      if (statSync(candidate).isDirectory()) return true;
      return candidate.endsWith(".js");
    },
  });
  if (includeWeb) {
    cpSync(join(source, "web-dist"), join(destination, "web-dist"), { recursive: true });
  }
}

const workspaces = [
  ["apps/cli", "cli", false],
  ["apps/controller", "controller", false],
  ["apps/ui", "ui", true],
  ["packages/codex-app-server", "codex-app-server", false],
  ["packages/contract-runtime", "contract-runtime", false],
  ["packages/domain", "domain", false],
  ["packages/git-snapshot", "git-snapshot", false],
  ["packages/openai-comparator", "openai-comparator", false],
  ["packages/persistence", "persistence", false],
  ["packages/policy", "policy", false],
  ["packages/schemas", "schemas", false],
];
for (const [source, name, includeWeb] of workspaces) {
  copyRuntimePackage(source, name, includeWeb);
}

for (const dependency of ["zod", "react", "react-dom", "scheduler"]) {
  const source = join(root, "node_modules", dependency);
  assert.ok(existsSync(source), `runtime dependency is missing: ${dependency}`);
  cpSync(source, join(stagingRoot, "payload", "node_modules", dependency), { recursive: true });
}

copyFile(join(root, "fixtures", "judge-safe-task.md"), join(stagingRoot, "judge", "task.md"));
cpSync(
  join(root, "fixtures", "judge-safe-repository"),
  join(stagingRoot, "judge", "fixture-template"),
  { recursive: true },
);
for (const [source, destination] of [
  ["README.md", "README.md"],
  ["docs/JUDGE_GUIDE.md", "JUDGE_GUIDE.md"],
  ["docs/SECURITY.md", "SECURITY.md"],
  ["docs/DEPENDENCIES.md", "THIRD_PARTY_NOTICES.md"],
  ["docs/RELEASE_NOTES_v0.1.0.md", "RELEASE_NOTES.md"],
]) {
  copyFile(join(root, source), join(stagingRoot, destination));
}
cpSync(join(root, "docs"), join(stagingRoot, "docs"), { recursive: true });
copyFile(join(root, "LICENSE"), join(stagingRoot, "LICENSE"));
copyFile(
  join(root, ".agents", "plugins", "marketplace.json"),
  join(stagingRoot, ".agents", "plugins", "marketplace.json"),
);
for (const relativePath of [
  ".codex-plugin/plugin.json",
  "skills/preflight/SKILL.md",
  "skills/preflight/scripts/run_preflight.mjs",
]) {
  copyFile(
    join(root, "plugins", "prompt-tripwire", relativePath),
    join(stagingRoot, "plugins", "prompt-tripwire", relativePath),
  );
}

const resolveRoot = `SCRIPT="$0"
while [ -L "$SCRIPT" ]; do
  SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SCRIPT")" && pwd)
  TARGET=$(readlink "$SCRIPT")
  case "$TARGET" in
    /*) SCRIPT="$TARGET" ;;
    *) SCRIPT="$SCRIPT_DIR/$TARGET" ;;
  esac
done
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SCRIPT")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)`;

function writeExecutable(path, content) {
  writeFileSync(path, content, { mode: 0o755 });
  chmodSync(path, 0o755);
}

mkdirSync(join(stagingRoot, "bin"), { recursive: true });
writeExecutable(
  join(stagingRoot, "bin", "tripwire"),
  `#!/bin/sh
set -eu
${resolveRoot}
if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "PromptTripwire v${version} supports macOS arm64 only." >&2
  exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(!(a>24||(a===24&&b>=15)))process.exit(1)' || {
  echo "Node.js 24.15 or newer is required." >&2
  exit 1
}
exec node "$ROOT/payload/node_modules/@prompt-tripwire/cli/dist/index.js" "$@"
`,
);
writeExecutable(
  join(stagingRoot, "bin", "create-judge-fixture"),
  `#!/bin/sh
set -eu
${resolveRoot}
DEST=\${1:-"$PWD/prompt-tripwire-judge-fixture"}
if [ -e "$DEST" ]; then
  echo "Destination already exists: $DEST" >&2
  exit 1
fi
mkdir -p "$(dirname -- "$DEST")"
cp -R "$ROOT/judge/fixture-template" "$DEST"
git -C "$DEST" init -q -b main
git -C "$DEST" config user.name "PromptTripwire Judge Fixture"
git -C "$DEST" config user.email "fixture@example.invalid"
git -C "$DEST" add .
git -C "$DEST" commit -qm "chore: initialize safe judge fixture"
printf '%s\n' "$DEST"
`,
);

for (const name of ["install.sh", "uninstall.sh"]) {
  const template = readFileSync(join(root, "scripts", "distribution", name), "utf8");
  const content = template.replaceAll("__PROMPT_TRIPWIRE_VERSION__", version);
  assert.ok(!content.includes("__PROMPT_TRIPWIRE_VERSION__"), `${name} version was not rendered`);
  writeExecutable(join(stagingRoot, name), content);
}

const manifest = {
  name: "PromptTripwire",
  version,
  artifact: artifactName,
  platform: "macOS",
  architecture: "arm64",
  minimumNode: "24.15.0",
  requiredCodexCli: "0.144.4",
  authentication: "existing Codex CLI login; no separate OPENAI_API_KEY",
  codexPlugin: "prompt-tripwire@prompt-tripwire-local",
  codexSkill: "prompt-tripwire:preflight",
  unifiedInstaller: "./install.sh --with-codex-plugin",
  planningModel: "gpt-5.6-sol / low",
  comparatorModel: "gpt-5.6-terra / low",
  projectLicense: "Apache-2.0 (see LICENSE)",
};
writeFileSync(join(stagingRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const releaseTimestamp = new Date("2026-07-15T00:00:00.000Z");
function normalizeTimestamps(path) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path).sort()) normalizeTimestamps(join(path, entry));
  }
  utimesSync(path, releaseTimestamp, releaseTimestamp);
}
normalizeTimestamps(stagingRoot);

const tar = spawnSync("/usr/bin/tar", ["-cf", tarPath, "-C", artifactsRoot, artifactName], {
  encoding: "utf8",
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});
assert.equal(tar.status, 0, tar.stderr);
const gzip = spawnSync("/usr/bin/gzip", ["-n", "-f", tarPath], { encoding: "utf8" });
assert.equal(gzip.status, 0, gzip.stderr);
const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
writeFileSync(checksumsPath, `${digest}  ${basename(archivePath)}\n`);
process.stdout.write(
  `${relative(root, archivePath)}\n${relative(root, checksumsPath)}\nsha256 ${digest}\n`,
);
