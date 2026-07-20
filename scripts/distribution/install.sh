#!/bin/sh
set -eu

VERSION="__PROMPT_TRIPWIRE_VERSION__"
PLUGIN_NAME="prompt-tripwire"
MARKETPLACE_NAME="prompt-tripwire-local"
PLUGIN_SELECTOR="$PLUGIN_NAME@$MARKETPLACE_NAME"
OWNER_MARKER=".prompt-tripwire-owned"
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
INSTALL_BASE="$PREFIX/lib/prompt-tripwire"
DEST="$INSTALL_BASE/$VERSION"
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
    fail "CODEX_NOT_FOUND: Codex CLI is required."
  CODEX_VERSION=$("$CODEX" --version 2>/dev/null) ||
    fail "CODEX_VERSION_CHECK_FAILED: Codex CLI version could not be read."
  case "$CODEX_VERSION" in
    "codex-cli "?*) ;;
    *) fail "CODEX_VERSION_CHECK_FAILED: Codex CLI version output was invalid." ;;
  esac
  "$CODEX" login status >/dev/null 2>&1 ||
    fail "CODEX_LOGIN_REQUIRED: sign in with the normal Codex login flow."
  RUNTIME_VERSION=$("$ROOT/bin/tripwire" --version 2>/dev/null) ||
    fail "RUNTIME_VERSION_CHECK_FAILED: the bundled runtime could not be started."
  [ "$RUNTIME_VERSION" = "prompt-tripwire $VERSION" ] ||
    fail "RUNTIME_VERSION_MISMATCH: the bundled PromptTripwire runtime is incompatible."
fi

