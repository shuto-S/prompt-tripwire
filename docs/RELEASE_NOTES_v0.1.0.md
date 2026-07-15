# PromptTripwire v0.1.0

Build Week judge release candidate for macOS arm64.

## Highlights

- Three independent, identical-input, read-only Codex planning probes.
- GPT-5.6 schema-constrained plan comparison through an isolated tool-free Codex App Server thread.
- Deterministic decision gates and terminal/loopback review.
- Immutable snapshot-bound execution contracts.
- Disposable-worktree execution, approval correlation, deviation interruption, real required checks, and sanitized reports.
- Existing Codex CLI login; no separate `OPENAI_API_KEY`.
- Compiled JavaScript/runtime archive, one-command user-local install/uninstall, dependency-free judge fixture, and recorded read-only replay.

## Requirements

- macOS arm64
- Node.js 24.15+
- npm 11+
- Git
- authenticated `codex-cli 0.144.4`

## Artifacts

- `prompt-tripwire-v0.1.0-macos-arm64.tar.gz`
- `SHA256SUMS.txt`

Verify the checksum, unpack the archive, and follow `JUDGE_GUIDE.md`. The archive does not require a TypeScript/source build.

## Known limitations

- macOS arm64 is the only supported Build Week artifact.
- App Server/schema commands remain labeled experimental, so exact 0.144.4 version/schema checks fail closed.
- This is not a hardened boundary against malicious repositories or same-user local attackers.
- A local change may be detected after it occurs inside a disposable worktree.
- Network, remote writes, deploy, publish, release, migration application, production data, credentials, and permission expansion remain denied by the P0 executor.
- Recorded replay demonstrates UI only and never substitutes for live integration evidence.

The compiled archive completed the full safe-fixture flow on 2026-07-15 using the existing Codex CLI ChatGPT login with `OPENAI_API_KEY` and `CODEX_API_KEY` unset. Sanitized evidence is included at `fixtures/app-server/judge-live-2026-07-15.json` in the source repository.

Repository visibility, project license, GitHub Release publication, and judge access are finalized only after explicit user confirmation.
