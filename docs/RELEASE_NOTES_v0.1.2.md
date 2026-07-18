# PromptTripwire v0.1.2

Build Week hardening release for macOS arm64. v0.1.2 keeps the
v0.1.1 CLI, Codex Plugin, human Decision Inbox, immutable execution contracts,
and disposable-worktree executor while tightening probe containment, policy
provenance, capability lifecycle, Plugin re-entry, distribution transactions,
and release reproducibility.

When v0.1.2 is published, its GitHub Release will contain the archive and its
separately generated `SHA256SUMS.txt`. Always verify both files from the same
v0.1.2 release; an earlier release checksum does not verify this archive.

## Safety and policy hardening

- Audits every symlink in each materialized probe worktree before starting any
  Codex thread. Broken, external, or unresolvable links block the entire probe
  batch with `PROBE_CONTAINMENT_VIOLATION` rather than degrading to fewer
  probes.
- Repeats canonical root, CWD, and structured action-path containment at every
  static-read approval. Internal symlinks and App Server absolute structured
  paths are accepted only when their canonical targets remain inside the probe
  root; explicit parent traversal, unresolved paths, and canonical escapes are
  denied.
- Rejects the `-` standard-input sentinel in every approved or observed probe
  read/search command, keeping all planning evidence bound to repository files
  instead of an inherited input stream.
- Denies symlink-following `rg -L`/`--follow` search requests, including links
  whose immediate path is inside the probe root, so a nested target cannot
  widen the approved evidence boundary.
- Introduces `deterministic-v2`, which evaluates the normalized original task
  as first-class safety evidence alongside validated plans. Task-only evidence
  is labeled `task:normalized` and never claims independent probe support.
- Distinguishes positive dependency changes from whole-value, unambiguous
  no-change declarations. A contrast clause still exposes a later positive
  action, and unknown classification remains blocking.
- Expands action-and-target task coverage for repository administration, issue
  transfer, S3 synchronization, and Slack notifications in English and
  Japanese. GitHub release-artifact downloads are network-only evidence;
  local inspection, checksum verification, and test wording no longer look like
  release publication.
- Parses validated plan commands as shell-free tokens, reuses the command-class
  policy, and evaluates actual path/config/output operands. Ambiguous syntax,
  parent/absolute paths, protected reads, and write outputs fail closed in the
  appropriate category.
- Propagates the exact non-secret Plugin re-entry sentinel through the minimal
  App Server process environment and explicit child shell setting while
  retaining `shell_environment_policy.inherit=none`. Normal non-Plugin runs do
  not receive it, and recursive Plugin invocation fails closed.
- Makes the outer caller-sandbox boundary explicit. If that sandbox blocks the
  nested authenticated App Server's model request, the Skill can ask for the
  normal Codex command permission to rerun only the adapter outside the caller
  shell sandbox. Denial stops safely, the retry is limited to one, and this
  tool permission neither approves a contract nor changes any inner runtime
  restriction.
- Expands the Plugin boundary's last-resort output redaction across common API
  keys, provider tokens, authorization headers, credential assignments,
  credential-bearing URLs, and private-key blocks. Only the exact loopback,
  run-scoped Decision Inbox capability URL is preserved for the human caller;
  secret assignments in other URL queries or fragments are redacted.
- Sends the exact untrusted task through an echo-disabled interactive command
  channel rather than interpolating it into shell source. Quotes, newlines, and
  shell metacharacters therefore reach the adapter as data and never become a
  caller-shell command.

## Decision Inbox lifecycle

- Keeps a live loopback Decision Inbox only while the run is reviewable.
  Terminal/non-reviewable state, archive, run loss, or 30 minutes with neither
  authenticated activity nor an authenticated SSE stream closes the listener,
  ends streams, and revokes the in-memory capability.
- Treats listener closure only as capability revocation. It never selects a
  decision, approves a contract, cancels a run, or otherwise infers human
  intent. A later explicit review of a still-reviewable run receives a new
  capability.
- Atomically increments a non-secret SQLite generation whenever a live Inbox
  is issued for a run. A second process supersedes the first capability; stale
  listeners and in-flight mutations fail with capability revocation while the
  run, decisions, contract, and approval state remain unchanged. Bearer tokens
  remain memory-only.
- Checks live reviewability before and immediately after binding the listener,
  rechecks it after each mutation body is received, and requires an unarchived
  run inside the same SQLite write transaction that commits the mutation.
- Resolves the initial SSE event before sending response headers, so a run that
  disappears at that boundary returns a bounded error instead of leaving a
  partial stream or an unhandled rejection.
- Gives authenticated mutation bodies a five-second deadline and force-closes
  remaining connections after the lifecycle response grace, so an incomplete
  POST cannot keep a revoked listener alive or reach a controller mutation.
- Commits a final answer together with its contract and ready transition, or a
  cancel/rerun answer together with the cancelled transition, in one SQLite
  transaction. Capability, archive, version, hash, or provenance failure rolls
  back the whole outcome; contract approval remains a separate human action.
- Keeps the v0.1.1 decision-request fingerprint stable across that derived
  outcome, so legitimate retry keys survive an upgrade while changed answers
  still conflict.

## Transactional distribution

- Stages runtime files and a private, version-matched ownership marker before
  switching the installed version and user-local launchers.
- Treats the runtime, launchers, local marketplace registration, and enabled
  Codex Plugin as one install/upgrade transaction. Covered failures restore the
  prior verified local and Plugin state; an incomplete rollback is reported
  explicitly and retains the last safe install root for inspection.
