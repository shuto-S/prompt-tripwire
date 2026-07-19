# PromptTripwire

> See where Codex disagrees before it writes code.

PromptTripwire is a local-first preflight and execution gate for Codex. It runs the same engineering task through multiple independent, read-only Codex planning threads, turns material disagreements into a small number of human decisions, and binds the approved choices into an execution contract.

The local-first P0 engine and judge distribution are implemented and tested: a unified Codex App Server 0.144.4 planning/comparison/execution adapter, three independent real planning probes, tool-free GPT-5.6 structured comparison, task-aware deterministic policy, terminal and browser review/approval, immutable contracts, Git worktree containment, contract-bound execution/deviation handling, sanitized audit reports, crash recovery, retention, security/traceability gates, a compiled macOS arm64 archive, a safe fixture, and an explicitly recorded read-only replay.

The v0.1.2 release hardens that baseline with fail-closed canonical
symlink checks before and during probing, `deterministic-v2` task provenance and
dependency-intent handling, bounded Decision Inbox capability lifetime,
two-stage Plugin re-entry protection, transactional install/upgrade rollback,
owned-directory uninstall checks, and reproducible archive verification.

The v0.1.3 patch release preserves those boundaries while matching
the exact `/bin/zsh -c` and `/bin/zsh -lc` command envelopes emitted by the
pinned Codex App Server. It launches App Server with an empty, private,
runtime-owned `ZDOTDIR`, rejects approval requests with a missing raw command,
continues to inspect failed command/file items, and denies direct reads of
`.git` metadata. These are compatibility and fail-closed hardening changes; the
CLI, Plugin, policy, contract, containment, and report flow remain the source
of truth.

The v0.1.4 patch keeps the exact explicit Plugin task as snapshot-bound input
while disabling installed Plugin contributions in every child App Server. It
retains the deterministic re-entry sentinel, preserves custom `CODEX_HOME` only
for the App Server login, and validates every operand in the pinned App Server's
basename-only or multi-target `rg` representation. It does not claim to disable
standalone Skills; out-of-repository actions still fail the canonical probe
boundary.

The v0.1.5 release adds Japanese Decision Inbox presentation with browser-locale
detection and a visible `日本語 / English` switch. Localization changes only
fixed UI chrome: task text, model output, evidence, decision identifiers,
contracts, mutations, and reports retain their source-language values and the
same approval boundaries.

The v0.1.6 release keeps that product behavior unchanged and corrects the
judge-facing version references packaged inside the archive. The v0.1.5 tag and
assets remain immutable historical evidence.

## Why this exists

A single coding-agent plan can look confident while silently choosing an API shape, migration strategy, file scope, or external action that the developer never intended. A generic approval screen catches actions late, and a requirements interview asks questions without knowing which ambiguities actually change Codex's implementation.

PromptTripwire uses plan divergence as evidence. It asks only when independent Codex runs materially disagree or when a deterministic safety rule requires confirmation.

## Intended experience

```text
$ tripwire inspect --task "Add account deletion"

3 Codex probes completed against commit 8f21c4a
2 decisions require review
Decision Inbox: http://127.0.0.1:43127/runs/run_01...
```

The local UI shows decision cards, not three walls of plan text:

- hard delete vs. delayed deletion;
- revoke sessions immediately vs. at job completion;
- the repository evidence behind each interpretation;
- the files, data, and external effects each option changes.

After review, PromptTripwire creates a versioned execution contract. Codex runs in an isolated worktree with network and remote tools disabled throughout P0 execution. A high-impact decision may approve local implementation that prepares an effect, but PromptTripwire does not perform that operation. Contract deviations pause the run and require an explicit update or rejection.

## Product decisions

- **Hybrid interface:** CLI is the primary entry point; a lightweight local UI opens only when decisions or deviations need attention. A terminal fallback remains available.
- **Independent probes:** the default is three separate Codex planning threads with the same task, snapshot, model configuration, instructions, and output schema. PromptTripwire does not manufacture disagreement with role prompts.
- **Model-assisted comparison, deterministic gating:** GPT-5.6 extracts structured consensus and divergence. Fixed policy rules always override the model for destructive, external, privileged, or irreversible actions.
- **Contract enforcement:** the product does not stop at a prettier plan review. Approved decisions constrain the subsequent Codex execution.
- **Local-first:** source checkout, contracts, and audit artifacts stay local by default. No PromptTripwire cloud service is required for the MVP.

