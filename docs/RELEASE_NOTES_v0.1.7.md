# PromptTripwire v0.1.7

Negated-list policy precision patch for the macOS arm64 distribution. v0.1.7
keeps the CLI, Controller, explicit Codex Plugin, contract, worktree
containment, App Server isolation, report architecture, and human approval
boundary unchanged.

Release URL:
`https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.7`. Verify the
archive only with the `SHA256SUMS.txt` published on that same Release; checksums
from earlier versions do not apply.

## Fixed

- Treat an explicit coordinated prohibition such as `Do not A, B, C, or D` as
  one negated list instead of promoting the middle comma-separated actions into
  dependency, network, or publication blockers.
- Preserve fail-closed detection for a comma splice without a terminal
  coordinator, and for a later positive action introduced by `but`, `then`, a
  new subject/modal, or a new sentence.
- Add the exact safe-fixture instruction that exposed the false dependency,
  network, and publication questions as a deterministic policy regression
  test.
- Preserve v0.1.6 and all earlier tags/assets as immutable historical evidence.

## Unchanged safety boundaries

- Original task text remains first-class deterministic evidence. Only clearly
  negated coordinated operations are suppressed; ambiguous or positively
  requested high-impact actions remain blocking.
- Neither the installer, Plugin, model, policy, nor language switch selects a
  Decision Inbox option or approves a contract.
- No separate `OPENAI_API_KEY`, credential path, hosted backend, MCP server,
  automatic hook, or non-Codex adapter is added.
- Network, remote writes, deploy, release, secret access, destructive actions,
  stale contracts, and out-of-scope files remain fail-closed.
- Planning remains read-only against the source checkout; approved execution
  remains in a fresh disposable worktree and Codex thread.

## Install

From the unpacked archive:

```sh
./install.sh --with-codex-plugin
```

No `OPENAI_API_KEY` is required. The runtime reuses the existing logged-in
Codex CLI 0.144.4 session. Runtime-only installation remains `./install.sh`.

Targeted uninstall:

```sh
~/.local/lib/prompt-tripwire/0.1.7/uninstall.sh --with-codex-plugin
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
