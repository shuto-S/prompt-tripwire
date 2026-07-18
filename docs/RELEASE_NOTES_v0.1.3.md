# PromptTripwire v0.1.3

Compatibility and probe-boundary patch release for macOS arm64. v0.1.3 keeps
the v0.1.2 CLI, Controller, Codex Plugin, policy, contract, worktree containment,
Decision Inbox, and report architecture unchanged.

Release URL:
`https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.3`. Verify the
archive only with the `SHA256SUMS.txt` published on that same Release; earlier
release checksums do not apply.

## Fixed

- Accept the two exact Codex App Server 0.144.4 macOS launcher shapes observed
  for structured static reads: `/bin/zsh -c <command>` and
  `/bin/zsh -lc <command>`.
- Re-tokenize the single inner command and require it to match the structured
  `read`, `listFiles`, or `search` action before the existing command grammar,
  canonical path, protected-content, sandbox, and network checks run.
- Isolate `ZDOTDIR` in a controller-owned, empty, mode-`0700` disposable
  directory so user zsh startup files cannot alter a validated static read.
- Reject missing or null actual commands on probe approval requests and inspect
  failed command/file items instead of treating them as necessarily unexecuted.
- Deny direct planning-probe content reads of `.git` and its descendants while
  preserving names-only `listFiles` behavior.

All other shell paths, shell flags, additional arguments, command mismatches,
compound syntax, redirection, substitutions, executable search hooks, writes,
network access, protected paths, and repository escape remain fail-closed.
Root-owned global zsh startup files remain part of the supported macOS host
trust boundary.

## Why this patch exists

The clean v0.1.2 release artifact installed correctly, but an API-key-free live
Plugin invocation exposed an App Server representation mismatch: the structured
action was `listFiles` with command `ls`, while the completed command item was
reported through a zsh launcher envelope. v0.1.2 compared the outer and inner
tokens directly and blocked every planning probe. v0.1.3 normalizes only the
pinned, observed envelopes and adds regression plus real App Server checks.

The published v0.1.2 tag and assets remain immutable historical evidence and
are not replaced by this release.

The prepared 2:52.862 demo remains the v0.1.2 capture. It accurately shows the
human-decision and contract-bound execution flow, but it predates this narrowly
scoped App Server launcher compatibility and shell-startup hardening patch. The
YouTube description and Devpost entry must disclose that distinction.

## Unchanged boundaries

- No separate `OPENAI_API_KEY`, new credential path, hosted backend, MCP server,
  automatic hook, or non-Codex adapter is added.
- The Plugin remains an explicit, Skill-centered adapter over the existing CLI
  and Controller.
- The installer, Plugin, and model never approve a contract or choose a Decision
  Inbox option for the human.
- Network, remote writes, deploy, release, secret access, permission expansion,
  destructive operations, stale contracts, and unapproved deviations remain
  fail-closed.
- `PROMPT_TRIPWIRE_PLUGIN_REENTRY` remains the deterministic child-thread
  recursion guard.

## Install

From the unpacked archive:

```sh
./install.sh --with-codex-plugin
```

No `OPENAI_API_KEY` is required. The runtime reuses the existing logged-in
Codex CLI 0.144.4 session. Runtime-only installation remains `./install.sh`.

Targeted uninstall:

```sh
~/.local/lib/prompt-tripwire/0.1.3/uninstall.sh --with-codex-plugin
```

## Verification

Source and tagged release preparation must pass:

```sh
npm run check
npm run package:macos-arm64
npm run verify:release
```

After publication, the public artifact must additionally be downloaded
anonymously, checksum verified, installed into an isolated prefix with the
Plugin enabled, exercised without API-key environment variables through
inspect, human approval, contained execution, report, and targeted uninstall,
and confirmed not to change the source checkout.
