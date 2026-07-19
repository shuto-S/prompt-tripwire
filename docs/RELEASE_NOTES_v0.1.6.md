# PromptTripwire v0.1.6

Judge-documentation correction for the macOS arm64 distribution. v0.1.6 keeps
the v0.1.5 runtime behavior, Japanese/English Decision Inbox presentation, CLI,
Controller, explicit Codex Plugin, policy, contract, worktree containment, App
Server isolation, and report architecture unchanged.

Release URL:
`https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.6`. Verify the
archive only with the `SHA256SUMS.txt` published on that same Release; checksums
from earlier versions do not apply.

## Fixed

- Make the README and Judge Guide packaged inside the current archive point to
  the v0.1.6 archive name, release URL, install root, uninstall command, and Git
  marketplace tag.
- Preserve v0.1.5 as immutable historical evidence instead of replacing its tag
  or uploaded assets. Its runtime and Plugin passed release verification, but
  its packaged quickstart still named v0.1.4 and should not be the judge-facing
  distribution.
- Keep the Devpost and demo confirmation copy aligned with the current release
  while retaining the explicit v0.1.2-footage disclosure.

## Unchanged safety boundaries

- Localization changes fixed presentation only. Task, model output, evidence,
  decision identifiers, contracts, mutation data, reports, and persisted run
  state remain source-language and unchanged.
- Neither the installer, Plugin, language switch, nor model selects a Decision
  Inbox option or approves a contract.
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
~/.local/lib/prompt-tripwire/0.1.6/uninstall.sh --with-codex-plugin
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
