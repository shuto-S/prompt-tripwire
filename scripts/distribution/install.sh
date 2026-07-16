#!/bin/sh
set -eu

VERSION="__PROMPT_TRIPWIRE_VERSION__"
REQUIRED_CODEX_VERSION="0.144.4"
PLUGIN_NAME="prompt-tripwire"
MARKETPLACE_NAME="prompt-tripwire-local"
PLUGIN_SELECTOR="$PLUGIN_NAME@$MARKETPLACE_NAME"
WITH_CODEX_PLUGIN=0

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

case "${1:-}" in
  "") ;;
  --with-codex-plugin) WITH_CODEX_PLUGIN=1 ;;
  *) fail "INVALID_ARGUMENT: use install.sh [--with-codex-plugin]." ;;
esac
[ "$#" -le 1 ] || fail "INVALID_ARGUMENT: use install.sh [--with-codex-plugin]."

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PREFIX=${PROMPT_TRIPWIRE_PREFIX:-"$HOME/.local"}
case "$PREFIX" in
  /*) ;;
  *) PREFIX="$PWD/$PREFIX" ;;
esac
DEST="$PREFIX/lib/prompt-tripwire/$VERSION"
BIN="$PREFIX/bin"
CODEX=${PROMPT_TRIPWIRE_CODEX_BIN:-codex}

[ -x "$ROOT/bin/tripwire" ] && [ -d "$ROOT/payload" ] ||
  fail "RUNTIME_MISSING: the release artifact runtime is incomplete."

if [ "$WITH_CODEX_PLUGIN" -eq 1 ]; then
  for required_file in \
    "$ROOT/.agents/plugins/marketplace.json" \
    "$ROOT/plugins/prompt-tripwire/.codex-plugin/plugin.json" \
    "$ROOT/plugins/prompt-tripwire/skills/preflight/SKILL.md" \
    "$ROOT/plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs"
  do
    [ -f "$required_file" ] || fail "PLUGIN_PAYLOAD_MISSING: the bundled Codex Plugin is incomplete."
  done
  [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ] ||
    fail "UNSUPPORTED_PLATFORM: PromptTripwire requires macOS arm64."
  command -v node >/dev/null 2>&1 || fail "NODE_NOT_FOUND: Node.js 24.15 or newer is required."
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(!(a>24||(a===24&&b>=15)))process.exit(1)' ||
    fail "NODE_VERSION_MISMATCH: Node.js 24.15 or newer is required."
  command -v git >/dev/null 2>&1 || fail "GIT_NOT_FOUND: Git is required."
  command -v "$CODEX" >/dev/null 2>&1 ||
    fail "CODEX_NOT_FOUND: Codex CLI 0.144.4 is required."
  CODEX_VERSION=$("$CODEX" --version 2>/dev/null) ||
    fail "CODEX_VERSION_CHECK_FAILED: Codex CLI version could not be read."
  [ "$CODEX_VERSION" = "codex-cli $REQUIRED_CODEX_VERSION" ] ||
    fail "CODEX_VERSION_MISMATCH: Codex CLI 0.144.4 is required."
  "$CODEX" login status >/dev/null 2>&1 ||
    fail "CODEX_LOGIN_REQUIRED: sign in with the normal Codex login flow."
  RUNTIME_VERSION=$("$ROOT/bin/tripwire" --version 2>/dev/null) ||
    fail "RUNTIME_VERSION_CHECK_FAILED: the bundled runtime could not be started."
  [ "$RUNTIME_VERSION" = "prompt-tripwire $VERSION" ] ||
    fail "RUNTIME_VERSION_MISMATCH: the bundled PromptTripwire runtime is incompatible."
fi

if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  [ "$WITH_CODEX_PLUGIN" -eq 1 ] ||
    fail "RUNTIME_ALREADY_INSTALLED: PromptTripwire is already installed."
  [ -d "$DEST" ] && [ ! -L "$DEST" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing install root is not a directory owned by PromptTripwire."
  [ -x "$DEST/bin/tripwire" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing install root is not PromptTripwire."
  INSTALLED_VERSION=$("$DEST/bin/tripwire" --version 2>/dev/null) ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing runtime could not be verified."
  [ "$INSTALLED_VERSION" = "prompt-tripwire $VERSION" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: a different runtime version is installed."
else
  UPGRADE_OLD_DEST=""
  if [ -e "$BIN/tripwire" ] || [ -L "$BIN/tripwire" ] ||
    [ -e "$BIN/tripwire-create-fixture" ] || [ -L "$BIN/tripwire-create-fixture" ]
  then
    [ -L "$BIN/tripwire" ] && [ -L "$BIN/tripwire-create-fixture" ] ||
      fail "RUNTIME_INSTALL_CONFLICT: an existing launcher is not owned by PromptTripwire."
    TRIPWIRE_TARGET=$(readlink "$BIN/tripwire")
    FIXTURE_TARGET=$(readlink "$BIN/tripwire-create-fixture")
    UPGRADE_OLD_DEST=${TRIPWIRE_TARGET%/bin/tripwire}
    case "$UPGRADE_OLD_DEST" in
      "$PREFIX"/lib/prompt-tripwire/*) ;;
      *) fail "RUNTIME_INSTALL_CONFLICT: an existing launcher is not owned by PromptTripwire." ;;
    esac
    [ "$TRIPWIRE_TARGET" = "$UPGRADE_OLD_DEST/bin/tripwire" ] &&
      [ "$FIXTURE_TARGET" = "$UPGRADE_OLD_DEST/bin/create-judge-fixture" ] &&
      [ "$UPGRADE_OLD_DEST" != "$DEST" ] &&
      [ -d "$UPGRADE_OLD_DEST" ] && [ ! -L "$UPGRADE_OLD_DEST" ] &&
      [ -x "$UPGRADE_OLD_DEST/bin/tripwire" ] ||
      fail "RUNTIME_INSTALL_CONFLICT: the existing PromptTripwire install could not be verified."
    UPGRADE_OLD_VERSION=$(
      "$UPGRADE_OLD_DEST/bin/tripwire" --version 2>/dev/null
    ) || fail "RUNTIME_INSTALL_CONFLICT: the existing PromptTripwire runtime could not be verified."
    case "$UPGRADE_OLD_VERSION" in
      "prompt-tripwire "*) ;;
      *) fail "RUNTIME_INSTALL_CONFLICT: the existing PromptTripwire runtime could not be verified." ;;
    esac
  fi
  mkdir -p "$DEST" "$BIN"
  cp -R "$ROOT/bin" "$ROOT/payload" "$ROOT/judge" "$ROOT/docs" "$DEST/"
  cp "$ROOT/README.md" "$ROOT/JUDGE_GUIDE.md" "$ROOT/SECURITY.md" \
    "$ROOT/THIRD_PARTY_NOTICES.md" "$ROOT/RELEASE_NOTES.md" "$ROOT/LICENSE" "$DEST/"
  cp "$ROOT/uninstall.sh" "$DEST/uninstall.sh"
  if [ -n "$UPGRADE_OLD_DEST" ]; then
    rm "$BIN/tripwire" "$BIN/tripwire-create-fixture"
  fi
  ln -s "$DEST/bin/tripwire" "$BIN/tripwire"
  ln -s "$DEST/bin/create-judge-fixture" "$BIN/tripwire-create-fixture"
fi

if [ "$WITH_CODEX_PLUGIN" -eq 0 ]; then
  printf 'Installed PromptTripwire %s runtime. Add the user-local bin directory to PATH if needed.\n' "$VERSION"
  exit 0
fi

if [ -L "$BIN/tripwire" ]; then
  [ "$(readlink "$BIN/tripwire")" = "$DEST/bin/tripwire" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: the tripwire launcher points to another install."
else
  fail "RUNTIME_INSTALL_CONFLICT: the tripwire launcher is missing."
fi
if [ -L "$BIN/tripwire-create-fixture" ]; then
  [ "$(readlink "$BIN/tripwire-create-fixture")" = "$DEST/bin/create-judge-fixture" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: the fixture launcher points to another install."
else
  fail "RUNTIME_INSTALL_CONFLICT: the fixture launcher is missing."
fi

mkdir -p \
  "$DEST/.agents/plugins" \
  "$DEST/plugins/prompt-tripwire/.codex-plugin" \
  "$DEST/plugins/prompt-tripwire/skills/preflight/scripts"
cp "$ROOT/.agents/plugins/marketplace.json" "$DEST/.agents/plugins/marketplace.json"
cp "$ROOT/plugins/prompt-tripwire/.codex-plugin/plugin.json" \
  "$DEST/plugins/prompt-tripwire/.codex-plugin/plugin.json"
cp "$ROOT/plugins/prompt-tripwire/skills/preflight/SKILL.md" \
  "$DEST/plugins/prompt-tripwire/skills/preflight/SKILL.md"
cp "$ROOT/plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs" \
  "$DEST/plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs"
cp "$ROOT/uninstall.sh" "$DEST/uninstall.sh"
cp "$ROOT/README.md" "$ROOT/JUDGE_GUIDE.md" "$DEST/"
node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({runtime:process.argv[2]})+"\n",{mode:0o600})' \
  "$DEST/plugins/prompt-tripwire/runtime.json" "$DEST/bin/tripwire"
chmod 600 "$DEST/plugins/prompt-tripwire/runtime.json"
: > "$DEST/.codex-plugin-installing"
chmod 600 "$DEST/.codex-plugin-installing"

if ! MARKETPLACE_JSON=$("$CODEX" plugin marketplace list --json 2>/dev/null); then
  fail "CODEX_MARKETPLACE_LIST_FAILED: Codex marketplace state could not be read."
fi
if ! MARKETPLACE_ROOT=$(printf '%s' "$MARKETPLACE_JSON" | node -e '
  const fs=require("node:fs");
  const value=JSON.parse(fs.readFileSync(0,"utf8"));
  const entry=value.marketplaces?.find((item)=>item.name===process.argv[1]);
  if(entry?.root)process.stdout.write(entry.root);
' "$MARKETPLACE_NAME" 2>/dev/null); then
  fail "CODEX_MARKETPLACE_LIST_FAILED: Codex marketplace state was invalid."
fi

OLD_MARKETPLACE_ROOT=""
OLD_PLUGIN_INSTALLED=0
restore_old_marketplace() {
  if [ -n "$OLD_MARKETPLACE_ROOT" ] && [ -d "$OLD_MARKETPLACE_ROOT" ]; then
    "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 || true
    "$CODEX" plugin marketplace remove "$MARKETPLACE_NAME" --json >/dev/null 2>&1 || true
    "$CODEX" plugin marketplace add "$OLD_MARKETPLACE_ROOT" --json >/dev/null 2>&1 || true
    if [ "$OLD_PLUGIN_INSTALLED" -eq 1 ]; then
      "$CODEX" plugin add "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 || true
    fi
  fi
}
if [ -n "$MARKETPLACE_ROOT" ] && [ "$MARKETPLACE_ROOT" != "$DEST" ]; then
  OLD_MARKETPLACE_ROOT=$MARKETPLACE_ROOT
  if PLUGIN_JSON=$("$CODEX" plugin list --json 2>/dev/null); then
    if printf '%s' "$PLUGIN_JSON" | node -e '
      const fs=require("node:fs");
      const value=JSON.parse(fs.readFileSync(0,"utf8"));
      const entry=value.installed?.find((item)=>item.pluginId===process.argv[1]);
      process.exit(entry?.installed===true?0:1);
    ' "$PLUGIN_SELECTOR" 2>/dev/null
    then
      OLD_PLUGIN_INSTALLED=1
      "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 ||
        fail "CODEX_PLUGIN_REMOVE_FAILED: the prior PromptTripwire Plugin could not be removed."
    fi
  else
    fail "CODEX_PLUGIN_LIST_FAILED: Codex Plugin state could not be read."
  fi
  "$CODEX" plugin marketplace remove "$MARKETPLACE_NAME" --json >/dev/null 2>&1 ||
    fail "CODEX_MARKETPLACE_REMOVE_FAILED: the prior PromptTripwire marketplace could not be replaced."
  MARKETPLACE_ROOT=""
fi

if [ -z "$MARKETPLACE_ROOT" ]; then
  if ! "$CODEX" plugin marketplace add "$DEST" --json >/dev/null 2>&1; then
    restore_old_marketplace
    fail "CODEX_MARKETPLACE_ADD_FAILED: the PromptTripwire marketplace could not be registered."
  fi
fi

if ! "$CODEX" plugin add "$PLUGIN_SELECTOR" --json >/dev/null 2>&1; then
  restore_old_marketplace
  fail "CODEX_PLUGIN_ADD_FAILED: the PromptTripwire Plugin could not be installed."
fi
if ! PLUGIN_JSON=$("$CODEX" plugin list --json 2>/dev/null); then
  fail "CODEX_PLUGIN_LIST_FAILED: Codex Plugin state could not be verified."
fi
if ! printf '%s' "$PLUGIN_JSON" | node -e '
  const fs=require("node:fs");
  const value=JSON.parse(fs.readFileSync(0,"utf8"));
  const entry=value.installed?.find((item)=>item.pluginId===process.argv[1]);
  process.exit(entry?.installed===true&&entry?.enabled===true?0:1);
' "$PLUGIN_SELECTOR" 2>/dev/null
then
  restore_old_marketplace
  fail "CODEX_PLUGIN_VERIFY_FAILED: PromptTripwire is not installed and enabled."
fi

: > "$DEST/.codex-plugin-installed"
chmod 600 "$DEST/.codex-plugin-installed"
rm -f "$DEST/.codex-plugin-installing"
printf 'Installed PromptTripwire %s runtime and Codex Plugin.\n' "$VERSION"
printf 'Plugin: PromptTripwire; Skill: prompt-tripwire:preflight.\n'
