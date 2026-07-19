# PromptTripwire v0.1.9

Planning-probe command-notation patch for the macOS arm64 distribution.
v0.1.9 keeps the CLI, Controller, explicit Codex Plugin, deterministic policy,
contract, worktree containment, App Server isolation, report architecture, and
human approval boundary unchanged.

Release URL:
`https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.9`. Verify the
archive only with the `SHA256SUMS.txt` published on that same Release; checksums
from earlier versions do not apply.

## Fixed

- Tell every planning probe to invoke allowlisted inspection programs by bare
  name, such as `ls` or `cat`, instead of model-authored executable paths.
- Prohibit absolute/relative executable paths and explicit shells in probe
  instructions while retaining the pinned App Server's independently validated
  exact zsh envelope.
- Add regression coverage that `/bin/ls` remains an `unknown` containment
  violation rather than being normalized into a safe action.
- Preserve v0.1.8 and every earlier tag/asset as immutable historical evidence.

## Unchanged safety boundaries

- PromptTripwire still trusts neither raw commands nor App Server structured
  actions alone. Both must match, and every path remains canonically contained.
- Unknown actions, including model-authored executable paths, remain
  fail-closed. This patch changes generation guidance, not the runtime gate.
- Neither the installer, Plugin, model, policy, nor language switch selects a
  Decision Inbox option or approves a contract.
- No separate `OPENAI_API_KEY`, credential path, hosted backend, MCP server,
  automatic hook, or non-Codex adapter is added.
- Network, remote writes, deploy, release, secret access, destructive actions,
  stale contracts, and out-of-scope files remain fail-closed.

## Install

From the unpacked archive:

```sh
./install.sh --with-codex-plugin
```

No `OPENAI_API_KEY` is required. The runtime reuses the existing logged-in
Codex CLI 0.144.4 session. Runtime-only installation remains `./install.sh`.

Targeted uninstall:

```sh
~/.local/lib/prompt-tripwire/0.1.9/uninstall.sh --with-codex-plugin
```

## Verification

Source and tagged release preparation must pass:

```sh
npm run check
npm run package:macos-arm64
npm run verify:release
```

After publication, download the public artifact anonymously, verify its
checksum and provenance, confirm the packaged quickstart is self-consistent,
install it into an isolated prefix and Codex home, and exercise the explicit
Plugin flow without API-key environment variables. The source fixture must
remain unchanged and the Decision Inbox must wait for the human.
