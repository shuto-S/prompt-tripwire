# PromptTripwire judge guide

PromptTripwire is a local-first preflight and execution gate for Codex. This guide targets the compiled v0.1.12 macOS arm64 release produced by `npm run package:macos-arm64`; judges do not need the TypeScript source tree or a source build once that archive and its matching `SHA256SUMS.txt` are provided. Earlier releases remain immutable historical evidence and must not be substituted for v0.1.12.

The demo is a v0.1.2 capture. The judge distribution is v0.1.12. Releases v0.1.3 through v0.1.12 improved compatibility, safety, localization, and presentation precision without changing the video's human-approval or contract boundary.

v0.1.10 preserves the v0.1.5 Japanese/English UI and the v0.1.4 Plugin
isolation, re-entry sentinel, custom Codex
home handling, and explicit-path validation. v0.1.5 added Japanese Decision Inbox
chrome selected from the browser locale plus a visible `日本語 / English`
switch. Authoritative task text, model output, evidence, decisions, contracts,
mutation data, reports, and approval state are never rewritten. v0.1.6 corrected the
packaged release references. v0.1.7 keeps explicit coordinated prohibition
lists negated, removing false safe-fixture dependency, network, and publication
questions without weakening positive-action detection. v0.1.8 additionally
keeps workflow/check prose out of plan `commands`, preventing avoidable unknown
questions while malformed values remain fail-closed. v0.1.9 requires bare
inspection program names so Codex 0.144.4 does not turn an otherwise safe
`ls` into the fail-closed `unknown` shape `/bin/ls`; that shape remains denied.
v0.1.10 additionally gives the Japanese UI source-bound reference translations
for the task and decision content. The unchanged authoritative source is
expandable, and translation cannot alter IDs, decisions, contracts, hashes,
execution, or reports. Invalid or unavailable translation falls back visibly
to source text without inferring approval.
v0.1.11 removed numeric Codex version gates. v0.1.12 retains that policy and
validates one shared consumed
normal-schema profile and a bounded private-temp semantic canary before reading
the target repository, binds the attestation into the contract, and remeasures
before approval and run. It also redacts secret-like source text before the
translation turn and sanitizes the complete browser review DTO; canonical
persistence and approval identity remain unchanged. v0.1.12 additionally makes
decision provenance, valid-probe counts, option support, and immutable contract
scope directly legible in the judge-facing UI without changing authority.

## Supported platform and prerequisites

