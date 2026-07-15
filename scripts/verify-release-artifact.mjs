#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const archive = resolve(process.argv[2] ?? "artifacts/prompt-tripwire-v0.1.0-macos-arm64.tar.gz");
const sshGitRemotePrefix = ["git", "github.com:"].join("@");
assert.ok(existsSync(archive), `artifact does not exist: ${archive}`);
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
if [ "$1" = "--version" ]; then
  printf 'codex-cli %s\\n' "\${FAKE_CODEX_VERSION:-0.144.4}"
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  [ "\${FAKE_CODEX_LOGIN:-logged-in}" = "logged-in" ] || exit 1
  printf '%s\\n' 'Logged in using ChatGPT'
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "list" ]; then
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
  printf '%s' "$4" > "$FAKE_CODEX_STATE/marketplace-root"
  printf '%s\\n' '{"marketplaceName":"prompt-tripwire-local","alreadyAdded":false}'
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "remove" ]; then
  [ "$4" = "prompt-tripwire-local" ] || exit 65
  rm -f "$FAKE_CODEX_STATE/marketplace-root"
  printf '%s\\n' '{"removed":true}'
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then
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
  [ "$3" = "prompt-tripwire@prompt-tripwire-local" ] || exit 65
  if [ "\${FAKE_CODEX_PLUGIN_ADD:-ok}" = "fail-once" ] && [ ! -f "$FAKE_CODEX_STATE/plugin-add-failed" ]; then
    : > "$FAKE_CODEX_STATE/plugin-add-failed"
    exit 1
  fi
  : > "$FAKE_CODEX_STATE/plugin-installed"
  printf '%s\\n' '{"pluginId":"prompt-tripwire@prompt-tripwire-local"}'
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "remove" ]; then
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

try {
  run("/usr/bin/tar", ["-xzf", archive, "-C", root]);
  const entries = readdirSync(root);
  assert.equal(entries.length, 1, "archive must contain one top-level directory");
  const distribution = join(root, entries[0]);
  assert.match(
    readFileSync(join(distribution, "LICENSE"), "utf8"),
    /Apache License\s+Version 2\.0, January 2004/u,
  );
  assert.equal(
    JSON.parse(readFileSync(join(distribution, "release-manifest.json"), "utf8")).projectLicense,
    "Apache-2.0 (see LICENSE)",
  );
  for (const relativePath of [
    ".agents/plugins/marketplace.json",
    "plugins/prompt-tripwire/.codex-plugin/plugin.json",
    "plugins/prompt-tripwire/skills/preflight/SKILL.md",
    "plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs",
  ]) {
    assert.ok(existsSync(join(distribution, relativePath)), `missing Plugin file: ${relativePath}`);
  }
  assert.deepEqual(
    JSON.parse(readFileSync(join(distribution, ".agents/plugins/marketplace.json"), "utf8"))
      .plugins[0].source,
    { source: "local", path: "./plugins/prompt-tripwire" },
  );
  assert.match(run(join(distribution, "bin", "tripwire"), ["--version"]), /0\.1\.0/u);
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
  assert.match(run(join(installedPrefix, "bin", "tripwire"), ["--version"]), /0\.1\.0/u);
  assert.match(
    readFileSync(join(installedPrefix, "lib", "prompt-tripwire", "0.1.0", "LICENSE"), "utf8"),
    /Apache License\s+Version 2\.0, January 2004/u,
  );
  run(join(installedPrefix, "lib", "prompt-tripwire", "0.1.0", "uninstall.sh"), [], {
    env: installEnv,
  });
  assert.equal(existsSync(join(installedPrefix, "bin", "tripwire")), false);

  const fakeBin = join(root, "fake-bin");
  const fakeState = join(root, "fake-codex-state");
  const fakeCodex = createFakeCodex(fakeBin);
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
  const installedRoot = join(pluginPrefix, "lib", "prompt-tripwire", "0.1.0");
  for (const relativePath of [
    ".agents/plugins/marketplace.json",
    "plugins/prompt-tripwire/.codex-plugin/plugin.json",
    "plugins/prompt-tripwire/skills/preflight/SKILL.md",
    "plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs",
    "plugins/prompt-tripwire/runtime.json",
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

  run(join(distribution, "install.sh"), ["--with-codex-plugin"], { env: pluginInstallEnv });
  const installCalls = readFileSync(join(fakeState, "calls.log"), "utf8").trim().split("\n");
  assert.equal(
    installCalls.filter(
      (call) => call === "plugin add prompt-tripwire@prompt-tripwire-local --json",
    ).length,
    2,
  );
  assert.equal(installCalls.filter((call) => call.includes("plugin marketplace add")).length, 1);
  assert.equal(
    installCalls.some((call) => /\b(?:inspect|approve|run)\b/u.test(call)),
    false,
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
  run(join(distribution, "uninstall.sh"), ["--with-codex-plugin"], {
    env: pluginInstallEnv,
  });

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
  runFailure(join(distribution, "install.sh"), ["--with-codex-plugin"], /CODEX_VERSION_MISMATCH/u, {
    env: {
      ...pluginInstallEnv,
      FAKE_CODEX_VERSION: "0.144.3",
      PROMPT_TRIPWIRE_PREFIX: join(root, "wrong-codex-prefix"),
    },
  });

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
        FAKE_CODEX_PLUGIN_ADD: "fail-once",
        PROMPT_TRIPWIRE_PREFIX: join(root, "rollback-prefix"),
      },
    },
  );
  assert.equal(readFileSync(join(rollbackState, "marketplace-root"), "utf8"), rollbackMarketplace);
  assert.ok(existsSync(join(rollbackState, "plugin-installed")));

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
