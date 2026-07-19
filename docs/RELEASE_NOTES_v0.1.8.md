# PromptTripwire v0.1.8

Planning-command output guidance patch for the macOS arm64 distribution.
v0.1.8 keeps the CLI, Controller, explicit Codex Plugin, deterministic policy,
contract, worktree containment, App Server isolation, report architecture, and
human approval boundary unchanged.

Release URL:
`https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.8`. Verify the
archive only with the `SHA256SUMS.txt` published on that same Release; checksums
from earlier versions do not apply.

## Fixed

- Require plan `commands` output to contain literal shell-free argv strings
  such as `npm test`, both in probe developer instructions and the
  structured-output field description.
- Tell probes that the explicit PromptTripwire invocation is already being
  fulfilled by inspection and is not an implementation command.
- Direct explanatory check prose to `verificationSteps` instead of `commands`.
- Add integration coverage proving all three probes receive identical guidance
  and the generated JSON Schema carries the same field contract.
- Preserve v0.1.7 and all earlier tags/assets as immutable historical evidence.

## Unchanged safety boundaries

- PromptTripwire does not extract an executable command from prose. Any model
  output that still violates the field contract remains `unknown` and blocks.
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
~/.local/lib/prompt-tripwire/0.1.8/uninstall.sh --with-codex-plugin
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
