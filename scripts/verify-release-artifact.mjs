#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const version = String(JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version);
const versionPattern = new RegExp(version.replaceAll(".", "\\."), "u");
const archive = resolve(
  process.argv[2] ??
    join(projectRoot, "artifacts", `prompt-tripwire-v${version}-macos-arm64.tar.gz`),
);
const releaseTag =
  process.env.GITHUB_REF_TYPE === "tag"
    ? process.env.GITHUB_REF_NAME
    : process.env.PROMPT_TRIPWIRE_RELEASE_TAG;
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.ok(releaseTag, "GITHUB_REF_NAME is required for tag release verification");
}
const maxArchiveBytes = 8 * 1024 * 1024;
const sshGitRemotePrefix = ["git", "github.com:"].join("@");
const pluginSafetyFiles = Object.freeze([
  ".agents/plugins/marketplace.json",
  "plugins/prompt-tripwire/.codex-plugin/plugin.json",
  "plugins/prompt-tripwire/skills/preflight/SKILL.md",
  "plugins/prompt-tripwire/skills/preflight/agents/openai.yaml",
  "plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs",
]);
assert.ok(existsSync(archive), `artifact does not exist: ${archive}`);
assert.ok(
  statSync(archive).size <= maxArchiveBytes,
  `${basename(archive)} exceeds ${String(maxArchiveBytes)} bytes`,
);
const checksums = readFileSync(join(dirname(archive), "SHA256SUMS.txt"), "utf8");
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
assert.match(checksums, new RegExp(`^${digest}  ${basename(archive)}$`, "mu"));
const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-release-verify-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

function runFailure(command, args, expected, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.notEqual(result.status, 0, `${command} ${args.join(" ")} unexpectedly succeeded`);
  assert.match(`${result.stdout}\n${result.stderr}`, expected);
  return result;
}