- Makes a complete same-version runtime-plus-Plugin install a no-op instead of
  issuing redundant marketplace or Plugin mutations.
- Verifies the same-version runtime metadata, ownership markers, and four
  bundled Plugin safety files as regular non-symlink files with exact expected
  content. Corruption or symlink substitution enters the normal transactional
  repair path instead of being accepted as an idempotent install.
- Refuses to replace unrelated launcher files or symlinks. Runtime uninstall
  requires a non-symlinked `0600` ownership marker and a matching executable
  version before removing the versioned directory.
- Restores a just-removed Plugin when its owned marketplace removal fails;
  failure to restore that Plugin is reported as an incomplete uninstall
  rollback instead of being hidden.
- Preserves Plugins and marketplaces configured elsewhere, and leaves every
  unrelated Codex Plugin and marketplace untouched.
- Converts filesystem-command failures into fixed diagnostics so an install or
  uninstall error cannot echo a user or custom absolute prefix from operating
  system stderr.

## Reproducible release

- Derives release timestamps from `SOURCE_DATE_EPOCH` or the source commit,
  sorts archive entries, normalizes file modes and root ownership, rejects
  symlinks in staging, and uses deterministic `ustar` plus timestamp-free gzip
  output.
- Records the source commit, dirty state, source epoch, release tag, archive
  format, and size limit in `release-manifest.json`. A tag build requires a
  clean tree, an exact `v0.1.2` tag that resolves to the packaged commit, and
  that commit's timestamp; archive verification rechecks the provenance.
- Builds twice and requires identical SHA-256 digests and entry order. It also
  rejects duplicate entries, non-normalized metadata, oversized archives, and
  demo media/intermediates in the judge artifact.
- Runs release reproducibility and full archive verification in CI for pull
  requests, tags, `main` pushes, and manual dispatches.

## Requirements and target artifacts

- macOS arm64
- Node.js 24.15+
- npm 11+
- Git
- authenticated `codex-cli 0.144.4`

Target release files:

- `prompt-tripwire-v0.1.2-macos-arm64.tar.gz`
- `SHA256SUMS.txt`

PromptTripwire reuses the existing Codex CLI login for planning, GPT-5.6
comparison, and execution. It does not require or read `OPENAI_API_KEY`, and it
does not copy Codex credentials.

## Install, upgrade, and uninstall

From the unpacked v0.1.2 archive:

```sh
./install.sh --with-codex-plugin
codex plugin list --json
```

The default versioned root is `~/.local/lib/prompt-tripwire/0.1.2`. Plain
`./install.sh` remains runtime-only. Use the same `PROMPT_TRIPWIRE_PREFIX` for
install and uninstall when selecting a custom user-local prefix.

Remove the owned runtime and bundled Plugin path with:

```sh
~/.local/lib/prompt-tripwire/0.1.2/uninstall.sh --with-codex-plugin
```

Installation never starts inspection. The Plugin Skill starts `inspect` only
when explicitly invoked; neither the installer nor the Skill selects a
Decision Inbox option or approves a contract. Implementation starts only after
the human-approved contract is handed back to PromptTripwire.

When the calling Codex shell sandbox prevents the nested App Server from
reaching the model service, the Skill requests normal command permission for
only the adapter command. No API key is needed. Refusing that permission stops
preflight, and granting it does not authorize a PromptTripwire decision,
contract, or implementation.

## Release verification

Run on the supported macOS arm64 baseline for the tagged release source:

```sh
npm ci
npm run check
npm run check:release-reproducibility
npm run verify:release
```

The release build writes the current archive digest to `SHA256SUMS.txt`. This
document intentionally does not embed the archive's own checksum or freeze test
counts, because either would become stale when release contents change.

## Safety boundaries retained

- Human decisions and contract approval remain explicit. Model output, the
  Plugin adapter, installer state, UI closure, timeout, or transport loss never
  substitutes for approval.
- Network, remote writes, deploy, publish, release, migration application,
  production data, credentials, and permission expansion remain denied by the
  P0 executor even when local preparation is approved.
- PromptTripwire is not a hardened boundary against a malicious repository or
  same-user local attacker. A local out-of-contract write may be detected only
  after it occurs inside a disposable worktree; it is interrupted and is not
  described as perfectly prevented.

## Repository demo media

The repository includes the final local [v0.1.2 demo video and evidence
notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/README.md), its English captions, original thumbnail, actual live
Decision Inbox capture, and sanitized report capture. The 2:52.862 video is
1920×1080 H.264 with AAC stereo audio and embedded default English subtitles.
It remains below the three-minute submission limit.

The Inbox scene comes from an API-key-free v0.1.2 Codex Skill inspect and
remains untouched: one unresolved compatibility decision, no dependency
blocker, no selected option, and no approved contract. The source checkout,
HEAD, and worktree list remained unchanged. The narration explicitly identifies
the later contract, execution, and report scenes as a separate safe-fixture run
that a human approved earlier.

The media is committed for review and offline playback but is intentionally
excluded from the reproducible judge archive. A public YouTube upload will be
the primary demo after publication. YouTube publication and Devpost save/final
submission remain pending external human-controlled steps.

## Historical release evidence

Once published, v0.1.2 will supersede v0.1.1 as the judge release while
preserving the published v0.1.1 evidence. The historical v0.1.1 macOS arm64 asset SHA-256 is
`7a29de3241bab426b2e9b9edd84a6d6f01dd0fc1bf13d71da3927a4a83277f50`.
That digest verifies only v0.1.1 and must not be reused for v0.1.2.
