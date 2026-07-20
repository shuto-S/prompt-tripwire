#!/bin/sh
set -eu

VERSION="__PROMPT_TRIPWIRE_VERSION__"
MARKETPLACE_NAME="prompt-tripwire-local"
PLUGIN_SELECTOR="prompt-tripwire@$MARKETPLACE_NAME"
OWNER_MARKER=".prompt-tripwire-owned"
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
INSTALL_BASE="$PREFIX/lib/prompt-tripwire"
DEST="$INSTALL_BASE/$VERSION"
BIN="$PREFIX/bin"
CODEX=${PROMPT_TRIPWIRE_CODEX_BIN:-codex}

DEST_PRESENT=0
if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  [ -d "$DEST" ] && [ ! -L "$DEST" ] ||
    fail "RUNTIME_UNINSTALL_CONFLICT: the install root is not an owned PromptTripwire directory."
  [ -f "$DEST/$OWNER_MARKER" ] && [ ! -L "$DEST/$OWNER_MARKER" ] ||
    fail "RUNTIME_UNINSTALL_CONFLICT: the install root has no PromptTripwire ownership marker."
  OWNER_MARKER_MODE=$(/usr/bin/stat -f '%Lp' "$DEST/$OWNER_MARKER" 2>/dev/null) ||
    fail "RUNTIME_UNINSTALL_CONFLICT: the install root ownership marker could not be verified."
  [ "$OWNER_MARKER_MODE" = "600" ] &&
    [ "$(cat "$DEST/$OWNER_MARKER" 2>/dev/null)" = "prompt-tripwire $VERSION" ] ||
    fail "RUNTIME_UNINSTALL_CONFLICT: the install root ownership marker is invalid."
  [ -x "$DEST/bin/tripwire" ] ||
    fail "RUNTIME_UNINSTALL_CONFLICT: the installed PromptTripwire runtime is incomplete."
  INSTALLED_VERSION=$("$DEST/bin/tripwire" --version 2>/dev/null) ||
    fail "RUNTIME_UNINSTALL_CONFLICT: the installed PromptTripwire runtime could not be verified."
  [ "$INSTALLED_VERSION" = "prompt-tripwire $VERSION" ] ||
    fail "RUNTIME_UNINSTALL_CONFLICT: the installed PromptTripwire runtime version does not match."
  DEST_PRESENT=1
fi

if [ "$WITH_CODEX_PLUGIN" -eq 0 ] && [ "$DEST_PRESENT" -eq 1 ] &&
  { [ -f "$DEST/.codex-plugin-installed" ] || [ -f "$DEST/.codex-plugin-installing" ]; }
then
  fail "CODEX_PLUGIN_INSTALLED: rerun uninstall.sh with --with-codex-plugin."
fi

TRIPWIRE_LINK_OWNED=0
FIXTURE_LINK_OWNED=0
if [ -L "$BIN/tripwire" ] && [ "$(readlink "$BIN/tripwire" 2>/dev/null)" = "$DEST/bin/tripwire" ]; then
  TRIPWIRE_LINK_OWNED=1
fi
if [ -L "$BIN/tripwire-create-fixture" ] &&
  [ "$(readlink "$BIN/tripwire-create-fixture" 2>/dev/null)" = "$DEST/bin/create-judge-fixture" ]
then
  FIXTURE_LINK_OWNED=1
fi