## Documentation

- [Product specification](docs/SPECIFICATION.md)
- [Architecture and protocols](docs/ARCHITECTURE.md)
- [Security and privacy](docs/SECURITY.md)
- [Market and competitor research](docs/RESEARCH.md)
- [Build Week plan and compliance](docs/BUILD_WEEK.md)
- [Build Week requirements matrix](docs/BUILD_WEEK_REQUIREMENTS_MATRIX.md)
- [Judge guide](docs/JUDGE_GUIDE.md)
- [v0.1.2 demo media, captions, and evidence boundary](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/README.md)
- [Devpost submission draft](docs/DEVPOST_SUBMISSION.md)
- [v0.1.6 release notes](docs/RELEASE_NOTES_v0.1.6.md)
- [v0.1.5 release notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.5/docs/RELEASE_NOTES_v0.1.5.md)
- [v0.1.4 release notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.4/docs/RELEASE_NOTES_v0.1.4.md)
- [v0.1.3 release notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.3/docs/RELEASE_NOTES_v0.1.3.md)
- [v0.1.2 release notes](docs/RELEASE_NOTES_v0.1.2.md)
- [Codex collaboration record](docs/CODEX_COLLABORATION.md)
- [Decision log and open questions](docs/DECISIONS.md)
- [Codex App Server 0.144.4 feasibility spike](docs/CODEX_APP_SERVER_SPIKE.md)

`docs/SPECIFICATION.md` is the authoritative product scope. The other documents provide implementation detail and evidence.

## Judge quickstart

The judge artifact is a compiled JavaScript/runtime archive for macOS arm64. It does not require the TypeScript source tree or a source build. Download the archive and its matching checksum from the [v0.1.6 GitHub Release](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.6). The public v0.1.2, v0.1.3, v0.1.4, and v0.1.5 releases remain immutable historical evidence and must not be used in place of the v0.1.6 judge artifact.

Prerequisites are Node.js 24.15+, npm 11+, Git, and an already authenticated `codex-cli 0.144.4`. PromptTripwire reuses the existing Codex CLI login for probes, GPT-5.6 comparison, and execution. It does not require `OPENAI_API_KEY`, expose an API-key setting, or copy Codex credentials.

```sh
shasum -a 256 -c SHA256SUMS.txt
tar -xzf prompt-tripwire-v0.1.6-macos-arm64.tar.gz
cd prompt-tripwire-v0.1.6-macos-arm64
./install.sh --with-codex-plugin
codex plugin list --json
./bin/tripwire replay --terminal
```

`tripwire replay` is clearly labeled recorded and read-only; it makes no Codex call and executes no code. The included dependency-free fixture exercises the real `inspect → review → approve → contained execution → report` path. See the [Judge Guide](docs/JUDGE_GUIDE.md) for exact commands, install/uninstall, safety boundaries, and troubleshooting. Verify v0.1.6 only with the checksum file from that same release; historical v0.1.1, v0.1.2, v0.1.3, v0.1.4, and v0.1.5 checksums must not be reused.

## Demo and submission status