DEST_EXISTED=0
if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  [ "$WITH_CODEX_PLUGIN" -eq 1 ] ||
    fail "RUNTIME_ALREADY_INSTALLED: PromptTripwire is already installed."
  [ -d "$DEST" ] && [ ! -L "$DEST" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing install root is not a directory owned by PromptTripwire."
  [ -f "$DEST/$OWNER_MARKER" ] && [ ! -L "$DEST/$OWNER_MARKER" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing install root has no valid ownership marker."
  OWNER_MARKER_MODE=$(/usr/bin/stat -f '%Lp' "$DEST/$OWNER_MARKER" 2>/dev/null) ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing install root ownership marker could not be verified."
  [ "$OWNER_MARKER_MODE" = "600" ] &&
    [ "$(cat "$DEST/$OWNER_MARKER" 2>/dev/null)" = "prompt-tripwire $VERSION" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing install root ownership marker is invalid."
  [ -x "$DEST/bin/tripwire" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing install root is not PromptTripwire."
  INSTALLED_VERSION=$("$DEST/bin/tripwire" --version 2>/dev/null) ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing runtime could not be verified."
  [ "$INSTALLED_VERSION" = "prompt-tripwire $VERSION" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: a different runtime version is installed."
  DEST_EXISTED=1
fi

OLD_TRIPWIRE_TARGET=""
OLD_FIXTURE_TARGET=""
if [ -e "$BIN/tripwire" ] || [ -L "$BIN/tripwire" ] ||
  [ -e "$BIN/tripwire-create-fixture" ] || [ -L "$BIN/tripwire-create-fixture" ]
then
  [ -L "$BIN/tripwire" ] && [ -L "$BIN/tripwire-create-fixture" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: an existing launcher is not owned by PromptTripwire."
  OLD_TRIPWIRE_TARGET=$(readlink "$BIN/tripwire" 2>/dev/null)
  OLD_FIXTURE_TARGET=$(readlink "$BIN/tripwire-create-fixture" 2>/dev/null)
  OLD_LAUNCHER_DEST=${OLD_TRIPWIRE_TARGET%/bin/tripwire}
  case "$OLD_LAUNCHER_DEST" in
    "$PREFIX"/lib/prompt-tripwire/*) ;;
    *) fail "RUNTIME_INSTALL_CONFLICT: an existing launcher is not owned by PromptTripwire." ;;
  esac
  [ "$OLD_TRIPWIRE_TARGET" = "$OLD_LAUNCHER_DEST/bin/tripwire" ] &&
    [ "$OLD_FIXTURE_TARGET" = "$OLD_LAUNCHER_DEST/bin/create-judge-fixture" ] &&
    [ -d "$OLD_LAUNCHER_DEST" ] && [ ! -L "$OLD_LAUNCHER_DEST" ] &&
    [ -x "$OLD_LAUNCHER_DEST/bin/tripwire" ] ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing PromptTripwire install could not be verified."
  OLD_LAUNCHER_VERSION=$("$OLD_LAUNCHER_DEST/bin/tripwire" --version 2>/dev/null) ||
    fail "RUNTIME_INSTALL_CONFLICT: the existing PromptTripwire runtime could not be verified."
  case "$OLD_LAUNCHER_VERSION" in
    "prompt-tripwire "*) ;;
    *) fail "RUNTIME_INSTALL_CONFLICT: the existing PromptTripwire runtime could not be verified." ;;
  esac
fi

OLD_MARKETPLACE_ROOT=""
OLD_PLUGIN_INSTALLED=0
OLD_PLUGIN_ENABLED=0
if [ "$WITH_CODEX_PLUGIN" -eq 1 ]; then
  MARKETPLACE_JSON=$("$CODEX" plugin marketplace list --json 2>/dev/null) ||
    fail "CODEX_MARKETPLACE_LIST_FAILED: Codex marketplace state could not be read."
  OLD_MARKETPLACE_ROOT=$(printf '%s' "$MARKETPLACE_JSON" | node -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(0,"utf8"));
    const entry=value.marketplaces?.find((item)=>item.name===process.argv[1]);
    if(entry?.root)process.stdout.write(entry.root);
  ' "$MARKETPLACE_NAME" 2>/dev/null) ||
    fail "CODEX_MARKETPLACE_LIST_FAILED: Codex marketplace state was invalid."
  PLUGIN_JSON=$("$CODEX" plugin list --json 2>/dev/null) ||
    fail "CODEX_PLUGIN_LIST_FAILED: Codex Plugin state could not be read."
  PLUGIN_STATE=$(printf '%s' "$PLUGIN_JSON" | node -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(0,"utf8"));
    const entry=value.installed?.find((item)=>item.pluginId===process.argv[1]);
    process.stdout.write(`${entry?.installed===true?1:0} ${entry?.enabled===true?1:0}`);
  ' "$PLUGIN_SELECTOR" 2>/dev/null) ||
    fail "CODEX_PLUGIN_LIST_FAILED: Codex Plugin state was invalid."
  OLD_PLUGIN_INSTALLED=${PLUGIN_STATE%% *}
  OLD_PLUGIN_ENABLED=${PLUGIN_STATE#* }
  if [ "$OLD_PLUGIN_INSTALLED" -eq 1 ] && [ "$OLD_PLUGIN_ENABLED" -ne 1 ]; then
    fail "CODEX_PLUGIN_STATE_UNSUPPORTED: the disabled prior PromptTripwire Plugin cannot be transactionally replaced."
  fi
  if [ "$OLD_PLUGIN_INSTALLED" -eq 1 ] && [ -z "$OLD_MARKETPLACE_ROOT" ]; then
    fail "CODEX_PLUGIN_STATE_INVALID: the prior PromptTripwire Plugin has no marketplace root."
  fi
  if [ -n "$OLD_MARKETPLACE_ROOT" ]; then
    [ -d "$OLD_MARKETPLACE_ROOT" ] ||
      fail "CODEX_MARKETPLACE_STATE_INVALID: the prior PromptTripwire marketplace root is unavailable."
  fi

  INSTALLED_PLUGIN_COMPLETE=1
  INSTALLED_RUNTIME_PATH=""
  if [ ! -f "$DEST/plugins/prompt-tripwire/runtime.json" ] ||
    [ -L "$DEST/plugins/prompt-tripwire/runtime.json" ]
  then
    INSTALLED_PLUGIN_COMPLETE=0
  fi
  for safety_file_pair in \
    ".agents/plugins/marketplace.json" \
    "plugins/prompt-tripwire/.codex-plugin/plugin.json" \
    "plugins/prompt-tripwire/skills/preflight/SKILL.md" \
    "plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs"
  do
    installed_safety_file="$DEST/$safety_file_pair"
    bundled_safety_file="$ROOT/$safety_file_pair"
    if [ ! -f "$installed_safety_file" ] || [ -L "$installed_safety_file" ] ||
      ! cmp -s "$installed_safety_file" "$bundled_safety_file"
    then
      INSTALLED_PLUGIN_COMPLETE=0
    fi
  done
  if [ "$INSTALLED_PLUGIN_COMPLETE" -eq 1 ]; then
    INSTALLED_RUNTIME_PATH=$(node -e '
      const fs=require("node:fs");
      const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      if(typeof value.runtime!=="string")process.exit(1);
      process.stdout.write(value.runtime);
    ' "$DEST/plugins/prompt-tripwire/runtime.json" 2>/dev/null) || INSTALLED_PLUGIN_COMPLETE=0
    if [ "$INSTALLED_PLUGIN_COMPLETE" -eq 1 ] &&
      [ "$INSTALLED_RUNTIME_PATH" != "$DEST/bin/tripwire" ]
    then
      INSTALLED_PLUGIN_COMPLETE=0
    fi
  fi

  if [ "$DEST_EXISTED" -eq 1 ] &&
    [ "$OLD_TRIPWIRE_TARGET" = "$DEST/bin/tripwire" ] &&
    [ "$OLD_FIXTURE_TARGET" = "$DEST/bin/create-judge-fixture" ] &&
    [ "$OLD_MARKETPLACE_ROOT" = "$DEST" ] &&
    [ "$OLD_PLUGIN_INSTALLED" -eq 1 ] && [ "$OLD_PLUGIN_ENABLED" -eq 1 ] &&
    [ "$INSTALLED_PLUGIN_COMPLETE" -eq 1 ] &&
    [ -f "$DEST/.codex-plugin-installed" ] && [ ! -L "$DEST/.codex-plugin-installed" ] &&
    [ ! -e "$DEST/.codex-plugin-installing" ] && [ ! -L "$DEST/.codex-plugin-installing" ]
  then
    printf 'PromptTripwire %s runtime and Codex Plugin are already installed.\n' "$VERSION"
    printf 'Plugin: PromptTripwire; Skill: prompt-tripwire:preflight.\n'
    exit 0
  fi
fi

STAGE=""
BACKUP=""
DEST_BACKED_UP=0
LOCAL_SWITCHED=0
EXTERNAL_MUTATED=0
TRANSACTION_ACTIVE=1
ERROR_MESSAGE=""
PREFIX_EXISTED=0
LIB_EXISTED=0
INSTALL_BASE_EXISTED=0
BIN_EXISTED=0
[ -d "$PREFIX" ] && PREFIX_EXISTED=1
[ -d "$PREFIX/lib" ] && LIB_EXISTED=1
[ -d "$INSTALL_BASE" ] && INSTALL_BASE_EXISTED=1
[ -d "$BIN" ] && BIN_EXISTED=1

read_marketplace_root() {
  rollback_marketplace_json=$("$CODEX" plugin marketplace list --json 2>/dev/null) || return 1
  printf '%s' "$rollback_marketplace_json" | node -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(0,"utf8"));
    const entry=value.marketplaces?.find((item)=>item.name===process.argv[1]);
    if(entry?.root)process.stdout.write(entry.root);
  ' "$MARKETPLACE_NAME" 2>/dev/null
}

read_plugin_state() {
  rollback_plugin_json=$("$CODEX" plugin list --json 2>/dev/null) || return 1
  printf '%s' "$rollback_plugin_json" | node -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(0,"utf8"));
    const entry=value.installed?.find((item)=>item.pluginId===process.argv[1]);
    process.stdout.write(`${entry?.installed===true?1:0} ${entry?.enabled===true?1:0}`);
  ' "$PLUGIN_SELECTOR" 2>/dev/null
}

atomic_link() {
  link_path=$1
  link_target=$2
  link_tmp="$link_path.prompt-tripwire-$$"
  rm -f "$link_tmp" 2>/dev/null || return 1
  ln -s "$link_target" "$link_tmp" 2>/dev/null || return 1
  mv -f "$link_tmp" "$link_path" 2>/dev/null || {
    rm -f "$link_tmp" 2>/dev/null
    return 1
  }
}

rollback_external() {
  current_marketplace_root=$(read_marketplace_root) || return 1
  current_plugin_state=$(read_plugin_state) || return 1
  current_plugin_installed=${current_plugin_state%% *}

  if [ "$current_plugin_installed" -eq 1 ] && [ "$OLD_PLUGIN_INSTALLED" -eq 0 ]; then
    "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 || return 1
  elif [ "$current_plugin_installed" -eq 1 ] && [ "$current_marketplace_root" != "$OLD_MARKETPLACE_ROOT" ]; then
    "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 || return 1
  fi

  current_marketplace_root=$(read_marketplace_root) || return 1
  if [ "$current_marketplace_root" = "$DEST" ] && [ "$current_marketplace_root" != "$OLD_MARKETPLACE_ROOT" ]; then
    "$CODEX" plugin marketplace remove "$MARKETPLACE_NAME" --json >/dev/null 2>&1 || return 1
    current_marketplace_root=""
  fi
  if [ "$current_marketplace_root" != "$OLD_MARKETPLACE_ROOT" ]; then
    [ -z "$current_marketplace_root" ] || return 1
    if [ -n "$OLD_MARKETPLACE_ROOT" ]; then
      "$CODEX" plugin marketplace add "$OLD_MARKETPLACE_ROOT" --json >/dev/null 2>&1 || return 1
    fi
  fi

  current_plugin_state=$(read_plugin_state) || return 1
  current_plugin_installed=${current_plugin_state%% *}
  if [ "$OLD_PLUGIN_INSTALLED" -eq 1 ] && [ "$current_plugin_installed" -eq 0 ]; then
    "$CODEX" plugin add "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 || return 1
  elif [ "$OLD_PLUGIN_INSTALLED" -eq 0 ] && [ "$current_plugin_installed" -eq 1 ]; then
    "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 || return 1
  fi

  current_marketplace_root=$(read_marketplace_root) || return 1
  current_plugin_state=$(read_plugin_state) || return 1
  [ "$current_marketplace_root" = "$OLD_MARKETPLACE_ROOT" ] || return 1
  [ "${current_plugin_state%% *}" -eq "$OLD_PLUGIN_INSTALLED" ] || return 1
  if [ "$OLD_PLUGIN_INSTALLED" -eq 1 ]; then
    [ "${current_plugin_state#* }" -eq "$OLD_PLUGIN_ENABLED" ] || return 1
  fi
}

rollback_local() {
  if [ -n "$OLD_TRIPWIRE_TARGET" ]; then
    atomic_link "$BIN/tripwire" "$OLD_TRIPWIRE_TARGET" || return 1
    atomic_link "$BIN/tripwire-create-fixture" "$OLD_FIXTURE_TARGET" || return 1
  else
    if [ -L "$BIN/tripwire" ] && [ "$(readlink "$BIN/tripwire" 2>/dev/null)" = "$DEST/bin/tripwire" ]; then
      rm "$BIN/tripwire" 2>/dev/null || return 1
    elif [ -e "$BIN/tripwire" ] || [ -L "$BIN/tripwire" ]; then
      return 1
    fi
    if [ -L "$BIN/tripwire-create-fixture" ] &&
      [ "$(readlink "$BIN/tripwire-create-fixture" 2>/dev/null)" = "$DEST/bin/create-judge-fixture" ]
    then
      rm "$BIN/tripwire-create-fixture" 2>/dev/null || return 1
    elif [ -e "$BIN/tripwire-create-fixture" ] || [ -L "$BIN/tripwire-create-fixture" ]; then
      return 1
    fi
  fi

  if [ "$LOCAL_SWITCHED" -eq 1 ]; then
    [ -d "$DEST" ] && [ ! -L "$DEST" ] || return 1
    [ -f "$DEST/$OWNER_MARKER" ] || return 1
    rm -rf "$DEST" 2>/dev/null || return 1
  fi
  if [ "$DEST_BACKED_UP" -eq 1 ]; then
    [ ! -e "$DEST" ] && [ ! -L "$DEST" ] || return 1
    [ -d "$BACKUP" ] && [ ! -L "$BACKUP" ] || return 1
    mv "$BACKUP" "$DEST" 2>/dev/null || return 1
    BACKUP=""
    DEST_BACKED_UP=0
  fi
}

cleanup_paths() {
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then
    rm -rf "$STAGE" 2>/dev/null
  fi
  if [ "$DEST_BACKED_UP" -eq 0 ] && [ -n "$BACKUP" ] && [ -d "$BACKUP" ]; then
    rm -rf "$BACKUP" 2>/dev/null
  fi
}

cleanup_created_directories() {
  if [ "$BIN_EXISTED" -eq 0 ] && [ -d "$BIN" ]; then
    rmdir "$BIN" 2>/dev/null || return 1
  fi
  if [ "$INSTALL_BASE_EXISTED" -eq 0 ] && [ -d "$INSTALL_BASE" ]; then
    rmdir "$INSTALL_BASE" 2>/dev/null || return 1
  fi
  if [ "$LIB_EXISTED" -eq 0 ] && [ -d "$PREFIX/lib" ]; then
    rmdir "$PREFIX/lib" 2>/dev/null || return 1
  fi
  if [ "$PREFIX_EXISTED" -eq 0 ] && [ -d "$PREFIX" ]; then
    rmdir "$PREFIX" 2>/dev/null || return 1
  fi
}

finish_transaction() {
  status=$?
  trap - EXIT INT TERM HUP
  rollback_ok=1
  if [ "$status" -ne 0 ] && [ "$TRANSACTION_ACTIVE" -eq 1 ]; then
    if [ "$EXTERNAL_MUTATED" -eq 1 ]; then
      rollback_external || rollback_ok=0
    fi
    if [ "$rollback_ok" -eq 1 ]; then
      rollback_local || rollback_ok=0
    fi
  fi
  cleanup_paths
  if [ "$status" -ne 0 ] && [ "$rollback_ok" -eq 1 ]; then
    cleanup_created_directories || rollback_ok=0
  fi
  if [ "$status" -ne 0 ]; then
    if [ "$rollback_ok" -ne 1 ]; then
      printf '%s\n' "ROLLBACK_INCOMPLETE: PromptTripwire retained the last safe install root; review Codex Plugin state before retrying." >&2
    fi
    if [ -n "$ERROR_MESSAGE" ]; then
      printf '%s\n' "$ERROR_MESSAGE" >&2
    else
      printf '%s\n' "INSTALL_FAILED: PromptTripwire installation did not complete." >&2
    fi
  fi
  exit "$status"
}

abort_transaction() {
  ERROR_MESSAGE=$1
  exit 1
}

trap finish_transaction EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

mkdir -p "$INSTALL_BASE" "$BIN" 2>/dev/null
STAGE=$(mktemp -d "$INSTALL_BASE/.install-$VERSION.XXXXXX" 2>/dev/null)
cp -R "$ROOT/bin" "$ROOT/payload" "$ROOT/judge" "$ROOT/docs" "$STAGE/" 2>/dev/null
cp "$ROOT/README.md" "$ROOT/JUDGE_GUIDE.md" "$ROOT/SECURITY.md" \
  "$ROOT/THIRD_PARTY_NOTICES.md" "$ROOT/RELEASE_NOTES.md" "$ROOT/LICENSE" "$STAGE/" 2>/dev/null
cp "$ROOT/uninstall.sh" "$STAGE/uninstall.sh" 2>/dev/null
printf 'prompt-tripwire %s\n' "$VERSION" 2>/dev/null > "$STAGE/$OWNER_MARKER"
chmod 600 "$STAGE/$OWNER_MARKER" 2>/dev/null

if [ "$WITH_CODEX_PLUGIN" -eq 1 ]; then
  mkdir -p \
    "$STAGE/.agents/plugins" \
    "$STAGE/plugins/prompt-tripwire/.codex-plugin" \
    "$STAGE/plugins/prompt-tripwire/skills/preflight/scripts" 2>/dev/null
  cp "$ROOT/.agents/plugins/marketplace.json" "$STAGE/.agents/plugins/marketplace.json" 2>/dev/null
  cp "$ROOT/plugins/prompt-tripwire/.codex-plugin/plugin.json" \
    "$STAGE/plugins/prompt-tripwire/.codex-plugin/plugin.json" 2>/dev/null
  cp "$ROOT/plugins/prompt-tripwire/skills/preflight/SKILL.md" \
    "$STAGE/plugins/prompt-tripwire/skills/preflight/SKILL.md" 2>/dev/null
  cp "$ROOT/plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs" \
    "$STAGE/plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs" 2>/dev/null
  node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({runtime:process.argv[2]})+"\n",{mode:0o600})' \
    "$STAGE/plugins/prompt-tripwire/runtime.json" "$DEST/bin/tripwire" 2>/dev/null
  chmod 600 "$STAGE/plugins/prompt-tripwire/runtime.json" 2>/dev/null
  : 2>/dev/null > "$STAGE/.codex-plugin-installing"
  chmod 600 "$STAGE/.codex-plugin-installing" 2>/dev/null
fi

if [ "$DEST_EXISTED" -eq 1 ]; then
  BACKUP=$(mktemp -d "$INSTALL_BASE/.rollback-$VERSION.XXXXXX" 2>/dev/null)
  rmdir "$BACKUP" 2>/dev/null
  mv "$DEST" "$BACKUP" 2>/dev/null
  DEST_BACKED_UP=1
fi
mv "$STAGE" "$DEST" 2>/dev/null
STAGE=""
LOCAL_SWITCHED=1
atomic_link "$BIN/tripwire" "$DEST/bin/tripwire" ||
  abort_transaction "RUNTIME_INSTALL_FAILED: the tripwire launcher could not be installed."
atomic_link "$BIN/tripwire-create-fixture" "$DEST/bin/create-judge-fixture" ||
  abort_transaction "RUNTIME_INSTALL_FAILED: the fixture launcher could not be installed."

if [ "$WITH_CODEX_PLUGIN" -eq 0 ]; then
  [ -z "$BACKUP" ] || rm -rf "$BACKUP" 2>/dev/null
  BACKUP=""
  DEST_BACKED_UP=0
  TRANSACTION_ACTIVE=0
  printf 'Installed PromptTripwire %s runtime. Add the user-local bin directory to PATH if needed.\n' "$VERSION"
  exit 0
fi

CURRENT_MARKETPLACE_ROOT=$OLD_MARKETPLACE_ROOT
CURRENT_PLUGIN_INSTALLED=$OLD_PLUGIN_INSTALLED
if [ -n "$CURRENT_MARKETPLACE_ROOT" ] && [ "$CURRENT_MARKETPLACE_ROOT" != "$DEST" ]; then
  if [ "$CURRENT_PLUGIN_INSTALLED" -eq 1 ]; then
    EXTERNAL_MUTATED=1
    "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 ||
      abort_transaction "CODEX_PLUGIN_REMOVE_FAILED: the prior PromptTripwire Plugin could not be removed."
    CURRENT_PLUGIN_INSTALLED=0
  fi
  EXTERNAL_MUTATED=1
  "$CODEX" plugin marketplace remove "$MARKETPLACE_NAME" --json >/dev/null 2>&1 ||
    abort_transaction "CODEX_MARKETPLACE_REMOVE_FAILED: the prior PromptTripwire marketplace could not be replaced."
  CURRENT_MARKETPLACE_ROOT=""
fi

if [ -z "$CURRENT_MARKETPLACE_ROOT" ]; then
  EXTERNAL_MUTATED=1
  "$CODEX" plugin marketplace add "$DEST" --json >/dev/null 2>&1 ||
    abort_transaction "CODEX_MARKETPLACE_ADD_FAILED: the PromptTripwire marketplace could not be registered."
  CURRENT_MARKETPLACE_ROOT=$DEST
fi

if [ "$CURRENT_PLUGIN_INSTALLED" -eq 0 ]; then
  EXTERNAL_MUTATED=1
  "$CODEX" plugin add "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 ||
    abort_transaction "CODEX_PLUGIN_ADD_FAILED: the PromptTripwire Plugin could not be installed."
fi

VERIFIED_MARKETPLACE_ROOT=$(read_marketplace_root) ||
  abort_transaction "CODEX_MARKETPLACE_LIST_FAILED: Codex marketplace state could not be verified."
[ "$VERIFIED_MARKETPLACE_ROOT" = "$DEST" ] ||
  abort_transaction "CODEX_MARKETPLACE_VERIFY_FAILED: PromptTripwire marketplace does not point to the installed runtime."
VERIFIED_PLUGIN_STATE=$(read_plugin_state) ||
  abort_transaction "CODEX_PLUGIN_LIST_FAILED: Codex Plugin state could not be verified."
[ "${VERIFIED_PLUGIN_STATE%% *}" -eq 1 ] && [ "${VERIFIED_PLUGIN_STATE#* }" -eq 1 ] ||
  abort_transaction "CODEX_PLUGIN_VERIFY_FAILED: PromptTripwire is not installed and enabled."

: 2>/dev/null > "$DEST/.codex-plugin-installed"
chmod 600 "$DEST/.codex-plugin-installed" 2>/dev/null
rm -f "$DEST/.codex-plugin-installing" 2>/dev/null
[ -z "$BACKUP" ] || rm -rf "$BACKUP" 2>/dev/null
BACKUP=""
DEST_BACKED_UP=0
TRANSACTION_ACTIVE=0
printf 'Installed PromptTripwire %s runtime and Codex Plugin.\n' "$VERSION"
printf 'Plugin: PromptTripwire; Skill: prompt-tripwire:preflight.\n'
