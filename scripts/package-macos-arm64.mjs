#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
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
const maxArchiveBytes = 8 * 1024 * 1024;

function commandOutput(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

const sourceCommit = commandOutput("git", ["rev-parse", "HEAD"]);
const sourceDirty = commandOutput("git", ["status", "--porcelain=v1", "--untracked-files=normal"])
  .split("\n")
  .some(Boolean);
const commitEpoch = commandOutput("git", ["show", "-s", "--format=%ct", "HEAD"]);
const sourceDateEpoch = Number(process.env.SOURCE_DATE_EPOCH ?? commitEpoch);
assert.ok(
  Number.isSafeInteger(sourceDateEpoch) && sourceDateEpoch >= 0,
  "SOURCE_DATE_EPOCH must be a non-negative integer",
);

const releaseTag =
  process.env.GITHUB_REF_TYPE === "tag"
    ? process.env.GITHUB_REF_NAME
    : process.env.PROMPT_TRIPWIRE_RELEASE_TAG;
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.ok(releaseTag, "GITHUB_REF_NAME is required for tag release packaging");
}
if (releaseTag !== undefined) {
  assert.equal(releaseTag, `v${version}`, "release tag must match the package version");
  assert.equal(sourceDirty, false, "release packaging requires a clean source tree");
  assert.equal(
    commandOutput("git", ["rev-parse", `refs/tags/${releaseTag}^{commit}`]),
    sourceCommit,
    "release tag must resolve to the packaged source commit",
  );
  assert.equal(
    sourceDateEpoch,
    Number(commitEpoch),
    "release packaging must use the source commit timestamp",
  );
}

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
rmSync(checksumsPath, { force: true });
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
  [`docs/RELEASE_NOTES_v${version}.md`, "RELEASE_NOTES.md"],
]) {
  copyFile(join(root, source), join(stagingRoot, destination));
}
const releaseDocs = [
  "ARCHITECTURE.md",
  "BUILD_WEEK.md",
  "BUILD_WEEK_REQUIREMENTS_MATRIX.md",
  "CODEX_APP_SERVER_SPIKE.md",
  "CODEX_COLLABORATION.md",
  "DECISIONS.md",
  "DEPENDENCIES.md",
  "DEVPOST_SUBMISSION.md",
  "JUDGE_GUIDE.md",
  "RELEASE_NOTES_v0.1.0.md",
  "RELEASE_NOTES_v0.1.1.md",
  "RELEASE_NOTES_v0.1.2.md",
  "RELEASE_NOTES_v0.1.10.md",
  "RELEASE_NOTES_v0.1.11.md",
  `RELEASE_NOTES_v${version}.md`,
  "RESEARCH.md",
  "SECURITY.md",
  "SPECIFICATION.md",
];
for (const name of new Set(releaseDocs)) {
  copyFile(join(root, "docs", name), join(stagingRoot, "docs", name));
}
copyFile(join(root, "LICENSE"), join(stagingRoot, "LICENSE"));
copyFile(
  join(root, ".agents", "plugins", "marketplace.json"),
  join(stagingRoot, ".agents", "plugins", "marketplace.json"),
);
for (const relativePath of [
  ".codex-plugin/plugin.json",
  "skills/preflight/SKILL.md",
  "skills/preflight/agents/openai.yaml",
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
  codexCompatibility: "normal-schema profile v1 plus bounded semantic canary",
  authentication: "existing Codex CLI login; no separate OPENAI_API_KEY",
  codexPlugin: "prompt-tripwire@prompt-tripwire-local",
  codexSkill: "prompt-tripwire:preflight",
  unifiedInstaller: "./install.sh --with-codex-plugin",
  planningModel: "gpt-5.6-sol / low",
  comparatorModel: "gpt-5.6-terra / low",
  projectLicense: "Apache-2.0 (see LICENSE)",
  sourceCommit,
  sourceDirty,
  sourceDateEpoch,
  releaseTag: releaseTag ?? null,
  archiveFormat: "ustar+gzip",
  maximumArchiveBytes: maxArchiveBytes,
};
writeFileSync(join(stagingRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const releaseTimestamp = new Date(sourceDateEpoch * 1000);
function normalizeTimestamps(path) {
  const stats = lstatSync(path);
  assert.equal(
    stats.isSymbolicLink(),
    false,
    `release staging cannot contain symlinks: ${relative(root, path)}`,
  );
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path).sort()) normalizeTimestamps(join(path, entry));
    chmodSync(path, 0o755);
  } else {
    chmodSync(path, (stats.mode & 0o111) === 0 ? 0o644 : 0o755);
  }
  utimesSync(path, releaseTimestamp, releaseTimestamp);
}
normalizeTimestamps(stagingRoot);

function archiveEntries(path, archivePath) {
  const result = [archivePath];
  if (lstatSync(path).isDirectory()) {
    for (const entry of readdirSync(path).sort()) {
      result.push(...archiveEntries(join(path, entry), `${archivePath}/${entry}`));
    }
  }
  return result;
}

const entries = archiveEntries(stagingRoot, artifactName);
const tar = spawnSync(
  "/usr/bin/tar",
  [
    "-cf",
    tarPath,
    "--format",
    "ustar",
    "--uid",
    "0",
    "--gid",
    "0",
    "--uname",
    "root",
    "--gname",
    "root",
    "--no-recursion",
    "-C",
    artifactsRoot,
    "-T",
    "-",
  ],
  {
    encoding: "utf8",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    input: `${entries.join("\n")}\n`,
  },
);
assert.equal(tar.status, 0, tar.stderr);
const gzip = spawnSync("/usr/bin/gzip", ["-n", "-9", "-f", tarPath], { encoding: "utf8" });
assert.equal(gzip.status, 0, gzip.stderr);
const archiveBytes = statSync(archivePath).size;
assert.ok(
  archiveBytes <= maxArchiveBytes,
  `release archive exceeds ${String(maxArchiveBytes)} bytes: ${String(archiveBytes)}`,
);
const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
writeFileSync(checksumsPath, `${digest}  ${basename(archivePath)}\n`);
process.stdout.write(
  `${relative(root, archivePath)}\n${relative(root, checksumsPath)}\nsha256 ${digest}\nbytes ${String(archiveBytes)}\nsource ${sourceCommit}\n`,
);
