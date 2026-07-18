# PromptTripwire v0.1.4

Plugin-child isolation and pinned App Server search-compatibility patch for
macOS arm64. v0.1.4 preserves the v0.1.3 CLI, Controller, explicit Codex
Plugin, policy, contract, worktree containment, Decision Inbox, and report
architecture.

Release URL:
`https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.4`. Verify the
archive only with the `SHA256SUMS.txt` published on that same Release; earlier
release checksums do not apply.

## Fixed

- Start every PromptTripwire-owned Codex App Server 0.144.4 process with the
  stable `plugins` feature disabled, so an exact task that names
  `prompt-tripwire:preflight` does not re-contribute the installed Plugin or
  bundled Skill to its child model context.
- Keep the exact task bytes and snapshot hash unchanged. The existing
  `PROMPT_TRIPWIRE_PLUGIN_REENTRY` process and child-shell sentinel remains a
  separate deterministic rejection layer.
- Preserve an explicitly configured `CODEX_HOME` for the App Server process so
  its existing login matches the adapter's login check, while
  `shell_environment_policy.inherit=none` keeps it and every unrelated caller
  variable out of App Server child commands.
- Accept the pinned App Server's basename-only `search.path` metadata only when
  it uniquely identifies an explicit `rg` operand. One or more search targets
  are allowed only after every operand independently passes canonical
  repository-containment and protected-content checks.

This switch disables Plugin contributions, not every standalone system, user,
or repository Skill. An out-of-repository action from any remaining Skill is
still rejected by the normal probe containment boundary. Unknown feature,
command, path, or protected-content states remain fail-closed.

## Why this patch exists

The public v0.1.3 archive and unified installer verified correctly. A subsequent
API-key-free invocation from the installed `preflight` Skill preserved the
right task, but its child App Server rediscovered the same installed Plugin and
attempted to read the Skill outside the disposable repository. PromptTripwire
correctly stopped the run before a Decision Inbox or implementation, but the
explicit Plugin flow could not complete.

A pinned Codex 0.144.4 A/B canary confirmed that `--disable plugins` removes the
PromptTripwire Plugin contribution while preserving the exact request as task
text. The same canary exposed App Server's lossy basename and multi-file
structured search representation; v0.1.4 validates every actual operand rather
than trusting that metadata.

The published v0.1.2 and v0.1.3 tags and assets remain immutable historical
evidence and are not replaced by this release. The prepared 2:52.862 demo
remains a v0.1.2 capture; its public copy must disclose that v0.1.4 is the
current compatibility and safety patch to install.

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
- The original checkout is never the planning or execution worktree.

## Install

From the unpacked archive:

```sh
./install.sh --with-codex-plugin
```

No `OPENAI_API_KEY` is required. The runtime reuses the existing logged-in
Codex CLI 0.144.4 session. Runtime-only installation remains `./install.sh`.

Targeted uninstall:

```sh
~/.local/lib/prompt-tripwire/0.1.4/uninstall.sh --with-codex-plugin
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
human, and approved execution must stay in the existing disposable worktree
before report and targeted uninstall checks.
