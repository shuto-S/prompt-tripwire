#!/bin/sh
set -eu

VERSION="__PROMPT_TRIPWIRE_VERSION__"
REQUIRED_CODEX_VERSION="0.144.4"
MARKETPLACE_NAME="prompt-tripwire-local"
PLUGIN_SELECTOR="prompt-tripwire@$MARKETPLACE_NAME"
WITH_CODEX_PLUGIN=0

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

case "${1:-}" in
  "") ;;
  --with-codex-plugin) WITH_CODEX_PLUGIN=1 ;;
  *) fail "INVALID_ARGUMENT: use uninstall.sh [--with-codex-plugin]." ;;
esac
[ "$#" -le 1 ] || fail "INVALID_ARGUMENT: use uninstall.sh [--with-codex-plugin]."

PREFIX=${PROMPT_TRIPWIRE_PREFIX:-"$HOME/.local"}
case "$PREFIX" in
  /*) ;;
  *) PREFIX="$PWD/$PREFIX" ;;
esac
DEST="$PREFIX/lib/prompt-tripwire/$VERSION"
BIN="$PREFIX/bin"
CODEX=${PROMPT_TRIPWIRE_CODEX_BIN:-codex}

if [ "$WITH_CODEX_PLUGIN" -eq 0 ] && { [ -f "$DEST/.codex-plugin-installed" ] || [ -f "$DEST/.codex-plugin-installing" ]; }; then
  fail "CODEX_PLUGIN_INSTALLED: rerun uninstall.sh with --with-codex-plugin."
fi

if [ "$WITH_CODEX_PLUGIN" -eq 1 ]; then
  command -v node >/dev/null 2>&1 || fail "NODE_NOT_FOUND: Node.js is required for Plugin removal."
  command -v "$CODEX" >/dev/null 2>&1 ||
    fail "CODEX_NOT_FOUND: Codex CLI 0.144.4 is required for Plugin removal."
  CODEX_VERSION=$("$CODEX" --version 2>/dev/null) ||
    fail "CODEX_VERSION_CHECK_FAILED: Codex CLI version could not be read."
  [ "$CODEX_VERSION" = "codex-cli $REQUIRED_CODEX_VERSION" ] ||
    fail "CODEX_VERSION_MISMATCH: Codex CLI 0.144.4 is required for Plugin removal."

  if ! PLUGIN_JSON=$("$CODEX" plugin list --json 2>/dev/null); then
    fail "CODEX_PLUGIN_LIST_FAILED: Codex Plugin state could not be read."
  fi
  if printf '%s' "$PLUGIN_JSON" | node -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(0,"utf8"));
    const entry=value.installed?.find((item)=>item.pluginId===process.argv[1]);
    process.exit(entry?.installed===true?0:1);
  ' "$PLUGIN_SELECTOR" 2>/dev/null
  then
    "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 ||
      fail "CODEX_PLUGIN_REMOVE_FAILED: PromptTripwire Plugin could not be removed."
    printf 'Plugin: removed prompt-tripwire@prompt-tripwire-local.\n'
  else
    printf 'Plugin: already absent.\n'
  fi

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
  if [ "$MARKETPLACE_ROOT" = "$DEST" ]; then
    "$CODEX" plugin marketplace remove "$MARKETPLACE_NAME" --json >/dev/null 2>&1 ||
      fail "CODEX_MARKETPLACE_REMOVE_FAILED: PromptTripwire marketplace could not be removed."
    printf 'Marketplace: removed prompt-tripwire-local.\n'
  elif [ -n "$MARKETPLACE_ROOT" ]; then
    printf 'Marketplace: preserved because prompt-tripwire-local is configured elsewhere.\n'
  else
    printf 'Marketplace: already absent.\n'
  fi
fi

if [ -L "$BIN/tripwire" ] && [ "$(readlink "$BIN/tripwire")" = "$DEST/bin/tripwire" ]; then
  rm "$BIN/tripwire"
fi
if [ -L "$BIN/tripwire-create-fixture" ] && [ "$(readlink "$BIN/tripwire-create-fixture")" = "$DEST/bin/create-judge-fixture" ]; then
  rm "$BIN/tripwire-create-fixture"
fi
if [ -e "$DEST" ]; then
  rm -rf "$DEST"
  printf 'Runtime: removed PromptTripwire %s.\n' "$VERSION"
else
  printf 'Runtime: already absent.\n'
fi
