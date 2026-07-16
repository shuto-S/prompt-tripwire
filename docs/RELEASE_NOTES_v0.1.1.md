# PromptTripwire v0.1.1

Build Week judge release for macOS arm64. This release supersedes the v0.1.0
artifact for judge installation while preserving the existing CLI, Controller,
policy, contract, containment, and report implementation.

## Highlights

- Includes the thin `prompt-tripwire` Codex Plugin and explicit
  `prompt-tripwire:preflight` Skill in the compiled release archive.
- Adds one-command runtime-plus-Plugin installation with
  `./install.sh --with-codex-plugin` while preserving runtime-only
  `./install.sh` behavior.
- Reuses the existing authenticated Codex CLI session and requires no separate
  `OPENAI_API_KEY`.
- Verifies Codex 0.144.4, login state, Plugin marketplace registration, and
  enabled Plugin state without starting inspect, approval, or execution.
- Makes Plugin installation idempotent and provides targeted
  `uninstall.sh --with-codex-plugin` cleanup that preserves unrelated Plugins
  and marketplaces.
- Safely upgrades same-prefix PromptTripwire launchers from v0.1.0 while
  rejecting unrelated launcher files and symlinks.
- Retains deterministic re-entry protection so a PromptTripwire child Codex
  thread cannot recursively invoke the Plugin.
- Includes the dependency-free judge fixture and recorded read-only replay from
  v0.1.0.

## Requirements

- macOS arm64
- Node.js 24.15+
- npm 11+
- Git
- authenticated `codex-cli 0.144.4`

## Artifacts

- `prompt-tripwire-v0.1.1-macos-arm64.tar.gz`
- `SHA256SUMS.txt`

Verify the checksum, unpack the archive, and follow `JUDGE_GUIDE.md`. The
archive does not require a TypeScript/source build.

## Safety boundaries

- The Plugin runs only when explicitly invoked; v1 has no automatic hook and no
  MCP server.
- Neither the installer nor the Skill selects Decision Inbox choices or
  approves a contract.
- Execution remains inside PromptTripwire's disposable worktree and uses the
  existing fail-closed policy and report pipeline.
- Network, remote writes, deploy, publish, release, migration application,
  production data, credentials, and permission expansion remain denied by the
  P0 executor.
- PromptTripwire is not a hardened boundary against malicious repositories or
  same-user local attackers.

PromptTripwire source is licensed under Apache-2.0. Existing v0.1.0 evidence is
retained as historical verification; v0.1.1 is the current judge distribution.