function writeExecutable(path, content) {
  writeFileSync(path, content, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function createFakeCodex(binRoot) {
  mkdirSync(binRoot, { recursive: true });
  const codex = join(binRoot, "codex");
  writeExecutable(
    codex,
    `#!/bin/sh
set -eu
: "\${FAKE_CODEX_STATE:?}"
mkdir -p "$FAKE_CODEX_STATE"
printf '%s\\n' "$*" >> "$FAKE_CODEX_STATE/calls.log"
maybe_fail() {
  key=$1
  count_path="$FAKE_CODEX_STATE/count-$key"
  count=0
  if [ -f "$count_path" ]; then count=$(cat "$count_path"); fi
  count=$((count + 1))
  printf '%s' "$count" > "$count_path"
  if [ "\${FAKE_CODEX_FAIL_KEY:-}" = "$key" ] &&
    [ "$count" -eq "\${FAKE_CODEX_FAIL_AT:-1}" ]
  then
    exit 1
  fi
}
if [ "$1" = "--version" ]; then
  printf 'codex-cli %s\\n' "\${FAKE_CODEX_VERSION:-9.9.9}"
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  [ "\${FAKE_CODEX_LOGIN:-logged-in}" = "logged-in" ] || exit 1
  printf '%s\\n' 'Logged in using ChatGPT'
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "list" ]; then
  maybe_fail marketplace-list
  node -e '
    const fs=require("node:fs");
    const state=process.argv[1];
    const marketplaces=[{name:"other-marketplace",root:"/tmp/other-marketplace"}];
    const path=state+"/marketplace-root";
    if(fs.existsSync(path))marketplaces.push({name:"prompt-tripwire-local",root:fs.readFileSync(path,"utf8")});
    process.stdout.write(JSON.stringify({marketplaces}));
  ' "$FAKE_CODEX_STATE"
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "add" ]; then
  maybe_fail marketplace-add
  printf '%s' "$4" > "$FAKE_CODEX_STATE/marketplace-root"
  printf '%s\\n' '{"marketplaceName":"prompt-tripwire-local","alreadyAdded":false}'
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "remove" ]; then
  maybe_fail marketplace-remove
  [ "$4" = "prompt-tripwire-local" ] || exit 65
  rm -f "$FAKE_CODEX_STATE/marketplace-root"
  printf '%s\\n' '{"removed":true}'
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then
  maybe_fail plugin-list
  node -e '
    const fs=require("node:fs");
    const state=process.argv[1];
    const installed=[{pluginId:"other-plugin@other-marketplace",installed:true,enabled:true}];
    if(fs.existsSync(state+"/plugin-installed"))installed.push({pluginId:"prompt-tripwire@prompt-tripwire-local",installed:true,enabled:true});
    process.stdout.write(JSON.stringify({installed,available:[]}));
  ' "$FAKE_CODEX_STATE"
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "add" ]; then
  maybe_fail plugin-add
  [ "$3" = "prompt-tripwire@prompt-tripwire-local" ] || exit 65
  : > "$FAKE_CODEX_STATE/plugin-installed"
  printf '%s\\n' '{"pluginId":"prompt-tripwire@prompt-tripwire-local"}'
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "remove" ]; then
  maybe_fail plugin-remove
  [ "$3" = "prompt-tripwire@prompt-tripwire-local" ] || exit 65
  rm -f "$FAKE_CODEX_STATE/plugin-installed"
  printf '%s\\n' '{"removed":true}'
  exit 0
fi
exit 64
`,
  );
  return codex;
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

function markdownWithoutFencedCode(markdown) {
  let fence = null;
  return markdown
    .split("\n")
    .map((line) => {
      const opening = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
      if (fence === null && opening) {
        fence = { character: opening[1][0], length: opening[1].length };
        return "";
      }
      if (fence !== null) {
        const closing = line.match(/^\s{0,3}(`+|~+)\s*$/u);
        if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
          fence = null;
        }
        return "";
      }
      return line;
    })
    .join("\n");
}

function markdownDestinations(markdown) {
  const content = markdownWithoutFencedCode(markdown);
  const destinations = [];
  let cursor = 0;
  while ((cursor = content.indexOf("](", cursor)) !== -1) {
    cursor += 2;
    while (/\s/u.test(content[cursor] ?? "")) cursor += 1;
    if (content[cursor] === "<") {
      const end = content.indexOf(">", cursor + 1);
      if (end !== -1) {
        destinations.push(content.slice(cursor + 1, end));
        cursor = end + 1;
      }
      continue;
    }

    const start = cursor;
    let nestedParentheses = 0;
    while (cursor < content.length) {
      const character = content[cursor];
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      if (character === "(") {
        nestedParentheses += 1;
      } else if (character === ")") {
        if (nestedParentheses === 0) break;
        nestedParentheses -= 1;
      } else if (/\s/u.test(character) && nestedParentheses === 0) {
        break;
      }
      cursor += 1;
    }
    if (cursor > start) destinations.push(content.slice(start, cursor));
  }

  for (const match of content.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gmu)) {
    destinations.push(match[1] ?? match[2]);
  }
  return destinations;
}

function verifyPackagedMarkdownLinks(distribution) {
  const distributionPrefix = `${distribution}${sep}`;
  for (const markdownPath of files(distribution).filter((path) => path.endsWith(".md"))) {
    const documentPath = relative(distribution, markdownPath);
    for (const rawDestination of markdownDestinations(readFileSync(markdownPath, "utf8"))) {
      const destination = rawDestination.trim();
      if (
        destination.length === 0 ||
        destination.startsWith("#") ||
        destination.startsWith("/") ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(destination)
      ) {
        continue;
      }

      const encodedPath = destination.split(/[?#]/u, 1)[0];
      if (encodedPath.length === 0) continue;
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(encodedPath).replace(/\\([!-/:-@[-`{-~])/gu, "$1");
      } catch {
        assert.fail(`packaged Markdown contains an invalid relative link: ${documentPath}`);
      }

      const target = resolve(dirname(markdownPath), decodedPath);
      assert.ok(
        target.startsWith(distributionPrefix),
        `packaged Markdown link escapes the artifact: ${documentPath} -> ${destination}`,
      );
      assert.ok(
        existsSync(target) && statSync(target).isFile(),
        `packaged Markdown link target is missing: ${documentPath} -> ${destination}`,
      );
    }
  }
}

function treeSnapshot(path) {
  try {
    lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const result = [];
  function visit(candidate, relativePath) {
    const stat = lstatSync(candidate);
    const mode = stat.mode & 0o777;
    if (stat.isSymbolicLink()) {
      result.push({ path: relativePath, type: "symlink", mode, target: readlinkSync(candidate) });
      return;
    }
    if (stat.isDirectory()) {
      result.push({ path: relativePath, type: "directory", mode });
      for (const entry of readdirSync(candidate).sort()) {
        visit(join(candidate, entry), relativePath ? `${relativePath}/${entry}` : entry);
      }
      return;
    }
    const content = readFileSync(candidate);
    result.push({
      path: relativePath,
      type: "file",
      mode,
      size: content.length,
      digest: createHash("sha256").update(content).digest("hex"),
    });
  }
  visit(path, "");
  return result;
}

function promptTripwireState(prefix, fakeState) {
  return {
    local: treeSnapshot(prefix),
    marketplaceRoot: existsSync(join(fakeState, "marketplace-root"))
      ? readFileSync(join(fakeState, "marketplace-root"), "utf8")
      : null,
    pluginInstalled: existsSync(join(fakeState, "plugin-installed")),
    otherMarketplace: { name: "other-marketplace", root: "/tmp/other-marketplace" },
    otherPlugin: { pluginId: "other-plugin@other-marketplace", installed: true, enabled: true },
  };
}

function fakeCodexMutationCalls(fakeState) {
  const callsPath = join(fakeState, "calls.log");
  if (!existsSync(callsPath)) return [];
  return readFileSync(callsPath, "utf8")
    .split("\n")
    .filter((call) => /plugin (?:add|remove)|plugin marketplace (?:add|remove)/u.test(call));
}

function createPriorRuntime(prefix, priorVersion = "0.1.0") {
  const bin = join(prefix, "bin");
  const destination = join(prefix, "lib", "prompt-tripwire", priorVersion);
  mkdirSync(join(destination, "bin"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeExecutable(
    join(destination, "bin", "tripwire"),
    `#!/bin/sh\nprintf '%s\\n' 'prompt-tripwire ${priorVersion}'\n`,
  );
  writeExecutable(join(destination, "bin", "create-judge-fixture"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(destination, ".prompt-tripwire-owned"), `prompt-tripwire ${priorVersion}\n`, {
    mode: 0o600,
  });
  symlinkSync(join(destination, "bin", "tripwire"), join(bin, "tripwire"));
  symlinkSync(
    join(destination, "bin", "create-judge-fixture"),
    join(bin, "tripwire-create-fixture"),
  );
  return destination;
}

function createFakeState(path, marketplaceRoot, pluginInstalled) {
  mkdirSync(path, { recursive: true });
  if (marketplaceRoot !== null) writeFileSync(join(path, "marketplace-root"), marketplaceRoot);
  if (pluginInstalled) writeFileSync(join(path, "plugin-installed"), "");
}

function clearFakeCounters(path) {
  for (const entry of readdirSync(path)) {
    if (entry.startsWith("count-")) rmSync(join(path, entry));
  }
}

function createFailingMv(binRoot) {
  mkdirSync(binRoot, { recursive: true });
  writeExecutable(
    join(binRoot, "mv"),
    `#!/bin/sh
set -eu
: "\${FAKE_FS_STATE:?}"
mkdir -p "$FAKE_FS_STATE"
count_path="$FAKE_FS_STATE/mv-count"
count=0
if [ -f "$count_path" ]; then count=$(cat "$count_path"); fi
count=$((count + 1))
printf '%s' "$count" > "$count_path"
target=""
for argument in "$@"; do target=$argument; done
if [ "$count" -eq "\${FAKE_MV_FAIL_AT:?}" ]; then
  printf 'fake mv failed for %s\n' "$target" >&2
  exit 1
fi
exec /bin/mv "$@"
`,
  );
}

function createFailingRm(binRoot) {
  mkdirSync(binRoot, { recursive: true });
  writeExecutable(
    join(binRoot, "rm"),
    `#!/bin/sh
set -eu
: "\${FAKE_FS_STATE:?}"
: "\${FAKE_RM_TARGET_PREFIX:?}"
target=""
for argument in "$@"; do target=$argument; done
case "$target" in
  "$FAKE_RM_TARGET_PREFIX"/*) ;;
  *) exec /bin/rm "$@" ;;
esac
mkdir -p "$FAKE_FS_STATE"
count_path="$FAKE_FS_STATE/rm-count"
count=0
if [ -f "$count_path" ]; then count=$(cat "$count_path"); fi
count=$((count + 1))
printf '%s' "$count" > "$count_path"
if [ "$count" -eq "\${FAKE_RM_FAIL_AT:?}" ]; then
  printf 'fake rm failed for %s\n' "$target" >&2
  exit 1
fi
exec /bin/rm "$@"
`,
  );
}

function createFailingCp(binRoot) {
  mkdirSync(binRoot, { recursive: true });
  writeExecutable(
    join(binRoot, "cp"),
    `#!/bin/sh
set -eu
: "\${FAKE_FS_STATE:?}"
: "\${FAKE_CP_TARGET_PREFIX:?}"
target=""
for argument in "$@"; do target=$argument; done
case "$target" in
  "$FAKE_CP_TARGET_PREFIX"|"$FAKE_CP_TARGET_PREFIX"/*) ;;
  *) exec /bin/cp "$@" ;;
esac
mkdir -p "$FAKE_FS_STATE"
count_path="$FAKE_FS_STATE/cp-count"
count=0
if [ -f "$count_path" ]; then count=$(cat "$count_path"); fi
count=$((count + 1))
printf '%s' "$count" > "$count_path"
if [ "$count" -eq "\${FAKE_CP_FAIL_AT:?}" ]; then
  printf 'fake cp failed for %s\n' "$target" >&2
  exit 1
fi
exec /bin/cp "$@"
`,
  );
}

try {
  run("/usr/bin/tar", ["-xzf", archive, "-C", root]);
  const entries = readdirSync(root);
  assert.equal(entries.length, 1, "archive must contain one top-level directory");
  const distribution = join(root, entries[0]);
  verifyPackagedMarkdownLinks(distribution);
  assert.match(
    readFileSync(join(distribution, "LICENSE"), "utf8"),
    /Apache License\s+Version 2\.0, January 2004/u,
  );
  const releaseManifest = JSON.parse(
    readFileSync(join(distribution, "release-manifest.json"), "utf8"),
  );
  const sourceCommit = run("git", ["rev-parse", "HEAD"], { cwd: projectRoot }).trim();
  const sourceDirty = run("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
    cwd: projectRoot,
  })
    .split("\n")
    .some(Boolean);
  const commitEpoch = Number(
    run("git", ["show", "-s", "--format=%ct", "HEAD"], { cwd: projectRoot }).trim(),
  );
  const expectedEpoch = Number(process.env.SOURCE_DATE_EPOCH ?? commitEpoch);
  assert.ok(
    Number.isSafeInteger(expectedEpoch) && expectedEpoch >= 0,
    "SOURCE_DATE_EPOCH must be a non-negative integer",
  );
  assert.equal(releaseManifest.version, version);
  assert.equal(releaseManifest.artifact, entries[0]);
  assert.equal(releaseManifest.projectLicense, "Apache-2.0 (see LICENSE)");
  assert.equal(releaseManifest.sourceCommit, sourceCommit);
  assert.equal(releaseManifest.sourceDirty, sourceDirty);
  assert.equal(releaseManifest.sourceDateEpoch, expectedEpoch);
  assert.equal(releaseManifest.releaseTag, releaseTag ?? null);
  assert.equal(releaseManifest.archiveFormat, "ustar+gzip");
  assert.equal(releaseManifest.maximumArchiveBytes, maxArchiveBytes);
  assert.equal(
    releaseManifest.codexCompatibility,
    "normal-schema profile v1 plus bounded semantic canary",
  );
  assert.ok(!("codexCompatibilityBaseline" in releaseManifest));
  if (releaseTag !== undefined) {
    assert.equal(releaseTag, `v${version}`, "release tag must match the package version");
    assert.equal(
      releaseManifest.sourceDirty,
      false,
      "release artifact must come from clean source",
    );
    assert.equal(
      run("git", ["rev-parse", `refs/tags/${releaseTag}^{commit}`], {
        cwd: projectRoot,
      }).trim(),
      sourceCommit,
      "release tag must resolve to the packaged source commit",
    );
    assert.equal(
      releaseManifest.sourceDateEpoch,
      commitEpoch,
      "release artifact must use the source commit timestamp",
    );
  }
  for (const relativePath of pluginSafetyFiles) {
    assert.ok(existsSync(join(distribution, relativePath)), `missing Plugin file: ${relativePath}`);
  }
  assert.deepEqual(
    JSON.parse(readFileSync(join(distribution, ".agents/plugins/marketplace.json"), "utf8"))
      .plugins[0].source,
    { source: "local", path: "./plugins/prompt-tripwire" },
  );
  assert.match(run(join(distribution, "bin", "tripwire"), ["--version"]), versionPattern);
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
  const installEnv = {
    ...process.env,
    PROMPT_TRIPWIRE_PREFIX: installedPrefix,
    PROMPT_TRIPWIRE_CODEX_BIN: join(root, "missing-codex"),
  };
  run(join(distribution, "install.sh"), [], { env: installEnv });
  assert.match(run(join(installedPrefix, "bin", "tripwire"), ["--version"]), versionPattern);
  const installedVersionRoot = join(installedPrefix, "lib", "prompt-tripwire", version);
  assert.equal(
    readFileSync(join(installedVersionRoot, ".prompt-tripwire-owned"), "utf8"),
    `prompt-tripwire ${version}\n`,
  );
  const installedOwnerMarker = lstatSync(join(installedVersionRoot, ".prompt-tripwire-owned"));
  assert.equal(installedOwnerMarker.isSymbolicLink(), false);
  assert.equal(installedOwnerMarker.mode & 0o777, 0o600);
  assert.match(
    readFileSync(join(installedVersionRoot, "LICENSE"), "utf8"),
    /Apache License\s+Version 2\.0, January 2004/u,
  );
  run(join(installedVersionRoot, "uninstall.sh"), [], {
    env: installEnv,
  });
  assert.equal(existsSync(join(installedPrefix, "bin", "tripwire")), false);

  const fakeBin = join(root, "fake-bin");
  const fakeState = join(root, "fake-codex-state");
  const fakeCodex = createFakeCodex(fakeBin);

  const upgradePrefix = join(root, "upgrade-prefix");
  const upgradeBin = join(upgradePrefix, "bin");
  const oldInstalledRoot = join(upgradePrefix, "lib", "prompt-tripwire", "0.1.0");
  mkdirSync(join(oldInstalledRoot, "bin"), { recursive: true });
  mkdirSync(upgradeBin, { recursive: true });
  writeExecutable(
    join(oldInstalledRoot, "bin", "tripwire"),
    "#!/bin/sh\nprintf '%s\\n' 'prompt-tripwire 0.1.0'\n",
  );
  writeExecutable(join(oldInstalledRoot, "bin", "create-judge-fixture"), "#!/bin/sh\nexit 0\n");
  symlinkSync(join(oldInstalledRoot, "bin", "tripwire"), join(upgradeBin, "tripwire"));
  symlinkSync(
    join(oldInstalledRoot, "bin", "create-judge-fixture"),
    join(upgradeBin, "tripwire-create-fixture"),
  );
  const upgradeState = join(root, "upgrade-codex-state");
  mkdirSync(upgradeState);
  writeFileSync(join(upgradeState, "marketplace-root"), oldInstalledRoot);
  writeFileSync(join(upgradeState, "plugin-installed"), "");
  const upgradeEnv = {
    ...process.env,
    OPENAI_API_KEY: "",
    CODEX_API_KEY: "",
    PROMPT_TRIPWIRE_PREFIX: upgradePrefix,
    PROMPT_TRIPWIRE_CODEX_BIN: fakeCodex,
    FAKE_CODEX_STATE: upgradeState,
  };
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: upgradeEnv });
  const upgradedRoot = join(upgradePrefix, "lib", "prompt-tripwire", version);
  assert.equal(readlinkSync(join(upgradeBin, "tripwire")), join(upgradedRoot, "bin", "tripwire"));
  assert.equal(
    readlinkSync(join(upgradeBin, "tripwire-create-fixture")),
    join(upgradedRoot, "bin", "create-judge-fixture"),
  );
  assert.match(run(join(upgradeBin, "tripwire"), ["--version"]), versionPattern);
  assert.equal(readFileSync(join(upgradeState, "marketplace-root"), "utf8"), upgradedRoot);
  assert.ok(
    existsSync(oldInstalledRoot),
    "the verified prior version remains available for rollback",
  );

  const oldMarketplaceRoot = join(root, "old-marketplace-root");
  mkdirSync(oldMarketplaceRoot);
  mkdirSync(fakeState);
  writeFileSync(join(fakeState, "marketplace-root"), oldMarketplaceRoot);
  writeFileSync(join(fakeState, "plugin-installed"), "");
  const pluginPrefix = join(root, "plugin-installed-prefix");
  const pluginInstallEnv = {
    ...process.env,
    OPENAI_API_KEY: "",
    CODEX_API_KEY: "",
    PROMPT_TRIPWIRE_PREFIX: pluginPrefix,
    PROMPT_TRIPWIRE_CODEX_BIN: fakeCodex,
    FAKE_CODEX_STATE: fakeState,
  };
  const firstInstall = run(join(distribution, "install.sh"), ["--with-codex-plugin"], {
    env: pluginInstallEnv,
  });
  assert.match(firstInstall, /runtime and Codex Plugin/u);
  assert.doesNotMatch(firstInstall, /(?:\/Users\/|prompt-tripwire-release-)/u);
  const installedRoot = join(pluginPrefix, "lib", "prompt-tripwire", version);
  for (const relativePath of [
    ...pluginSafetyFiles,
    "plugins/prompt-tripwire/runtime.json",
    ".prompt-tripwire-owned",
  ]) {
    assert.ok(
      existsSync(join(installedRoot, relativePath)),
      `missing installed file: ${relativePath}`,
    );
  }
  assert.equal(
    JSON.parse(readFileSync(join(installedRoot, "plugins/prompt-tripwire/runtime.json"), "utf8"))
      .runtime,
    join(installedRoot, "bin", "tripwire"),
  );
  assert.equal(readFileSync(join(fakeState, "marketplace-root"), "utf8"), installedRoot);
  assert.ok(existsSync(join(fakeState, "plugin-installed")));
  assert.equal(existsSync(join(installedRoot, ".codex-plugin-installing")), false);
  assert.ok(existsSync(join(installedRoot, ".codex-plugin-installed")));
  const installedAdapter = await import(
    `${
      pathToFileURL(
        join(installedRoot, "plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs"),
      ).href
    }?release-verification`
  );
  assert.equal(
    installedAdapter.resolveRuntime({ PATH: "" }),
    join(installedRoot, "bin", "tripwire"),
  );

  const reinstallState = promptTripwireState(pluginPrefix, fakeState);
  const mutationCallsBeforeReinstall = fakeCodexMutationCalls(fakeState);
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: pluginInstallEnv });
  assert.deepEqual(promptTripwireState(pluginPrefix, fakeState), reinstallState);
  const installCalls = readFileSync(join(fakeState, "calls.log"), "utf8").trim().split("\n");
  assert.deepEqual(fakeCodexMutationCalls(fakeState), mutationCallsBeforeReinstall);
  assert.equal(
    installCalls.filter(
      (call) => call === "plugin add prompt-tripwire@prompt-tripwire-local --json",
    ).length,
    1,
  );
  assert.equal(installCalls.filter((call) => call.includes("plugin marketplace add")).length, 1);
  assert.equal(
    installCalls.some((call) => /\b(?:inspect|approve|run)\b/u.test(call)),
    false,
  );

  for (const relativePath of pluginSafetyFiles) {
    const installedPath = join(installedRoot, relativePath);
    const bundledPath = join(distribution, relativePath);

    writeFileSync(installedPath, `corrupted ${relativePath}\n`);
    const mutationCallsBeforeCorruptionRepair = fakeCodexMutationCalls(fakeState);
    run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: pluginInstallEnv });
    assert.equal(lstatSync(installedPath).isFile(), true, `${relativePath} was not repaired`);
    assert.equal(lstatSync(installedPath).isSymbolicLink(), false);
    assert.deepEqual(readFileSync(installedPath), readFileSync(bundledPath));
    assert.deepEqual(fakeCodexMutationCalls(fakeState), mutationCallsBeforeCorruptionRepair);

    rmSync(installedPath);
    symlinkSync(bundledPath, installedPath);
    assert.equal(lstatSync(installedPath).isSymbolicLink(), true);
    const mutationCallsBeforeSymlinkRepair = fakeCodexMutationCalls(fakeState);
    run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: pluginInstallEnv });
    assert.equal(
      lstatSync(installedPath).isFile(),
      true,
      `${relativePath} symlink was not repaired`,
    );
    assert.equal(lstatSync(installedPath).isSymbolicLink(), false);
    assert.deepEqual(readFileSync(installedPath), readFileSync(bundledPath));
    assert.deepEqual(fakeCodexMutationCalls(fakeState), mutationCallsBeforeSymlinkRepair);
  }

  const installedRuntimeMetadata = join(installedRoot, "plugins/prompt-tripwire/runtime.json");
  const runtimeMetadataTarget = join(root, "same-version-runtime-metadata-target.json");
  writeFileSync(
    runtimeMetadataTarget,
    `${JSON.stringify({ runtime: join(installedRoot, "bin", "tripwire") })}\n`,
  );
  rmSync(installedRuntimeMetadata);
  symlinkSync(runtimeMetadataTarget, installedRuntimeMetadata);
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: pluginInstallEnv });
  assert.equal(lstatSync(installedRuntimeMetadata).isFile(), true);
  assert.equal(lstatSync(installedRuntimeMetadata).isSymbolicLink(), false);
  assert.equal(
    JSON.parse(readFileSync(installedRuntimeMetadata, "utf8")).runtime,
    join(installedRoot, "bin", "tripwire"),
  );

  const installedMarker = join(installedRoot, ".codex-plugin-installed");
  const installedMarkerTarget = join(root, "same-version-plugin-installed-target");
  writeFileSync(installedMarkerTarget, "");
  rmSync(installedMarker);
  symlinkSync(installedMarkerTarget, installedMarker);
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: pluginInstallEnv });
  assert.equal(lstatSync(installedMarker).isFile(), true);
  assert.equal(lstatSync(installedMarker).isSymbolicLink(), false);

  const installingMarker = join(installedRoot, ".codex-plugin-installing");
  symlinkSync(join(root, "missing-installing-marker-target"), installingMarker);
  assert.equal(lstatSync(installingMarker).isSymbolicLink(), true);
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: pluginInstallEnv });
  assert.equal(treeSnapshot(installingMarker), null);

  const repairFailureFilesystemState = join(root, "safety-repair-failure-filesystem-state");
  const repairFailureFilesystemBin = join(root, "safety-repair-failure-bin");
  const repairFailurePath = join(
    installedRoot,
    "plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs",
  );
  writeFileSync(repairFailurePath, "pre-repair corruption\n");
  createFailingMv(repairFailureFilesystemBin);
  const repairFailureBefore = promptTripwireState(pluginPrefix, fakeState);
  const repairFailureMutationsBefore = fakeCodexMutationCalls(fakeState);
  const repairFailure = runFailure(
    join(distribution, "install.sh"),
    ["--with-codex-plugin"],
    /INSTALL_FAILED/u,
    {
      env: {
        ...pluginInstallEnv,
        FAKE_FS_STATE: repairFailureFilesystemState,
        FAKE_MV_FAIL_AT: "2",
        PATH: `${repairFailureFilesystemBin}:${process.env.PATH}`,
      },
    },
  );
  assert.doesNotMatch(`${repairFailure.stdout}\n${repairFailure.stderr}`, /ROLLBACK_INCOMPLETE/u);
  assert.deepEqual(promptTripwireState(pluginPrefix, fakeState), repairFailureBefore);
  assert.deepEqual(fakeCodexMutationCalls(fakeState), repairFailureMutationsBefore);
  assert.equal(readFileSync(repairFailurePath, "utf8"), "pre-repair corruption\n");
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: pluginInstallEnv });
  assert.deepEqual(
    readFileSync(repairFailurePath),
    readFileSync(
      join(distribution, "plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs"),
    ),
  );

  run(join(installedRoot, "uninstall.sh"), ["--with-codex-plugin"], {
    env: pluginInstallEnv,
  });
  assert.equal(existsSync(join(pluginPrefix, "bin", "tripwire")), false);
  assert.equal(existsSync(join(fakeState, "plugin-installed")), false);
  assert.equal(existsSync(join(fakeState, "marketplace-root")), false);
  const uninstallCalls = readFileSync(join(fakeState, "calls.log"), "utf8");
  assert.doesNotMatch(uninstallCalls, /marketplace remove other-marketplace/u);
  assert.doesNotMatch(uninstallCalls, /plugin remove other-plugin/u);
  const uninstalledState = promptTripwireState(pluginPrefix, fakeState);
  const repeatedUninstall = run(join(distribution, "uninstall.sh"), ["--with-codex-plugin"], {
    env: pluginInstallEnv,
  });
  assert.match(repeatedUninstall, /Plugin: already absent/u);
  assert.match(repeatedUninstall, /Marketplace: already absent/u);
  assert.match(repeatedUninstall, /Runtime: already absent/u);
  assert.deepEqual(promptTripwireState(pluginPrefix, fakeState), uninstalledState);

  const elsewhereState = join(root, "elsewhere-codex-state");
  const elsewherePrefix = join(root, "elsewhere-prefix");
  createFakeState(elsewhereState, null, false);
  const elsewhereEnv = {
    ...pluginInstallEnv,
    FAKE_CODEX_STATE: elsewhereState,
    PROMPT_TRIPWIRE_PREFIX: elsewherePrefix,
  };
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: elsewhereEnv });
  const elsewhereMarketplace = join(root, "marketplace-configured-elsewhere");
  mkdirSync(elsewhereMarketplace);
  writeFileSync(join(elsewhereState, "marketplace-root"), elsewhereMarketplace);
  const elsewhereInstalledRoot = join(elsewherePrefix, "lib", "prompt-tripwire", version);
  run(join(elsewhereInstalledRoot, "uninstall.sh"), ["--with-codex-plugin"], {
    env: elsewhereEnv,
  });
  assert.equal(
    readFileSync(join(elsewhereState, "marketplace-root"), "utf8"),
    elsewhereMarketplace,
  );
  assert.equal(existsSync(join(elsewhereState, "plugin-installed")), true);
  assert.equal(existsSync(elsewhereInstalledRoot), false);

  const missingCodexState = join(root, "missing-codex-uninstall-state");
  const missingCodexPrefix = join(root, "missing-codex-uninstall-prefix");
  createFakeState(missingCodexState, null, false);
  const missingCodexEnv = {
    ...pluginInstallEnv,
    FAKE_CODEX_STATE: missingCodexState,
    PROMPT_TRIPWIRE_PREFIX: missingCodexPrefix,
  };
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: missingCodexEnv });
  const missingCodexInstalledRoot = join(missingCodexPrefix, "lib", "prompt-tripwire", version);
  const missingCodexUninstall = run(
    join(missingCodexInstalledRoot, "uninstall.sh"),
    ["--with-codex-plugin"],
    {
      env: {
        ...missingCodexEnv,
        PROMPT_TRIPWIRE_CODEX_BIN: join(root, "codex-is-unavailable"),
      },
    },
  );
  assert.match(missingCodexUninstall, /Plugin registration: not removed/u);
  assert.match(missingCodexUninstall, /no global configuration was guessed or edited/u);
  assert.equal(existsSync(missingCodexInstalledRoot), false);
  assert.equal(existsSync(join(missingCodexState, "plugin-installed")), true);
  assert.equal(existsSync(join(missingCodexState, "marketplace-root")), true);

  const nonOwnedState = join(root, "non-owned-codex-state");
  const nonOwnedPrefix = join(root, "non-owned-prefix");
  const nonOwnedRoot = join(nonOwnedPrefix, "lib", "prompt-tripwire", version);
  createFakeState(nonOwnedState, elsewhereMarketplace, true);
  mkdirSync(nonOwnedRoot, { recursive: true });
  writeFileSync(join(nonOwnedRoot, "user-owned.txt"), "preserve me\n");
  const nonOwnedBefore = promptTripwireState(nonOwnedPrefix, nonOwnedState);
  runFailure(
    join(distribution, "uninstall.sh"),
    ["--with-codex-plugin"],
    /RUNTIME_UNINSTALL_CONFLICT/u,
    {
      env: {
        ...pluginInstallEnv,
        FAKE_CODEX_STATE: nonOwnedState,
        PROMPT_TRIPWIRE_PREFIX: nonOwnedPrefix,
      },
    },
  );
  assert.deepEqual(promptTripwireState(nonOwnedPrefix, nonOwnedState), nonOwnedBefore);
  assert.equal(existsSync(join(nonOwnedState, "calls.log")), false);

  for (const markerKind of ["symlink", "permissive-mode"]) {
    const markerState = join(root, `${markerKind}-marker-codex-state`);
    const markerPrefix = join(root, `${markerKind}-marker-prefix`);
    const markerRoot = join(markerPrefix, "lib", "prompt-tripwire", version);
    createFakeState(markerState, elsewhereMarketplace, true);
    mkdirSync(join(markerRoot, "bin"), { recursive: true });
    writeExecutable(
      join(markerRoot, "bin", "tripwire"),
      `#!/bin/sh\nprintf '%s\\n' 'prompt-tripwire ${version}'\n`,
    );
    const markerPath = join(markerRoot, ".prompt-tripwire-owned");
    if (markerKind === "symlink") {
      const markerTarget = join(root, "owner-marker-target");
      writeFileSync(markerTarget, `prompt-tripwire ${version}\n`, { mode: 0o600 });
      symlinkSync(markerTarget, markerPath);
    } else {
      writeFileSync(markerPath, `prompt-tripwire ${version}\n`, { mode: 0o644 });
    }
    const markerBefore = promptTripwireState(markerPrefix, markerState);
    runFailure(
      join(distribution, "uninstall.sh"),
      ["--with-codex-plugin"],
      /RUNTIME_UNINSTALL_CONFLICT/u,
      {
        env: {
          ...pluginInstallEnv,
          FAKE_CODEX_STATE: markerState,
          PROMPT_TRIPWIRE_PREFIX: markerPrefix,
        },
      },
    );
    assert.deepEqual(promptTripwireState(markerPrefix, markerState), markerBefore);
    assert.equal(existsSync(join(markerState, "calls.log")), false);
  }

  const removeFailureState = join(root, "remove-failure-codex-state");
  const removeFailurePrefix = join(root, "remove-failure-prefix");
  createFakeState(removeFailureState, null, false);
  const removeFailureEnv = {
    ...pluginInstallEnv,
    FAKE_CODEX_STATE: removeFailureState,
    PROMPT_TRIPWIRE_PREFIX: removeFailurePrefix,
  };
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: removeFailureEnv });
  clearFakeCounters(removeFailureState);
  const removeFailureBefore = promptTripwireState(removeFailurePrefix, removeFailureState);
  const removeFailureRoot = join(removeFailurePrefix, "lib", "prompt-tripwire", version);
  runFailure(
    join(removeFailureRoot, "uninstall.sh"),
    ["--with-codex-plugin"],
    /CODEX_PLUGIN_REMOVE_FAILED/u,
    {
      env: { ...removeFailureEnv, FAKE_CODEX_FAIL_KEY: "plugin-remove" },
    },
  );
  assert.deepEqual(
    promptTripwireState(removeFailurePrefix, removeFailureState),
    removeFailureBefore,
  );

  const marketplaceFailureState = join(root, "marketplace-remove-failure-codex-state");
  const marketplaceFailurePrefix = join(root, "marketplace-remove-failure-prefix");
  createFakeState(marketplaceFailureState, null, false);
  const marketplaceFailureEnv = {
    ...pluginInstallEnv,
    FAKE_CODEX_STATE: marketplaceFailureState,
    PROMPT_TRIPWIRE_PREFIX: marketplaceFailurePrefix,
  };
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], {
    env: marketplaceFailureEnv,
  });
  clearFakeCounters(marketplaceFailureState);
  const marketplaceFailureRoot = join(marketplaceFailurePrefix, "lib", "prompt-tripwire", version);
  const marketplaceFailureBefore = promptTripwireState(
    marketplaceFailurePrefix,
    marketplaceFailureState,
  );
  runFailure(
    join(marketplaceFailureRoot, "uninstall.sh"),
    ["--with-codex-plugin"],
    /CODEX_MARKETPLACE_REMOVE_FAILED/u,
    {
      env: { ...marketplaceFailureEnv, FAKE_CODEX_FAIL_KEY: "marketplace-remove" },
    },
  );
  assert.deepEqual(
    promptTripwireState(marketplaceFailurePrefix, marketplaceFailureState),
    marketplaceFailureBefore,
  );
  run(join(marketplaceFailureRoot, "uninstall.sh"), ["--with-codex-plugin"], {
    env: marketplaceFailureEnv,
  });
  assert.equal(existsSync(marketplaceFailureRoot), false);
  assert.equal(existsSync(join(marketplaceFailureState, "marketplace-root")), false);

  for (const [failureAt, expected] of [
    [1, /RUNTIME_LAUNCHER_REMOVE_FAILED/u],
    [2, /RUNTIME_LAUNCHER_REMOVE_FAILED/u],
    [3, /RUNTIME_REMOVE_FAILED/u],
    [4, /UNINSTALL_CLEANUP_FAILED/u],
  ]) {
    const suffix = String(failureAt);
    const localFailureState = join(root, `uninstall-local-failure-state-${suffix}`);
    const localFailurePrefix = join(root, `uninstall-local-failure-prefix-${suffix}`);
    const localFilesystemState = join(root, `uninstall-local-filesystem-state-${suffix}`);
    const localFilesystemBin = join(root, `uninstall-local-bin-${suffix}`);
    createFakeState(localFailureState, null, false);
    const localFailureEnv = {
      ...pluginInstallEnv,
      FAKE_CODEX_STATE: localFailureState,
      PROMPT_TRIPWIRE_PREFIX: localFailurePrefix,
    };
    run(join(distribution, "install.sh"), ["--with-codex-plugin"], {
      env: localFailureEnv,
    });
    clearFakeCounters(localFailureState);
    createFailingRm(localFilesystemBin);
    const localFailureRoot = join(localFailurePrefix, "lib", "prompt-tripwire", version);
    const before = promptTripwireState(localFailurePrefix, localFailureState);
    const failure = runFailure(
      join(localFailureRoot, "uninstall.sh"),
      ["--with-codex-plugin"],
      expected,
      {
        env: {
          ...localFailureEnv,
          FAKE_FS_STATE: localFilesystemState,
          FAKE_RM_FAIL_AT: suffix,
          FAKE_RM_TARGET_PREFIX: localFailurePrefix,
          PATH: `${localFilesystemBin}:${process.env.PATH}`,
        },
      },
    );
    assert.doesNotMatch(`${failure.stdout}\n${failure.stderr}`, /UNINSTALL_ROLLBACK_INCOMPLETE/u);
    assert.equal(
      `${failure.stdout}\n${failure.stderr}`.includes(localFailurePrefix),
      false,
      "uninstall filesystem failure output must not expose the install prefix",
    );
    assert.deepEqual(
      promptTripwireState(localFailurePrefix, localFailureState),
      before,
      `uninstall did not roll back local rm failure ${suffix}`,
    );
    run(join(localFailureRoot, "uninstall.sh"), ["--with-codex-plugin"], {
      env: localFailureEnv,
    });
  }

  const incompleteState = join(root, "uninstall-rollback-incomplete-state");
  const incompletePrefix = join(root, "uninstall-rollback-incomplete-prefix");
  const incompleteFilesystemState = join(root, "uninstall-rollback-incomplete-filesystem-state");
  const incompleteFilesystemBin = join(root, "uninstall-rollback-incomplete-bin");
  createFakeState(incompleteState, null, false);
  const incompleteEnv = {
    ...pluginInstallEnv,
    FAKE_CODEX_STATE: incompleteState,
    PROMPT_TRIPWIRE_PREFIX: incompletePrefix,
  };
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: incompleteEnv });
  clearFakeCounters(incompleteState);
  createFailingRm(incompleteFilesystemBin);
  createFailingCp(incompleteFilesystemBin);
  const incompleteRoot = join(incompletePrefix, "lib", "prompt-tripwire", version);
  const incompleteFailure = runFailure(
    join(incompleteRoot, "uninstall.sh"),
    ["--with-codex-plugin"],
    /UNINSTALL_ROLLBACK_INCOMPLETE/u,
    {
      env: {
        ...incompleteEnv,
        FAKE_FS_STATE: incompleteFilesystemState,
        FAKE_RM_FAIL_AT: "3",
        FAKE_RM_TARGET_PREFIX: incompletePrefix,
        FAKE_CP_FAIL_AT: "2",
        FAKE_CP_TARGET_PREFIX: incompletePrefix,
        PATH: `${incompleteFilesystemBin}:${process.env.PATH}`,
      },
    },
  );
  assert.equal(
    `${incompleteFailure.stdout}\n${incompleteFailure.stderr}`.includes(incompletePrefix),
    false,
    "uninstall rollback diagnostics must not expose the install prefix",
  );
  assert.equal(readFileSync(join(incompleteState, "marketplace-root"), "utf8"), incompleteRoot);
  assert.equal(existsSync(join(incompleteState, "plugin-installed")), true);
  assert.equal(
    readdirSync(join(incompletePrefix, "lib", "prompt-tripwire")).some((entry) =>
      entry.startsWith(`.uninstall-${version}.`),
    ),
    true,
    "an incomplete rollback must retain its recovery copy",
  );

  const unsupportedBin = join(root, "unsupported-bin");
  mkdirSync(unsupportedBin);
  writeExecutable(
    join(unsupportedBin, "uname"),
    `#!/bin/sh
if [ "$1" = "-s" ]; then printf '%s\\n' 'Linux'; else printf '%s\\n' 'x86_64'; fi
`,
  );
  runFailure(join(distribution, "install.sh"), ["--with-codex-plugin"], /UNSUPPORTED_PLATFORM/u, {
    env: {
      ...pluginInstallEnv,
      PATH: `${unsupportedBin}:${process.env.PATH}`,
      PROMPT_TRIPWIRE_PREFIX: join(root, "unsupported-prefix"),
    },
  });

  runFailure(join(distribution, "install.sh"), ["--with-codex-plugin"], /CODEX_LOGIN_REQUIRED/u, {
    env: {
      ...pluginInstallEnv,
      FAKE_CODEX_LOGIN: "missing",
      PROMPT_TRIPWIRE_PREFIX: join(root, "missing-login-prefix"),
    },
  });
  const arbitraryVersionInstall = run(join(distribution, "install.sh"), ["--with-codex-plugin"], {
    env: {
      ...pluginInstallEnv,
      FAKE_CODEX_VERSION: "7.8.9",
      PROMPT_TRIPWIRE_PREFIX: join(root, "arbitrary-codex-version-prefix"),
    },
  });
  assert.match(arbitraryVersionInstall, /runtime and Codex Plugin\./u);

  const rollbackState = join(root, "rollback-codex-state");
  const rollbackMarketplace = join(root, "rollback-marketplace-root");
  mkdirSync(rollbackState);
  mkdirSync(rollbackMarketplace);
  writeFileSync(join(rollbackState, "marketplace-root"), rollbackMarketplace);
  writeFileSync(join(rollbackState, "plugin-installed"), "");
  runFailure(
    join(distribution, "install.sh"),
    ["--with-codex-plugin"],
    /CODEX_PLUGIN_ADD_FAILED/u,
    {
      env: {
        ...pluginInstallEnv,
        FAKE_CODEX_STATE: rollbackState,
        FAKE_CODEX_FAIL_KEY: "plugin-add",
        PROMPT_TRIPWIRE_PREFIX: join(root, "rollback-prefix"),
      },
    },
  );
  assert.equal(readFileSync(join(rollbackState, "marketplace-root"), "utf8"), rollbackMarketplace);
  assert.ok(existsSync(join(rollbackState, "plugin-installed")));
  assert.equal(existsSync(join(root, "rollback-prefix")), false);

  for (const [failureKey, failureAt, expected] of [
    ["marketplace-add", 1, /CODEX_MARKETPLACE_ADD_FAILED/u],
    ["plugin-add", 1, /CODEX_PLUGIN_ADD_FAILED/u],
    ["marketplace-list", 2, /CODEX_MARKETPLACE_LIST_FAILED/u],
    ["plugin-list", 2, /CODEX_PLUGIN_LIST_FAILED/u],
  ]) {
    const suffix = `${failureKey}-${String(failureAt)}`;
    const transactionState = join(root, `fresh-failure-state-${suffix}`);
    const transactionPrefix = join(root, `fresh-failure-prefix-${suffix}`);
    createFakeState(transactionState, null, false);
    const before = promptTripwireState(transactionPrefix, transactionState);
    runFailure(join(distribution, "install.sh"), ["--with-codex-plugin"], expected, {
      env: {
        ...pluginInstallEnv,
        FAKE_CODEX_STATE: transactionState,
        FAKE_CODEX_FAIL_KEY: failureKey,
        FAKE_CODEX_FAIL_AT: String(failureAt),
        PROMPT_TRIPWIRE_PREFIX: transactionPrefix,
      },
    });
    assert.deepEqual(
      promptTripwireState(transactionPrefix, transactionState),
      before,
      `fresh install did not roll back ${failureKey}`,
    );
  }

  for (const [failureKey, failureAt, expected] of [
    ["plugin-remove", 1, /CODEX_PLUGIN_REMOVE_FAILED/u],
    ["marketplace-remove", 1, /CODEX_MARKETPLACE_REMOVE_FAILED/u],
    ["marketplace-add", 1, /CODEX_MARKETPLACE_ADD_FAILED/u],
    ["plugin-add", 1, /CODEX_PLUGIN_ADD_FAILED/u],
    ["marketplace-list", 2, /CODEX_MARKETPLACE_LIST_FAILED/u],
    ["plugin-list", 2, /CODEX_PLUGIN_LIST_FAILED/u],
  ]) {
    const suffix = `${failureKey}-${String(failureAt)}`;
    const transactionPrefix = join(root, `upgrade-failure-prefix-${suffix}`);
    const transactionState = join(root, `upgrade-failure-state-${suffix}`);
    const priorRoot = createPriorRuntime(transactionPrefix);
    createFakeState(transactionState, priorRoot, true);
    const before = promptTripwireState(transactionPrefix, transactionState);
    runFailure(join(distribution, "install.sh"), ["--with-codex-plugin"], expected, {
      env: {
        ...pluginInstallEnv,
        FAKE_CODEX_STATE: transactionState,
        FAKE_CODEX_FAIL_KEY: failureKey,
        FAKE_CODEX_FAIL_AT: String(failureAt),
        PROMPT_TRIPWIRE_PREFIX: transactionPrefix,
      },
    });
    assert.deepEqual(
      promptTripwireState(transactionPrefix, transactionState),
      before,
      `upgrade did not roll back ${failureKey}`,
    );
  }

  for (const [failureKey, failureAt, expected, removePlugin] of [
    ["plugin-add", 1, /CODEX_PLUGIN_ADD_FAILED/u, true],
    ["marketplace-list", 2, /CODEX_MARKETPLACE_LIST_FAILED/u, false],
    ["plugin-list", 2, /CODEX_PLUGIN_LIST_FAILED/u, false],
  ]) {
    const suffix = `${failureKey}-${String(failureAt)}`;
    const transactionPrefix = join(root, `reinstall-failure-prefix-${suffix}`);
    const transactionState = join(root, `reinstall-failure-state-${suffix}`);
    createFakeState(transactionState, null, false);
    const transactionEnv = {
      ...pluginInstallEnv,
      FAKE_CODEX_STATE: transactionState,
      PROMPT_TRIPWIRE_PREFIX: transactionPrefix,
    };
    run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: transactionEnv });
    const transactionRoot = join(transactionPrefix, "lib", "prompt-tripwire", version);
    if (removePlugin) {
      rmSync(join(transactionState, "plugin-installed"));
    } else {
      rmSync(join(transactionRoot, ".codex-plugin-installed"));
    }
    clearFakeCounters(transactionState);
    const before = promptTripwireState(transactionPrefix, transactionState);
    runFailure(join(distribution, "install.sh"), ["--with-codex-plugin"], expected, {
      env: {
        ...transactionEnv,
        FAKE_CODEX_FAIL_KEY: failureKey,
        FAKE_CODEX_FAIL_AT: String(failureAt),
      },
    });
    assert.deepEqual(
      promptTripwireState(transactionPrefix, transactionState),
      before,
      `same-version repair did not roll back ${failureKey}`,
    );
  }

  for (const failureAt of [1, 3]) {
    const transactionPrefix = join(root, `fresh-local-failure-prefix-${String(failureAt)}`);
    const transactionState = join(root, `fresh-local-failure-state-${String(failureAt)}`);
    const filesystemState = join(root, `fresh-local-filesystem-state-${String(failureAt)}`);
    const filesystemBin = join(root, `fresh-local-bin-${String(failureAt)}`);
    createFakeState(transactionState, null, false);
    createFailingMv(filesystemBin);
    const before = promptTripwireState(transactionPrefix, transactionState);
    const failure = runFailure(
      join(distribution, "install.sh"),
      ["--with-codex-plugin"],
      /INSTALL_FAILED/u,
      {
        env: {
          ...pluginInstallEnv,
          FAKE_CODEX_STATE: transactionState,
          FAKE_FS_STATE: filesystemState,
          FAKE_MV_FAIL_AT: String(failureAt),
          PATH: `${filesystemBin}:${process.env.PATH}`,
          PROMPT_TRIPWIRE_PREFIX: transactionPrefix,
        },
      },
    );
    assert.equal(
      `${failure.stdout}\n${failure.stderr}`.includes(transactionPrefix),
      false,
      "installer filesystem failure output must not expose the install prefix",
    );
    assert.deepEqual(promptTripwireState(transactionPrefix, transactionState), before);
  }

  const upgradeLocalPrefix = join(root, "upgrade-local-failure-prefix");
  const upgradeLocalState = join(root, "upgrade-local-failure-state");
  const upgradeFilesystemState = join(root, "upgrade-local-filesystem-state");
  const upgradeFilesystemBin = join(root, "upgrade-local-bin");
  const upgradePriorRoot = createPriorRuntime(upgradeLocalPrefix);
  createFakeState(upgradeLocalState, upgradePriorRoot, true);
  createFailingMv(upgradeFilesystemBin);
  const upgradeLocalBefore = promptTripwireState(upgradeLocalPrefix, upgradeLocalState);
  const upgradeLocalFailure = runFailure(
    join(distribution, "install.sh"),
    ["--with-codex-plugin"],
    /INSTALL_FAILED/u,
    {
      env: {
        ...pluginInstallEnv,
        FAKE_CODEX_STATE: upgradeLocalState,
        FAKE_FS_STATE: upgradeFilesystemState,
        FAKE_MV_FAIL_AT: "2",
        PATH: `${upgradeFilesystemBin}:${process.env.PATH}`,
        PROMPT_TRIPWIRE_PREFIX: upgradeLocalPrefix,
      },
    },
  );
  assert.equal(
    `${upgradeLocalFailure.stdout}\n${upgradeLocalFailure.stderr}`.includes(upgradeLocalPrefix),
    false,
    "upgrade filesystem failure output must not expose the install prefix",
  );
  assert.deepEqual(promptTripwireState(upgradeLocalPrefix, upgradeLocalState), upgradeLocalBefore);

  const reinstallLocalPrefix = join(root, "reinstall-local-failure-prefix");
  const reinstallLocalState = join(root, "reinstall-local-failure-state");
  const reinstallFilesystemState = join(root, "reinstall-local-filesystem-state");
  const reinstallFilesystemBin = join(root, "reinstall-local-bin");
  createFakeState(reinstallLocalState, null, false);
  const reinstallLocalEnv = {
    ...pluginInstallEnv,
    FAKE_CODEX_STATE: reinstallLocalState,
    PROMPT_TRIPWIRE_PREFIX: reinstallLocalPrefix,
  };
  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: reinstallLocalEnv });
  const reinstallLocalRoot = join(reinstallLocalPrefix, "lib", "prompt-tripwire", version);
  rmSync(join(reinstallLocalRoot, ".codex-plugin-installed"));
  clearFakeCounters(reinstallLocalState);
  createFailingMv(reinstallFilesystemBin);
  const reinstallLocalBefore = promptTripwireState(reinstallLocalPrefix, reinstallLocalState);
  const reinstallLocalFailure = runFailure(
    join(distribution, "install.sh"),
    ["--with-codex-plugin"],
    /RUNTIME_INSTALL_FAILED/u,
    {
      env: {
        ...reinstallLocalEnv,
        FAKE_FS_STATE: reinstallFilesystemState,
        FAKE_MV_FAIL_AT: "4",
        PATH: `${reinstallFilesystemBin}:${process.env.PATH}`,
      },
    },
  );
  assert.equal(
    `${reinstallLocalFailure.stdout}\n${reinstallLocalFailure.stderr}`.includes(
      reinstallLocalPrefix,
    ),
    false,
    "repair filesystem failure output must not expose the install prefix",
  );
  assert.deepEqual(
    promptTripwireState(reinstallLocalPrefix, reinstallLocalState),
    reinstallLocalBefore,
  );

  const brokenDistribution = join(root, "broken-distribution");
  cpSync(distribution, brokenDistribution, { recursive: true });
  rmSync(join(brokenDistribution, "payload"), { recursive: true, force: true });
  runFailure(join(brokenDistribution, "install.sh"), ["--with-codex-plugin"], /RUNTIME_MISSING/u, {
    env: {
      ...pluginInstallEnv,
      PROMPT_TRIPWIRE_PREFIX: join(root, "missing-runtime-prefix"),
    },
  });

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