- macOS on Apple silicon (`arm64`)
- Node.js 24.15 or newer
- npm 11 or newer (used only by the dependency-free safe fixture's test script)
- Git
- a Codex CLI whose normal schema, handshake, and bounded canary are compatible
- an existing authenticated Codex CLI session

Check the last prerequisite with:

```sh
codex --version
codex login status
```

PromptTripwire starts `codex app-server` and reuses that authenticated Codex session for probes, GPT-5.6 comparison, and execution. Do not create or configure `OPENAI_API_KEY`; PromptTripwire neither requires nor reads one.
Historical 0.144.4 and current 0.144.6 evidence are known-good guarantees, not
an allowlist. The runtime does not branch on the version number.

## Verify, unpack, and install

Place the `.tar.gz` and `SHA256SUMS.txt` files in the same directory, then run:

```sh
shasum -a 256 -c SHA256SUMS.txt
tar -xzf prompt-tripwire-v0.1.12-macos-arm64.tar.gz
cd prompt-tripwire-v0.1.12-macos-arm64
./bin/tripwire --version
./bin/tripwire --help
```

Do not use a historical release's SHA-256 for this archive. Verify only with
the `SHA256SUMS.txt` produced alongside the v0.1.12 archive.

The shortest user-local setup installs the runtime and Codex Plugin together
and requires no `sudo`:

```sh
./install.sh --with-codex-plugin
codex plugin list --json
```

The installed display name is `PromptTripwire`; its Skill name is
`prompt-tripwire:preflight`. In a new Codex task, invoke it explicitly:

```text
$prompt-tripwire:preflight
Inspect this task before implementing it: ...
```

The bundled Skill metadata disables implicit invocation, so task text that only
matches the description does not start PromptTripwire.

That line remains part of the exact snapshot-bound task. PromptTripwire
disables installed Plugin contributions before creating its child App Server
threads, so the child does not rediscover the PromptTripwire Skill from the
same text. Standalone Skills are not globally disabled; any out-of-repository
read they request is rejected by the existing containment boundary.

The Skill starts an authenticated nested `codex app-server`. A calling Codex
shell sandbox can block that child from reaching the model service even though
the CLI login is valid. In that case, allow the normal Codex command permission
only for the thin adapter command when prompted. This caller-tool permission
is not a Decision Inbox choice, contract approval, or authority to implement
the task. PromptTripwire's inner probe, comparator, executor, and re-entry
restrictions remain unchanged. If the permission is denied, preflight stops;
do not configure an API key as a workaround.

The default runtime and marketplace root is
`~/.local/lib/prompt-tripwire/0.1.12`. The marketplace retains the relative
`./plugins/prompt-tripwire` source. The installer verifies macOS arm64, Node.js,
Git, the Codex command/version-output shape, and the existing login; it never gates on a numeric Codex version or runs inspect, decisions,
approval, or implementation. It does not require `OPENAI_API_KEY`.
An install or upgrade is staged and verified before it is committed. Launchers
are switched atomically; covered local, marketplace, or Plugin failures restore
the previous state. Same-version reruns do not mutate an already complete
installation. An upgrade in the same prefix repoints only launchers owned by a
verified older PromptTripwire install and rejects unrelated files or symlinks.

Plain `./install.sh` remains runtime-only and does not register a Codex Plugin.
Add `~/.local/bin` to `PATH` if using the runtime directly. To remove the
Plugin, its owned marketplace registration, and runtime together:

```sh
~/.local/lib/prompt-tripwire/0.1.12/uninstall.sh --with-codex-plugin
```

The targeted uninstall leaves every other Plugin and marketplace untouched and
is idempotent while its installed script still exists. If the first uninstall
already removed that versioned script, rerun from the unpacked artifact:

```sh
./uninstall.sh --with-codex-plugin
```

Runtime removal requires a
private, version-matched ownership marker and refuses an unowned, symlinked, or
incomplete destination. If the marketplace is configured elsewhere, its Plugin
and registration are preserved. Set `PROMPT_TRIPWIRE_PREFIX` for both commands
to use another user-owned prefix.
Uninstall does not require a Codex version. If the Codex command is missing, it
removes owned local files without guessing or editing global Codex settings and
prints the registration that remains for later targeted cleanup.

For a Git-marketplace fallback, first keep the artifact's `tripwire` launcher
on `PATH` or set `PROMPT_TRIPWIRE_BIN`, then run:

```sh
codex plugin marketplace add shuto-S/prompt-tripwire --ref v0.1.12
codex plugin add prompt-tripwire@prompt-tripwire-local
codex plugin list --marketplace prompt-tripwire-local
```

The Plugin and runtime versions must match the v0.1.12 release tag.

The Skill always stops for human Decision Inbox choices and explicit contract
approval. Neither the installer nor the calling Codex task may approve on the
user's behalf.

The published v0.1.6 archive and checksum were anonymously downloaded and
matched byte-for-byte with the clean tag-aware candidate; its packaged README
and this guide self-reference v0.1.6. An isolated-prefix install with API-key
variables unset enabled Plugin version 0.1.6, and a real
logged-in `prompt-tripwire:preflight` invocation stopped at `needs_review` with
four blocking decisions and no approved contract. The fixture's status, HEAD,
and sole-worktree inventory remained unchanged; targeted uninstall removed only
the test Plugin, marketplace, and runtime. The temporary authentication copy and
token-bearing private invocation log were deleted after verification. The
published v0.1.7 archive was anonymously downloaded, matched its clean
tag-aware candidate byte-for-byte, passed its checksum, and installed Plugin
version 0.1.7 with API-key variables unset. A real Skill invocation stopped
safely in the caller sandbox; the permitted thin-adapter retry reached
`needs_review` without changing the fixture and exposed four plan-command prose
unknowns corrected in v0.1.8. v0.1.8 public-download and real-Plugin evidence
was recorded on 2026-07-19 JST: the public archive matched the clean candidate
byte-for-byte with SHA-256
`0b5ca45f3cf497917df9f0b1c531aa4e8cf5b9e75eb46e47128c5fa3d09e351c`,
and isolated installation enabled Plugin version 0.1.8 with API-key variables
unset. Its caller-sandbox attempt stopped safely; two permitted adapter runs
then failed closed when one probe emitted `/bin/ls` as `unknown`. v0.1.9 keeps
that unknown-action gate intact and corrects only the generation notation.
The v0.1.9 public archive and checksum were downloaded anonymously and matched
the clean candidate byte-for-byte: SHA-256
`8e1fa4ea296eb7d64c3fb453d21121037c63fe68a919c0fd51de483d6436d9c0`,
2,314,606 bytes, 921 files, source commit
`de6c4bb458793d3395155f370b0c0e22d24ef773`. An isolated API-key-free install
enabled Plugin 0.1.9, and its real preflight reached one explicit compatibility
decision without changing the source checkout. The remaining English effects
observed in that Japanese UI directly motivated v0.1.10's separately bound
reference translation.

## Demo evidence

[![PromptTripwire v0.1.2 demo thumbnail](https://raw.githubusercontent.com/shuto-S/prompt-tripwire/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-thumbnail.png)](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-demo.mp4)

The repository contains the 2:52.862 [v0.1.2 demo
video](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-demo.mp4), [English
captions](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/prompt-tripwire-v0.1.2-demo.en.srt), [live Decision Inbox
capture](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/decision-inbox-v0.1.2-live.png), [sanitized report
capture](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/evidence-report-v0.1.2.png), and [full media/evidence
notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/README.md). The video is 1920×1080 H.264 with AAC stereo audio and
embedded default English subtitles. These repository files are excluded from
the compact release archive.

This media is explicitly a v0.1.2 capture, not footage of the v0.1.12 judge
distribution. The Inbox capture is an actual API-key-free v0.1.2 Plugin
inspect. It has one
unresolved compatibility decision, no dependency blocker, no selected option,
and no approved contract; its source status, HEAD, and worktree list stayed
unchanged. The later contract, execution, and report scenes are explicitly a
separate safe-fixture run that a human approved earlier. The public YouTube
upload will be the primary demo only after its prepared title, description,
visibility, captions, and thumbnail receive human confirmation; until then,
this repository copy is the review/offline fallback. Devpost final submission
has a separate human confirmation gate.

## 30-second proof (recorded and read-only)

This path is explicitly recorded and read-only. It does not call Codex, execute code, or claim to verify the live integration.

```sh
./bin/tripwire replay
```

Open the printed loopback URL, inspect the sample divergence and evidence, then press `Ctrl-C`. For a terminal-only check:

```sh
./bin/tripwire replay --terminal
```

## Complete live proof

The included fixture has no dependencies, credentials, network calls, deploy targets, or external actions. All implementation happens in a disposable worktree; the generated source fixture remains unchanged.

The proof starts from an unpacked, checksum-verified artifact. Keep the version,
artifact CWD, target repository, run, and approved contract explicit:

```sh
DIST_VERSION="0.1.12"
DIST="$PWD"
FIXTURE="$(mktemp -d)/prompt-tripwire-judge-fixture"
printf 'distribution=%s artifact_cwd=%s fixture=%s\n' "$DIST_VERSION" "$DIST" "$FIXTURE"
./bin/create-judge-fixture "$FIXTURE"
npm --prefix "$FIXTURE" test
```

In a new Codex task, explicitly invoke the bundled Skill before implementation:

```text
$prompt-tripwire:preflight
Inspect the task in judge/task.md against the generated safe fixture before implementing it.
```

The Skill returns a `RUN_ID` and stops if human review is required. The terminal
commands below are the complete inspect-to-report proof and expose the same
boundary directly.

1. Inspect with three independent read-only Codex probes and the isolated GPT-5.6 comparator:

   ```sh
   ./bin/tripwire inspect \
     --repo "$FIXTURE" \
     --task-file "$DIST/judge/task.md" \
     --terminal
   ```

   Copy the printed `Run:` value as `RUN_ID`; do not substitute the distribution
   version, task ID, or a previous run.

2. Review the recorded plans, decision state, and contract preview:

   ```sh
   ./bin/tripwire review RUN_ID --terminal
   ```

   The fixture explicitly requests two compatibility changes, so the deterministic policy normally presents one all-or-none compatibility card. The terminal output includes a complete command for each option. Run the printed command for **Allow local implementation**, then rerun the review command if needed. If a model introduces a separate blocking unknown, keep it visible and resolve only a bounded option shown by the review command; do not broaden paths or capabilities. Non-string inputs are explicitly outside this fixture's scope and should not become an unknown.

3. After the human has made the shown decision, approve the current contract and
   copy the printed value as `CONTRACT_ID`:

   ```sh
   ./bin/tripwire approve RUN_ID
   ./bin/tripwire status RUN_ID
   ```

4. Execute the approved local change in a new disposable worktree:

   ```sh
   ./bin/tripwire run --contract CONTRACT_ID --terminal
   ```

5. Inspect the sanitized evidence:

   ```sh
   ./bin/tripwire report RUN_ID --format markdown
   git -C "$FIXTURE" status --short
   ```

The report should contain the contract hash, Codex/App Server identifiers, observed paths, the real `npm test` result, deviations, and remaining unknowns. `git status --short` for the original fixture should remain empty.

## Safety boundaries

- Planning uses separate fresh threads with identical task/snapshot inputs.
- Before target-repository access, PromptTripwire resolves and digests the Codex executable, validates a fresh normal schema against one version-independent consumed-surface profile, and runs a private-temp, read-only, network-denied, tool-free canary through that same process. Approval and run require an exact fresh attestation match. Additive optional schema is tolerated, but an unknown request or enum observed at runtime is denied and interrupts.
- Planning worktrees are read-only; network, project scripts, interpreters, package managers, and writes are denied. Before any probe thread starts, every materialized symlink must resolve canonically inside its disposable worktree; root/CWD/action containment is checked again for each static-read approval.
- The supported App Server `/bin/zsh -c` and `/bin/zsh -lc` command envelopes are cross-validated against their structured actions. App Server runs with an empty private runtime-owned `ZDOTDIR`; missing raw commands, failed unsafe items, and direct `.git` metadata reads fail closed.
- GPT-5.6 comparison runs in a fresh empty directory with no tools, network, MCP, apps, or subagents.
- `deterministic-v2` evaluates the normalized original task as well as validated plans. Task-only safety evidence never claims probe support, and narrow dependency no-change declarations do not hide a later positive contrast clause.
- Execution uses another disposable worktree. Network, remote writes, deploy, publish, release, migration application, production data, credentials, and permission expansion remain denied in P0 even if local preparation is approved.
- A local change that cannot be stopped before it occurs is detected inside the disposable worktree, interrupted, and reported. PromptTripwire does not describe detective monitoring as perfect prevention.
- The Decision Inbox binds only to loopback and uses a per-run capability token supplied in a one-time URL fragment. Terminal/non-reviewable state, archive, or 30 minutes without authenticated activity and without an authenticated SSE stream closes the listener and revokes the in-memory capability without selecting, approving, cancelling, or otherwise changing the persisted run. Mutation bodies must finish within five seconds, and remaining connections are force-closed after the bounded response grace.
- A Plugin-originated run passes only the non-secret re-entry sentinel through the minimal App Server environment and explicit child shell setting. It does not broaden environment inheritance, and child re-entry fails closed.
- Permission to launch the thin Plugin adapter outside a restrictive caller shell sandbox is only a normal Codex command permission needed for the nested authenticated App Server's model access. It does not approve a PromptTripwire decision or contract, and it does not relax any inner runtime boundary.

## Troubleshooting

- `CODEX_COMPATIBILITY_FAILED`: the resolved Codex command could not provide the required normal-schema/handshake/canary behavior. Check `codex login status`, command availability, and the reported missing surface; changing only the version number is not a fix.
- `CODEX_COMPATIBILITY_DRIFT`: the executable or measured behavior changed after inspect. The prior approval is stale; inspect again after stabilizing the Codex installation.
- `DIRTY_CHOICE_REQUIRED`: the source repository is dirty. Use `--dirty committed` to inspect the committed snapshot or `--dirty include` to bind the approved patch.
- Login/usage error: run `codex login status`, sign in with the normal Codex flow if needed, and retry. Do not add an API key specifically for PromptTripwire.
- `INSUFFICIENT_VALID_PROBES: request failed` from an invocation inside the caller shell sandbox: the sandbox may have blocked the nested App Server's model request. Allow one retry of only the adapter command through the normal Codex command-permission prompt. If that permission is denied or the retry fails, stop and report the failure; do not disable the re-entry guard, relax PromptTripwire policy, or add an API key.
- Recorded replay works but live inspection fails: replay is only a UI fallback; report the live failure rather than presenting replay as integration evidence.
- Unsupported OS/CPU: this Build Week artifact is macOS arm64 only.
- `CODEX_LOGIN_REQUIRED`: sign in through the normal `codex login` flow; do not create an API key for PromptTripwire.
- `RUNTIME_MISSING`: use the complete release directory; do not copy only `install.sh` away from its payload.
- `RUNTIME_INSTALL_CONFLICT` or `RUNTIME_UNINSTALL_CONFLICT`: PromptTripwire could not prove ownership of the destination or launcher. Preserve the path and inspect it; do not replace or delete it manually as part of the judge flow.
- `ROLLBACK_INCOMPLETE`: a failed install could not fully restore both local and Codex Plugin state. Keep the last safe install root, inspect `codex plugin list --json` and `codex plugin marketplace list --json`, and do not retry until the mismatch is understood.
- `UNINSTALL_ROLLBACK_INCOMPLETE`: marketplace removal failed after Plugin removal and the Plugin could not be restored. Preserve the runtime root, inspect both Codex Plugin lists, and resolve the mismatch before retrying.

## Source-repository verification

Maintainers can reproduce the full suite from a clean checkout:

```sh
npm ci
npm run check
npm run check:release-reproducibility
npm run package:macos-arm64
npm run verify:release
```

See `SECURITY.md` for the threat model and residual risk statement.