PLUGIN_INSTALLED=0
PLUGIN_ENABLED=0
MARKETPLACE_ROOT=""
CODEX_REGISTRATION_UNVERIFIED=0
if [ "$WITH_CODEX_PLUGIN" -eq 1 ]; then
  command -v node >/dev/null 2>&1 || fail "NODE_NOT_FOUND: Node.js is required for Plugin removal."
  if ! command -v "$CODEX" >/dev/null 2>&1; then
    CODEX_REGISTRATION_UNVERIFIED=1
  fi

  if [ "$CODEX_REGISTRATION_UNVERIFIED" -eq 0 ]; then
    PLUGIN_JSON=$("$CODEX" plugin list --json 2>/dev/null) ||
    fail "CODEX_PLUGIN_LIST_FAILED: Codex Plugin state could not be read."
  PLUGIN_STATE=$(printf '%s' "$PLUGIN_JSON" | node -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(0,"utf8"));
    const entry=value.installed?.find((item)=>item.pluginId===process.argv[1]);
    process.stdout.write(`${entry?.installed===true?1:0} ${entry?.enabled===true?1:0}`);
  ' "$PLUGIN_SELECTOR" 2>/dev/null) ||
    fail "CODEX_PLUGIN_LIST_FAILED: Codex Plugin state was invalid."
  PLUGIN_INSTALLED=${PLUGIN_STATE%% *}
  PLUGIN_ENABLED=${PLUGIN_STATE#* }

  MARKETPLACE_JSON=$("$CODEX" plugin marketplace list --json 2>/dev/null) ||
    fail "CODEX_MARKETPLACE_LIST_FAILED: Codex marketplace state could not be read."
  MARKETPLACE_ROOT=$(printf '%s' "$MARKETPLACE_JSON" | node -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(0,"utf8"));
    const entry=value.marketplaces?.find((item)=>item.name===process.argv[1]);
    if(entry?.root)process.stdout.write(entry.root);
  ' "$MARKETPLACE_NAME" 2>/dev/null) ||
    fail "CODEX_MARKETPLACE_LIST_FAILED: Codex marketplace state was invalid."

  if [ "$PLUGIN_INSTALLED" -eq 1 ] && [ -z "$MARKETPLACE_ROOT" ]; then
    fail "CODEX_PLUGIN_STATE_INVALID: the installed PromptTripwire Plugin has no marketplace root."
  fi
  if [ "$MARKETPLACE_ROOT" = "$DEST" ] && [ "$DEST_PRESENT" -eq 0 ]; then
    fail "CODEX_MARKETPLACE_STATE_INVALID: the PromptTripwire marketplace root is unavailable."
  fi
  if [ "$MARKETPLACE_ROOT" = "$DEST" ] && [ "$PLUGIN_INSTALLED" -eq 1 ] &&
    [ "$PLUGIN_ENABLED" -ne 1 ]
  then
    fail "CODEX_PLUGIN_STATE_UNSUPPORTED: the disabled PromptTripwire Plugin cannot be transactionally removed."
  fi
  fi
fi

BACKUP_PARENT=""
BACKUP_RUNTIME=""
LOCAL_MUTATED=0
EXTERNAL_MUTATED=0
TRANSACTION_ACTIVE=0
ERROR_MESSAGE=""

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

restore_link() {
  restore_path=$1
  restore_target=$2
  if [ -L "$restore_path" ] && [ "$(readlink "$restore_path" 2>/dev/null)" = "$restore_target" ]; then
    return 0
  fi
  [ ! -e "$restore_path" ] && [ ! -L "$restore_path" ] || return 1
  ln -s "$restore_target" "$restore_path" 2>/dev/null
}

rollback_local() {
  if [ "$DEST_PRESENT" -eq 1 ]; then
    [ -d "$BACKUP_RUNTIME" ] && [ ! -L "$BACKUP_RUNTIME" ] || return 1
    if [ -e "$DEST" ] || [ -L "$DEST" ]; then
      [ -d "$DEST" ] && [ ! -L "$DEST" ] || return 1
      rm -rf "$DEST" 2>/dev/null || return 1
    fi
    cp -Rp "$BACKUP_RUNTIME" "$DEST" 2>/dev/null || return 1
    [ -f "$DEST/$OWNER_MARKER" ] && [ ! -L "$DEST/$OWNER_MARKER" ] || return 1
    [ "$(cat "$DEST/$OWNER_MARKER" 2>/dev/null)" = "prompt-tripwire $VERSION" ] || return 1
    [ "$("$DEST/bin/tripwire" --version 2>/dev/null)" = "prompt-tripwire $VERSION" ] || return 1
  elif [ -e "$DEST" ] || [ -L "$DEST" ]; then
    return 1
  fi

  if [ "$TRIPWIRE_LINK_OWNED" -eq 1 ]; then
    restore_link "$BIN/tripwire" "$DEST/bin/tripwire" || return 1
  fi
  if [ "$FIXTURE_LINK_OWNED" -eq 1 ]; then
    restore_link "$BIN/tripwire-create-fixture" "$DEST/bin/create-judge-fixture" || return 1
  fi
}

rollback_external() {
  current_plugin_state=$(read_plugin_state) || return 1
  current_plugin_installed=${current_plugin_state%% *}
  current_plugin_enabled=${current_plugin_state#* }
  if [ "$PLUGIN_INSTALLED" -eq 0 ] && [ "$current_plugin_installed" -eq 1 ]; then
    "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 || return 1
  elif [ "$PLUGIN_INSTALLED" -eq 1 ] && [ "$current_plugin_installed" -eq 1 ] &&
    [ "$current_plugin_enabled" -ne "$PLUGIN_ENABLED" ]
  then
    "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 || return 1
  fi

  current_marketplace_root=$(read_marketplace_root) || return 1
  if [ "$current_marketplace_root" != "$MARKETPLACE_ROOT" ]; then
    [ -z "$current_marketplace_root" ] || return 1
    [ -n "$MARKETPLACE_ROOT" ] || return 1
    "$CODEX" plugin marketplace add "$MARKETPLACE_ROOT" --json >/dev/null 2>&1 || return 1
  fi

  current_plugin_state=$(read_plugin_state) || return 1
  current_plugin_installed=${current_plugin_state%% *}
  if [ "$PLUGIN_INSTALLED" -eq 1 ] && [ "$current_plugin_installed" -eq 0 ]; then
    "$CODEX" plugin add "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 || return 1
  elif [ "$PLUGIN_INSTALLED" -eq 0 ] && [ "$current_plugin_installed" -eq 1 ]; then
    "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 || return 1
  fi

  current_marketplace_root=$(read_marketplace_root) || return 1
  current_plugin_state=$(read_plugin_state) || return 1
  [ "$current_marketplace_root" = "$MARKETPLACE_ROOT" ] || return 1
  [ "${current_plugin_state%% *}" -eq "$PLUGIN_INSTALLED" ] || return 1
  if [ "$PLUGIN_INSTALLED" -eq 1 ]; then
    [ "${current_plugin_state#* }" -eq "$PLUGIN_ENABLED" ] || return 1
  fi
}

cleanup_backup() {
  [ -n "$BACKUP_PARENT" ] || return 0
  rm -rf "$BACKUP_PARENT" 2>/dev/null || return 1
  [ ! -e "$BACKUP_PARENT" ] && [ ! -L "$BACKUP_PARENT" ] || return 1
  BACKUP_PARENT=""
  BACKUP_RUNTIME=""
}

finish_transaction() {
  status=$?
  trap - EXIT INT TERM HUP
  rollback_ok=1
  if [ "$status" -ne 0 ] && [ "$TRANSACTION_ACTIVE" -eq 1 ]; then
    if [ "$LOCAL_MUTATED" -eq 1 ]; then
      rollback_local || rollback_ok=0
    fi
    if [ "$EXTERNAL_MUTATED" -eq 1 ]; then
      rollback_external || rollback_ok=0
    fi
    if [ "$rollback_ok" -eq 1 ]; then
      cleanup_backup || rollback_ok=0
    fi
  fi
  if [ "$status" -ne 0 ]; then
    if [ "$rollback_ok" -ne 1 ]; then
      printf '%s\n' "UNINSTALL_ROLLBACK_INCOMPLETE: PromptTripwire could not restore the exact pre-uninstall state; a recovery copy was retained when available." >&2
    fi
    if [ -n "$ERROR_MESSAGE" ]; then
      printf '%s\n' "$ERROR_MESSAGE" >&2
    else
      printf '%s\n' "UNINSTALL_FAILED: PromptTripwire removal did not complete." >&2
    fi
  fi
  exit "$status"
}

abort_transaction() {
  ERROR_MESSAGE=$1
  exit 1
}

TRANSACTION_ACTIVE=1
trap finish_transaction EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if [ "$DEST_PRESENT" -eq 1 ]; then
  BACKUP_PARENT=$(mktemp -d "$INSTALL_BASE/.uninstall-$VERSION.XXXXXX" 2>/dev/null) ||
    abort_transaction "UNINSTALL_BACKUP_FAILED: a recovery directory could not be created."
  BACKUP_RUNTIME="$BACKUP_PARENT/runtime"
  cp -Rp "$DEST" "$BACKUP_RUNTIME" 2>/dev/null ||
    abort_transaction "UNINSTALL_BACKUP_FAILED: the installed runtime could not be backed up."
  [ -f "$BACKUP_RUNTIME/$OWNER_MARKER" ] && [ ! -L "$BACKUP_RUNTIME/$OWNER_MARKER" ] &&
    [ "$(cat "$BACKUP_RUNTIME/$OWNER_MARKER" 2>/dev/null)" = "prompt-tripwire $VERSION" ] &&
    [ "$("$BACKUP_RUNTIME/bin/tripwire" --version 2>/dev/null)" = "prompt-tripwire $VERSION" ] ||
    abort_transaction "UNINSTALL_BACKUP_FAILED: the runtime recovery copy could not be verified."
fi

if [ "$WITH_CODEX_PLUGIN" -eq 1 ] && [ "$MARKETPLACE_ROOT" = "$DEST" ]; then
  if [ "$PLUGIN_INSTALLED" -eq 1 ]; then
    EXTERNAL_MUTATED=1
    "$CODEX" plugin remove "$PLUGIN_SELECTOR" --json >/dev/null 2>&1 ||
      abort_transaction "CODEX_PLUGIN_REMOVE_FAILED: PromptTripwire Plugin could not be removed."
  fi
  EXTERNAL_MUTATED=1
  "$CODEX" plugin marketplace remove "$MARKETPLACE_NAME" --json >/dev/null 2>&1 ||
    abort_transaction "CODEX_MARKETPLACE_REMOVE_FAILED: PromptTripwire marketplace could not be removed."
fi

if [ "$TRIPWIRE_LINK_OWNED" -eq 1 ]; then
  LOCAL_MUTATED=1
  rm "$BIN/tripwire" 2>/dev/null ||
    abort_transaction "RUNTIME_LAUNCHER_REMOVE_FAILED: the tripwire launcher could not be removed."
fi
if [ "$FIXTURE_LINK_OWNED" -eq 1 ]; then
  LOCAL_MUTATED=1
  rm "$BIN/tripwire-create-fixture" 2>/dev/null ||
    abort_transaction "RUNTIME_LAUNCHER_REMOVE_FAILED: the fixture launcher could not be removed."
fi
if [ "$DEST_PRESENT" -eq 1 ]; then
  LOCAL_MUTATED=1
  rm -rf "$DEST" 2>/dev/null ||
    abort_transaction "RUNTIME_REMOVE_FAILED: the PromptTripwire runtime could not be removed."
  [ ! -e "$DEST" ] && [ ! -L "$DEST" ] ||
    abort_transaction "RUNTIME_REMOVE_FAILED: the PromptTripwire runtime removal was incomplete."
fi

cleanup_backup ||
  abort_transaction "UNINSTALL_CLEANUP_FAILED: the PromptTripwire recovery copy could not be removed."
TRANSACTION_ACTIVE=0

if [ "$WITH_CODEX_PLUGIN" -eq 1 ]; then
  if [ "$CODEX_REGISTRATION_UNVERIFIED" -eq 1 ]; then
    printf '%s\n' 'Plugin registration: not removed because Codex CLI was unavailable; no global configuration was guessed or edited.'
  elif [ "$PLUGIN_INSTALLED" -eq 1 ] && [ "$MARKETPLACE_ROOT" = "$DEST" ]; then
    printf 'Plugin: removed prompt-tripwire@prompt-tripwire-local.\n'
  elif [ "$PLUGIN_INSTALLED" -eq 1 ]; then
    printf 'Plugin: preserved because prompt-tripwire-local is configured elsewhere.\n'
  else
    printf 'Plugin: already absent.\n'
  fi

  if [ "$CODEX_REGISTRATION_UNVERIFIED" -eq 1 ]; then
    printf '%s\n' 'Marketplace registration: not removed because Codex CLI was unavailable.'
  elif [ "$MARKETPLACE_ROOT" = "$DEST" ]; then
    printf 'Marketplace: removed prompt-tripwire-local.\n'
  elif [ -n "$MARKETPLACE_ROOT" ]; then
    printf 'Marketplace: preserved because prompt-tripwire-local is configured elsewhere.\n'
  else
    printf 'Marketplace: already absent.\n'
  fi
fi

if [ "$DEST_PRESENT" -eq 1 ]; then
  printf 'Runtime: removed PromptTripwire %s.\n' "$VERSION"
else
  printf 'Runtime: already absent.\n'
fi