[![PromptTripwire v0.1.2 demo thumbnail](https://raw.githubusercontent.com/shuto-S/prompt-tripwire/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-thumbnail.png)](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-demo.mp4)

The repository contains the final local [v0.1.2 demo video](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-demo.mp4), [English captions](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/prompt-tripwire-v0.1.2-demo.en.srt), [live Decision Inbox capture](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/decision-inbox-v0.1.2-live.png), and [sanitized report capture](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/evidence-report-v0.1.2.png). The 2:52.862 video is 1920×1080 H.264 with AAC stereo audio and embedded English subtitles. See the [demo evidence notes and narration](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/README.md) for exact format details and disclosure.

These files are a v0.1.2 capture and are not represented as footage of the
v0.1.6 judge distribution. The live Inbox scene comes from an API-key-free
v0.1.2 Codex Plugin inspect. It
shows one unresolved compatibility decision, no dependency blocker, no selected
option, and no approved contract; the source checkout, HEAD, and worktree list
remained unchanged. The later contract, execution, and report scenes are
explicitly a separate safe-fixture run that a human approved earlier. The
repository media is excluded from the compact release archive and serves as a
review/offline fallback. The public YouTube upload will become the primary demo
only after the prepared title, description, visibility, captions, and thumbnail
receive human confirmation. Devpost preparation may continue, but final
submission remains behind a separate human confirmation.

## Development baseline

Supported Build Week development baseline:

- macOS on arm64;
- Node.js 24.15 or newer in the Node 24 LTS line (`.nvmrc` and `.node-version`);
- npm 11 or newer, with npm 11.17.0 recorded in `packageManager`;
- `codex-cli 0.144.4` with the pinned normal-schema hash, already authenticated through the normal Codex login flow.

PromptTripwire uses that existing Codex CLI login for probes, comparison, and execution. It does not require `OPENAI_API_KEY` or another API credential.

Install a clean source checkout with one command:

```sh
npm ci
```

Run the complete local foundation verification:

```sh
npm run check
```

Individual entry points are available for `typecheck`, `lint`, `build`, `test:unit`, `test:integration`, `test:e2e`, `check:boundaries`, `check:versions`, `check:schema`, `check:licenses`, `check:security`, `check:plugin`, `check:traceability`, and `check:submission`. `npm run package:macos-arm64` builds the judge archive, `npm run check:release-reproducibility` compares two clean archive builds and their normalized metadata, and `npm run verify:release` verifies the checksum, transactional install/upgrade behavior, owned uninstall boundaries, replay, fixture, and content boundaries. CI runs the source and release-artifact gates on `macos-latest` for pull requests, `main` pushes, tags, and manual dispatches, while checking that build/test steps leave no tracked or unignored artifacts. The E2E suite replays all seven specification fixtures from [`fixtures/repositories/spec-scenarios.json`](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/fixtures/repositories/spec-scenarios.json).

Run the bounded real-probe smoke test with an authenticated Codex CLI:

```sh
npm run smoke:real-probes
```

The 2026-07-14 fixture run used `codex-cli 0.144.4`, `gpt-5.6-sol`, and low reasoning. It produced three schema-valid plans on distinct fresh thread IDs with the same snapshot/task hashes, cleaned all disposable worktrees, and left the source checkout unchanged. The sanitized metadata evidence is in [`fixtures/app-server/real-probes-2026-07-14.json`](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/fixtures/app-server/real-probes-2026-07-14.json); plan text, raw reasoning, command output, and process environments are intentionally not retained.

Run the bounded comparator model evaluation (two fixtures × two models, one attempt each) with the authenticated Codex CLI:

```sh
npm run eval:comparator
```

The evaluator records only pass/fail, candidate counts, timing, App Server thread/turn IDs, and token usage. It never prints prompts, plans, model output, raw reasoning, process environments, or credentials. On 2026-07-15, both `gpt-5.6-sol` and `gpt-5.6-terra` passed 2/2 at low reasoning. Terra used 48,910 total tokens versus Sol's 49,131, completed in 21,619 ms versus 29,657 ms, and returned no unnecessary unknown on the divergence fixture, so `gpt-5.6-terra`/low remains the bounded empirical default. Sanitized metadata is in [`fixtures/app-server/comparator-eval-2026-07-15.json`](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/fixtures/app-server/comparator-eval-2026-07-15.json).

`tripwire review RUN_ID` starts a random-port loopback Decision Inbox while the run remains reviewable; Ctrl-C also closes it. Terminal/non-reviewable state, archive, or 30 minutes with neither authenticated activity nor an authenticated SSE stream closes the listener and revokes its in-memory capability without changing the persisted run or inferring approval. Mutation bodies are size-bounded and must finish within five seconds; after the short close grace, remaining connections are force-closed so an incomplete request cannot retain the listener. The capability token appears only in the one-time URL fragment, is removed from the address bar after bootstrap, and is required as an authorization header for the aggregate review API and authenticated fetch-based SSE stream. The UI shows at most three decision cards plus the remaining count, never preselects a high-impact option, supports selection, free-form resolution, defer, pre-approval edit, explicit approval, cancellation, deviation display, keyboard operation, visible focus, and assistive-technology state announcements. Japanese browser settings select Japanese chrome automatically, and the visible `日本語 / English` switch changes only presentation; contract-bound task, model, evidence, and mutation data remain unchanged. The UI loads only its bundled React/Vite assets and renders all content as escaped text.

## Codex Plugin (explicit preflight)

The repository also contains a thin, repo-scoped Codex Plugin adapter. The
installed display name is `PromptTripwire` and its bundled Skill is `preflight`
under the `prompt-tripwire` plugin namespace. V1 has no automatic hook and no
MCP server: the Skill delegates to the existing `tripwire` CLI and never copies
policy, contract, worktree, or report logic.

The shortest supported installation starts from the unpacked macOS arm64
release artifact and installs both the runtime and Plugin without `sudo`:

```sh
./install.sh --with-codex-plugin
codex plugin list --json
```

This requires macOS arm64, Node.js 24.15+, Git, exactly `codex-cli 0.144.4`,
and an existing `codex login` session. It does not require or read
`OPENAI_API_KEY`. The default install and marketplace root is
`~/.local/lib/prompt-tripwire/0.1.6`; the installer keeps the marketplace source
as `./plugins/prompt-tripwire`, registers `prompt-tripwire-local`, installs and
enables `prompt-tripwire@prompt-tripwire-local`, and is safe to rerun. It does
not start inspect, select a decision, approve a contract, or run implementation.
When upgrading from an earlier release in the same prefix, the installer
repoints only launchers that resolve to a verified versioned PromptTripwire
install and rejects unrelated files or symlinks.

Plain `./install.sh` preserves the runtime-only installation path and makes no
Codex Plugin changes. For a custom user-local root, set
`PROMPT_TRIPWIRE_PREFIX` consistently for install and uninstall.

Codex displays the Plugin as `PromptTripwire`; the callable Skill is
`prompt-tripwire:preflight`. Start a new Codex task and say:

```text
Use prompt-tripwire:preflight before implementing this task.
```

The adapter starts an authenticated nested `codex app-server`. If the calling
Codex shell sandbox blocks that child from reaching the model service, the
Skill asks for the normal Codex command permission to run only the adapter
outside the caller shell sandbox. That permission is only for launching the
thin adapter and nested App Server; it is not a PromptTripwire decision,
contract approval, or permission to implement the task. If permission is
denied, preflight stops safely. After
`INSUFFICIENT_VALID_PROBES: request failed` occurs under the caller sandbox,
the Skill may retry once through that normal permission path. It never removes
the re-entry guard, adds an API key, or broadens the probe, comparator, or
executor restrictions.

The Skill runs a terminal `tripwire inspect`, returns the run summary, and
stops at the existing Decision Inbox whenever a contract needs human review or
choices. It never calls `approve` or selects a decision. After the user approves
in the Decision Inbox, the Skill can delegate `tripwire run` and `tripwire
report`; execution remains in PromptTripwire's disposable worktree.

PromptTripwire passes the exact caller task, including the explicit Skill name,
to its snapshot and probes. Its shared child App Server disables Plugin
contributions before thread creation so the installed Plugin cannot be
rediscovered from that text. The process guard remains defense in depth. This
does not disable standalone Skills; an attempted external read from one is
still rejected by repository containment. If the caller uses a custom
`CODEX_HOME`, the App Server uses it for the same existing login, but its child
commands inherit neither that path nor other caller environment values.

Remove the bundled Plugin and runtime together with:

```sh
~/.local/lib/prompt-tripwire/0.1.6/uninstall.sh --with-codex-plugin
```

The v0.1.6 installer stages the runtime, switches launchers atomically, and
verifies the Plugin and marketplace before committing an install or upgrade.
On a covered failure it restores the prior local and Codex Plugin state. The
uninstaller requires a private, version-matched ownership marker before
removing a runtime; it removes only `prompt-tripwire@prompt-tripwire-local`,
removes the `prompt-tripwire-local` marketplace only when it still points to
this install, and leaves every other Plugin and marketplace untouched. It is
safe to rerun from the unpacked artifact's
`./uninstall.sh --with-codex-plugin` if the versioned installed script is
already gone.

As a Git-marketplace fallback for development or when using the archive in
place, keep a working `tripwire` launcher on `PATH` (or set
`PROMPT_TRIPWIRE_BIN`) and run:

```sh
codex plugin marketplace add shuto-S/prompt-tripwire --ref v0.1.6
codex plugin add prompt-tripwire@prompt-tripwire-local
codex plugin list --marketplace prompt-tripwire-local
```

Use `--ref main` only when intentionally testing the development branch rather
than the release-matched runtime.

The Plugin does not bundle a second runtime or credential path. Unsupported
platforms, missing runtime/login, dirty checkouts, and re-entry from an
execution thread fail closed with an actionable error.

Use `tripwire review RUN_ID --terminal` for the terminal fallback. Both interfaces require expected run versions and idempotency keys for mutations, and execution remains disabled until every blocker is resolved and the content-addressed contract is explicitly approved.

`tripwire run --contract CONTRACT_ID` creates a fresh disposable execution worktree and Codex thread from the approved snapshot. The runtime disables network and remote tool surfaces, accepts a pathless file approval only after correlating it to a same-ID file item whose disclosed paths match the contract, declines permission or unknown-action requests, interrupts out-of-scope file changes, runs only the exact contract checks through sandboxed `command/exec`, persists the real exit codes and final path scope, and removes the worktree at the terminal state. A paused run can only continue through a new contract version and a clean execution worktree; partial work is never resumed.

`tripwire report RUN_ID` renders the sanitized JSON or Markdown audit record with contract hash, human decisions, thread/model IDs, observed actions, real checks, final diff scope, deviations, and remaining unknowns. `tripwire export` writes an explicit user-only copy. Terminal runs expire after seven days by default; `tripwire archive` pins one, `tripwire unarchive` restores normal retention, `tripwire purge-expired` removes expired database/artifact data, and `tripwire delete` explicitly removes a non-active run. Active execution and pending-worktree deletion are refused.

## Verified evidence and residual risks

On macOS/arm64 with `codex-cli 0.144.4`, the bounded live execution fixture completed with one contract-scoped file, `npm test` exit 0, no deviation, an unchanged source checkout, and a removed execution worktree. The local suite covers App Server disconnect, comparator tool denial/schema failure and late-request isolation, selected-alternative contract binding, task-only policy provenance, dependency no-change and contrast clauses, pre-thread and per-action canonical path containment, exact pinned-App-Server zsh command-envelope validation, basename-only and multi-target search validation, isolated `ZDOTDIR`, missing-command and failed-item handling, `.git` direct-read denial, exact-task Plugin-contribution isolation, custom Codex-home authentication propagation, two-stage Plugin re-entry, Decision Inbox lifecycle expiry, transactional installer rollback, snapshot drift, duplicate/reordered events, idempotent approval, controller restart, cleanup failure, retention/deletion, recorded replay immutability, Japanese/English UI presentation, UI capability/origin controls, secret redaction, seven specification fixtures, and FR-001–018 / AC-001–019 traceability. Current v0.1.6 results are reported from the verification commands rather than frozen here as test counts.

The compiled judge archive was also exercised end to end on 2026-07-15 with `OPENAI_API_KEY` and `CODEX_API_KEY` unset: three fresh Sol probes, one successful Terra comparison attempt, one explicit compatibility decision, contract approval, contained Codex execution, `npm test` pass, two contract-scoped paths, no deviation or external capability, an unchanged source fixture, and all four worktrees removed. Sanitized metadata is in [`fixtures/app-server/judge-live-2026-07-15.json`](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/fixtures/app-server/judge-live-2026-07-15.json).

Known residual risks are explicit:

- PromptTripwire is not a hardened boundary against a malicious repository or same-user local attacker.
- A local out-of-contract change may be detected only after it occurs inside a disposable worktree; the original checkout remains protected and the run is interrupted.
- A tracked secret inside an otherwise approved source path can still be read; secret pattern matching is a backstop, not proof.
- Required-check executable lookup is limited to the fixed macOS system/Homebrew `PATH` used by the P0 build.
- App Server/schema CLI surfaces remain labeled experimental even though runtime uses only the pinned normal schema.
- Disabling the App Server `plugins` feature removes Plugin contributions but not standalone system, user, or repository Skills; any external read they request is rejected rather than silently granted.
- The Sol/Terra selection is based on only two synthetic fixtures and can drift as models or App Server behavior change; rerun the bounded evaluation before making broader quality or cost claims.

## Build Week positioning

- **Track:** Developer Tools
- **Codex:** repository-grounded planning probes and approved execution
- **GPT-5.6:** schema-constrained comparison of plans into human-reviewable decisions
- **Differentiator:** detect ambiguity from actual Codex implementation divergence before code is written, then enforce the resulting contract

The project is being created during the OpenAI Build Week submission period. The initial commit is the baseline for all implementation work.

## Codex collaboration record

Codex researched current OpenAI integration surfaces, challenged the earlier UI-first concept, drafted the specification/threat model, built the protocol spike, and implemented the tested vertical slice and distribution. The human retained authority over the local-first/single-user scope, credential experience, fail-closed boundaries, and external publication.

Concrete outcomes include:

- **Accepted:** identical-input fresh probes, CLI-first conditional UI, App Server over stdio, and immutable execution contracts.
- **Changed:** direct Responses API comparison became an isolated tool-free App Server turn so Codex users need no extra API key; pathless file approvals became same-thread/same-item correlated approvals; required checks use a fixed non-secret executable `PATH` instead of inheriting the user environment.
- **Rejected:** forced expert personas, a synthetic risk score, raw-text trust for App Server `unknown` actions such as `pwd`/`sed`, runtime experimental permission expansion, and operational deploy/release/network authority in P0.

The exact baseline is `codex-cli 0.144.4`, `gpt-5.6-sol`/low for planning, and `gpt-5.6-terra`/low for comparison. The full accepted/changed/rejected record, dated commits from `39a32d7` through `dc77c15`, live evidence links, and the formal `/feedback` retrieval rule are in [docs/CODEX_COLLABORATION.md](docs/CODEX_COLLABORATION.md). The `/feedback` Session ID is intentionally not replaced by a local task UUID or committed to source; it must be copied from the primary Codex task into the Devpost field.

## License

PromptTripwire is licensed under the [Apache License 2.0](LICENSE).

## Status

Specification baseline: 2026-07-18. App Server hard gate, three-real-probe smoke, tool-free App Server Sol/Terra comparison, live compliant execution, full P0 traceability, macOS secret scan, seven specification fixtures, recorded replay, release reproducibility, and judge archive verification are covered by executable gates. No separate OpenAI API credential is required. The owned v0.1.2 demo, captions, thumbnail, and UI captures are present in the repository and excluded from the judge archive. v0.1.2, v0.1.3, v0.1.4, and v0.1.5 are immutable public historical evidence. [v0.1.6](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.6) is the current judge distribution; its public macOS arm64 archive and matching checksum were anonymously downloaded and verified on 2026-07-19 JST with SHA-256 `1b74c4c935e0fec1857b88b2a592f776c01f104a4042d224ef3ac1265fe83c33`. The public bytes matched the clean tag-aware candidate, the packaged quickstart self-references v0.1.6, and an isolated API-key-free Plugin invocation stopped at unapproved human review without changing the fixture. The valid v0.1.5 runtime remains historical with SHA-256 `b9df44c8a44d255a98f00953003d41e743e53059eec26ef79980730dccc5beaf`, but its packaged quickstart is superseded by v0.1.6. Public YouTube upload and Devpost final submission each remain behind an explicit human confirmation gate. The public v0.1.1 release is retained as earlier historical evidence with SHA-256 `7a29de3241bab426b2e9b9edd84a6d6f01dd0fc1bf13d71da3927a4a83277f50`.
