# PromptTripwire v0.1.5

Japanese Decision Inbox presentation for macOS arm64. v0.1.5 preserves the
v0.1.4 CLI, Controller, explicit Codex Plugin, policy, contract, worktree
containment, App Server isolation, and report architecture.

Release URL:
`https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.5`. Verify the
archive only with the `SHA256SUMS.txt` published on that same Release; checksums
from earlier versions do not apply.

## Added

- Select Japanese UI chrome automatically when the browser prefers Japanese.
- Add a visible `日本語 / English` switch to the Decision Inbox and retain the
  presentation choice for the same loopback origin.
- Translate fixed navigation, status, action, category, trigger, and known
  PromptTripwire template labels into Japanese.
- Cover locale selection, switching, persistence, translated review states,
  contract preview, deviation states, and recorded replay with automated tests.

## Data and approval boundaries

Localization changes presentation only. PromptTripwire does not translate or
rewrite the task, model output, repository evidence, decision identifiers,
contract content, mutation payloads, report data, or persisted run state. The
same source-language values remain bound to the repository snapshot and
content-addressed contract.

The language switch cannot choose a decision, approve a contract, start
execution, or change policy. Human Decision Inbox selections and explicit
contract approval remain separate steps. High-impact operations, stale or
unapproved contracts, out-of-scope files, secrets, network access, remote
writes, deploy, release, and destructive operations remain fail-closed.

## Unchanged compatibility and security controls

- No separate `OPENAI_API_KEY`, credential path, hosted backend, MCP server,
  automatic hook, or non-Codex adapter is added.
- The Plugin remains an explicitly invoked, Skill-centered adapter over the
  existing CLI and Controller.
- Every PromptTripwire-owned child App Server still disables installed Plugin
  contributions without rewriting the task and retains the deterministic
  re-entry sentinel.
- Planning remains read-only against the source checkout. Approved execution
  remains in a fresh disposable worktree and Codex thread.
- The Decision Inbox remains loopback-only and protected by its per-run
  capability and authenticated mutation protocol.

The public v0.1.4 and earlier tags and assets remain immutable historical
evidence. The prepared 2:52.862 demo remains a v0.1.2 capture; its public copy
must disclose that v0.1.5 is the current localized distribution to install.

## Install

From the unpacked archive:

```sh
./install.sh --with-codex-plugin
```

No `OPENAI_API_KEY` is required. The runtime reuses the existing logged-in
Codex CLI 0.144.4 session. Runtime-only installation remains `./install.sh`.

Targeted uninstall:

```sh
~/.local/lib/prompt-tripwire/0.1.5/uninstall.sh --with-codex-plugin
```

## Verification

Source and tagged release preparation must pass:

```sh
npm run check
npm run package:macos-arm64
npm run verify:release
```

After publication, download the public artifact anonymously, verify its
checksum and provenance, install it into an isolated prefix and Codex home, and
exercise the explicit Plugin flow without API-key environment variables. The
source fixture must remain unchanged, the Decision Inbox must wait for the
human, and the Japanese/English switch must not alter contract-bound data.
