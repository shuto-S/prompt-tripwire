# PromptTripwire

> Codex asks when it knows it is uncertain. PromptTripwire detects when
> reasonable Codex runs silently disagree—and turns the human answer into an
> execution contract.

Codexは、自分が曖昧だと気づいたことを質問する。PromptTripwireは、1回の
Codexが暗黙に決めたことを複数実行の差から発見し、その回答を実行契約として
拘束します。

PromptTripwire is a local-first preflight and execution gate for Codex. Its
judge-facing value is one short chain:

**observed divergence → human decision → contract-bound execution**

1. **Find the hidden decision.** Three fresh, read-only Codex planning threads
   receive the same task, repository snapshot, instructions, model settings,
   and output schema. PromptTripwire compares their validated outputs rather
   than manufacturing disagreement with personas.
2. **Focus human judgment.** The Decision Inbox shows whether a question came
   from observed divergence, deterministic policy, both, or insufficient
   provenance; it shows option support as counts while keeping raw probe IDs in
   the evidence drawer.
3. **Turn the answer into authority.** The human answer becomes an immutable,
   snapshot-bound execution contract. No model or Plugin approves it.
4. **Execute inside the boundary.** Codex runs in a disposable worktree with
   network and remote effects denied. Paths, commands, effects, and required
   checks are compared with the contract during execution.
5. **Stop and report.** A deviation interrupts the run; a successful run
   produces a sanitized report linked to the contract hash.

## Why this exists

A single coding-agent plan can look confident while silently choosing an API
shape, migration strategy, file scope, or external action that the developer
never intended. Reviewing that one plan cannot reveal that another reasonable
run would make a different product decision.

PromptTripwire uses plan divergence as evidence. It asks only when independent Codex runs materially disagree or when a deterministic safety rule requires confirmation.

## How this differs from Codex's standard controls

PromptTripwire complements Plan mode and action approval; it does not replace or
undervalue them.

| Surface | What triggers it | What the human receives | What constrains later execution |
|---|---|---|---|
| Codex Plan mode / clarification | The active Codex turn explores a plan or recognizes a question | One plan and any questions raised in that conversation | The accepted conversational plan remains task context |
| Codex action approval | Codex requests permission for a concrete tool or command action | Allow/deny control for that requested action | The approval governs that action under the active Codex policy |
| PromptTripwire | Independent same-input plans materially disagree, or deterministic policy requires review | A focused decision with provenance and support counts | The explicit answer becomes a snapshot-bound contract checked against paths, commands, effects, and required checks |

## Intended experience

```text
$ tripwire inspect --task "Add account deletion"

3 Codex probes completed against commit 8f21c4a
2 decisions require review
Decision Inbox: http://127.0.0.1:43127/runs/run_01...
```

The local UI shows decision cards, not three walls of plan text. The primary
view exposes the valid probe count, decision source, material alternative count,
and option support count. Raw probe IDs and repository evidence remain
available under **Evidence and policy triggers**.

- hard delete vs. delayed deletion;
- revoke sessions immediately vs. at job completion;
- the repository evidence behind each interpretation;
- the files, data, and external effects each option changes.

After review, PromptTripwire groups the unchanged contract as **What Codex may
change**, **What must pass**, and **What remains blocked**. Codex runs in an
isolated worktree with network and remote tools disabled throughout P0
execution. A high-impact decision may approve local implementation that
prepares an effect, but PromptTripwire does not perform that operation. Contract
deviations pause the run and require an explicit update or rejection.

The CLI remains the primary entry point. The loopback-only Decision Inbox opens
only for human review or deviations, and a terminal fallback carries the same
stable decision and option IDs. No hosted PromptTripwire account or separate
OpenAI API key is required.

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
- [v0.1.9 release notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.9/docs/RELEASE_NOTES_v0.1.9.md)
- [v0.1.10 release notes](docs/RELEASE_NOTES_v0.1.10.md)
- [v0.1.11 release notes](docs/RELEASE_NOTES_v0.1.11.md)
- [v0.1.12 release notes](docs/RELEASE_NOTES_v0.1.12.md)
- [v0.1.8 release notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.8/docs/RELEASE_NOTES_v0.1.8.md)
- [v0.1.7 release notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.7/docs/RELEASE_NOTES_v0.1.7.md)
- [v0.1.6 release notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.6/docs/RELEASE_NOTES_v0.1.6.md)
- [v0.1.5 release notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.5/docs/RELEASE_NOTES_v0.1.5.md)
- [v0.1.4 release notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.4/docs/RELEASE_NOTES_v0.1.4.md)
- [v0.1.3 release notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.3/docs/RELEASE_NOTES_v0.1.3.md)
- [v0.1.2 release notes](docs/RELEASE_NOTES_v0.1.2.md)
- [Codex collaboration record](docs/CODEX_COLLABORATION.md)
- [Decision log and open questions](docs/DECISIONS.md)
- [Codex App Server 0.144.4 feasibility spike](docs/CODEX_APP_SERVER_SPIKE.md)

`docs/SPECIFICATION.md` is the authoritative product scope. The other documents provide implementation detail and evidence.

## Release compatibility history

The demo is a v0.1.2 capture. The judge distribution is v0.1.12. Releases v0.1.3 through v0.1.12 improved compatibility, safety, localization, and presentation precision without changing the video's human-approval or contract boundary.

The current judge distribution is v0.1.12. It measures the resolved Codex
executable's consumed normal schema, handshake, and bounded private-temp canary
instead of branching on a numeric Codex version; required-surface, canary, or
executable drift fails closed. It also includes explicit-only Plugin metadata,
source-bound Japanese reference translations, deterministic source redaction,
child Plugin isolation, canonical path checks, and transactional Plugin
installation. Releases v0.1.3 through v0.1.12 are compatibility, safety,
localization, and presentation-precision improvements. Their dated details are
preserved in the linked release notes rather than occupying the product
introduction.

## Judge quickstart

The final judge artifact is the compiled v0.1.12 JavaScript/runtime archive for macOS arm64. It does not require the TypeScript source tree or a source build. Download the archive and its matching checksum from the [v0.1.12 GitHub Release](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.12). Earlier releases remain immutable historical evidence and their checksums must not be reused for v0.1.12.

The v0.1.12 release requires Node.js 24.15+, npm 11+, Git, and an already authenticated Codex CLI whose normal App Server passes the measured compatibility profile. PromptTripwire reuses the existing login for probes, GPT-5.6 comparison, and execution. It does not require `OPENAI_API_KEY`, expose an API-key setting, or copy Codex credentials.

### 30-second proof (recorded and read-only)

From the unpacked v0.1.12 artifact directory:

```sh
shasum -a 256 -c SHA256SUMS.txt
tar -xzf prompt-tripwire-v0.1.12-macos-arm64.tar.gz
cd prompt-tripwire-v0.1.12-macos-arm64
./bin/tripwire --version
./bin/tripwire replay --terminal
```

`tripwire replay` is recorded UI evidence only. It makes no Codex call,
executes no code, and does not prove the live integration, approval boundary, or
worktree containment.

### Complete live proof

Use the new Codex task invocation `$prompt-tripwire:preflight`, then follow the
safe fixture through `inspect → review → approve → contained execution →
report`. Keep these identifiers distinct:

- `DIST_VERSION=0.1.12`: the verified distribution version;
- `DIST`: the unpacked artifact directory and command CWD;
- `FIXTURE`: the generated target repository;
- `RUN_ID`: the value printed by `inspect` or the Plugin;
- `CONTRACT_ID`: the value printed only after human decision and approval.

The exact copy/paste commands, install step, and expected unchanged source
status are in the [Judge Guide](docs/JUDGE_GUIDE.md). Verify v0.1.12 only with
the checksum file from that same release; historical checksums must not be
reused.

## Demo and submission status

Issue #43 has a new [49-second judge UX source
preview](https://github.com/shuto-S/prompt-tripwire/blob/main/docs/assets/demo/prompt-tripwire-issue-43-source-preview.mp4) with
[English](https://github.com/shuto-S/prompt-tripwire/blob/main/docs/assets/demo/decision-origin-issue-43-source-preview-en.png),
[Japanese](https://github.com/shuto-S/prompt-tripwire/blob/main/docs/assets/demo/decision-origin-issue-43-source-preview-ja.png),
[mobile Japanese](https://github.com/shuto-S/prompt-tripwire/blob/main/docs/assets/demo/decision-origin-issue-43-source-preview-mobile-ja.png),
and [contract preview](https://github.com/shuto-S/prompt-tripwire/blob/main/docs/assets/demo/contract-preview-issue-43-source-preview-en.png)
screenshots. It demonstrates decision provenance, support counts, and direct
contract grouping from a deterministic safe fixture. It is explicitly a
v0.1.12 UI source preview—not a live Codex inspect, execution, or report. Its
reproducible command and provenance are in the
[demo notes](https://github.com/shuto-S/prompt-tripwire/blob/main/docs/demo/README.md).

[![PromptTripwire v0.1.2 demo thumbnail](https://raw.githubusercontent.com/shuto-S/prompt-tripwire/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-thumbnail.png)](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-demo.mp4)

The repository contains the final local [v0.1.2 demo video](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-demo.mp4), [English captions](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/prompt-tripwire-v0.1.2-demo.en.srt), [live Decision Inbox capture](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/decision-inbox-v0.1.2-live.png), and [sanitized report capture](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/evidence-report-v0.1.2.png). The 2:52.862 video is 1920×1080 H.264 with AAC stereo audio and embedded English subtitles. See the [demo evidence notes and narration](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/README.md) for exact format details and disclosure.

These files are a v0.1.2 capture and are not represented as footage of the
v0.1.12 judge distribution. The live Inbox scene comes from an API-key-free
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

Supported Build Week development environment:

- macOS on arm64;
- Node.js 24.15 or newer in the Node 24 LTS line (`.nvmrc` and `.node-version`);
- npm 11 or newer, with npm 11.17.0 recorded in `packageManager`;
- an authenticated Codex CLI whose normal schema, handshake, and bounded canary pass the shared compatibility profile.

Known-good evidence includes the historical 0.144.4 Build Week baseline and the
current 0.144.6 development smoke. These are documented guarantees, not a
runtime allowlist or per-version code path; other versions are decided solely
by measured compatibility.

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

`tripwire review RUN_ID` starts a random-port loopback Decision Inbox while the run remains reviewable; Ctrl-C also closes it. Terminal/non-reviewable state, archive, or 30 minutes with neither authenticated activity nor an authenticated SSE stream closes the listener and revokes its in-memory capability without changing the persisted run or inferring approval. Mutation bodies are size-bounded and must finish within five seconds; after the short close grace, remaining connections are force-closed so an incomplete request cannot retain the listener. The capability token appears only in the one-time URL fragment, is removed from the address bar after bootstrap, and is required as an authorization header for the aggregate review API and authenticated fetch-based SSE stream. The UI shows at most three decision cards plus the remaining count, never preselects a high-impact option, supports selection, free-form resolution, defer, pre-approval edit, explicit approval, cancellation, deviation display, keyboard operation, visible focus, and assistive-technology state announcements. Japanese browser settings select Japanese presentation automatically, and the visible `日本語 / English` switch changes only presentation. Japanese task and decision text is explicitly labeled as a reference translation with an expandable, deterministically sanitized authoritative source copy; canonical task, model output, evidence, decisions, contracts, mutation data, and reports remain unchanged in persistence. The UI loads only its bundled React/Vite assets and renders all content as escaped text.

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

This requires macOS arm64, Node.js 24.15+, Git, a Codex CLI command with an
existing `codex login` session, and no numeric Codex version match. The runtime
measures normal-schema/handshake/canary compatibility before inspect. It does
not require or read `OPENAI_API_KEY`. The v0.1.12 release's default install
and marketplace root is `~/.local/lib/prompt-tripwire/0.1.12`; the installer keeps the marketplace source
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
`prompt-tripwire:preflight`. Its bundled metadata disables implicit invocation.
Start a new Codex task and invoke it explicitly with the `$` Skill mention:

```text
$prompt-tripwire:preflight
Inspect this task before implementing it: ...
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
~/.local/lib/prompt-tripwire/0.1.12/uninstall.sh --with-codex-plugin
```

The v0.1.12 installer stages the runtime, switches launchers atomically, and
verifies the Plugin and marketplace before committing an install or upgrade.
On a covered failure it restores the prior local and Codex Plugin state. The
uninstaller requires a private, version-matched ownership marker before
removing a runtime; it removes only `prompt-tripwire@prompt-tripwire-local`,
removes the `prompt-tripwire-local` marketplace only when it still points to
this install, and leaves every other Plugin and marketplace untouched. It is
safe to rerun from the unpacked artifact's
`./uninstall.sh --with-codex-plugin` if the versioned installed script is
already gone.
It does not require a Codex version during removal. If Codex itself is absent,
it removes PromptTripwire-owned local files, leaves global Codex configuration
untouched, and reports the Plugin registration that could not be safely removed.

As a Git-marketplace fallback for development or when using the archive in
place, keep a working `tripwire` launcher on `PATH` (or set
`PROMPT_TRIPWIRE_BIN`) and run:

```sh
codex plugin marketplace add shuto-S/prompt-tripwire --ref v0.1.12
codex plugin add prompt-tripwire@prompt-tripwire-local
codex plugin list --marketplace prompt-tripwire-local
```

Use the matching v0.1.12 release tag. Never mix a Plugin adapter and runtime
from different PromptTripwire versions.

The Plugin does not bundle a second runtime or credential path. Unsupported
platforms, missing runtime/login, dirty checkouts, and re-entry from an
execution thread fail closed with an actionable error.

Use `tripwire review RUN_ID --terminal` for the terminal fallback. Both interfaces require expected run versions and idempotency keys for mutations, and execution remains disabled until every blocker is resolved and the content-addressed contract is explicitly approved.

`tripwire run --contract CONTRACT_ID` creates a fresh disposable execution worktree and Codex thread from the approved snapshot. The runtime disables network and remote tool surfaces, accepts a pathless file approval only after correlating it to a same-ID file item whose disclosed paths match the contract, declines permission or unknown-action requests, interrupts out-of-scope file changes, runs only the exact contract checks through sandboxed `command/exec`, persists the real exit codes and final path scope, and removes the worktree at the terminal state. A paused run can only continue through a new contract version and a clean execution worktree; partial work is never resumed.

`tripwire report RUN_ID` renders the sanitized JSON or Markdown audit record with contract hash, human decisions, thread/model IDs, observed actions, real checks, final diff scope, deviations, and remaining unknowns. `tripwire export` writes an explicit user-only copy. Terminal runs expire after seven days by default; `tripwire archive` pins one, `tripwire unarchive` restores normal retention, `tripwire purge-expired` removes expired database/artifact data, and `tripwire delete` explicitly removes a non-active run. Active execution and pending-worktree deletion are refused.

## Verified evidence and residual risks

On macOS/arm64, the historical 0.144.4 bounded live execution fixture completed with one contract-scoped file, `npm test` exit 0, no deviation, an unchanged source checkout, and a removed execution worktree. The v0.1.12 suite additionally covers arbitrary-version compatible schema/handshake/canary behavior, safe additive schema, required-surface loss, unknown runtime requests and enum variants, executable/attestation drift across inspect/approve/run, and canary failure before repository or worktree operations. Current results are reported from the verification commands rather than frozen here as test counts.

The compiled judge archive was also exercised end to end on 2026-07-15 with `OPENAI_API_KEY` and `CODEX_API_KEY` unset: three fresh Sol probes, one successful Terra comparison attempt, one explicit compatibility decision, contract approval, contained Codex execution, `npm test` pass, two contract-scoped paths, no deviation or external capability, an unchanged source fixture, and all four worktrees removed. Sanitized metadata is in [`fixtures/app-server/judge-live-2026-07-15.json`](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/fixtures/app-server/judge-live-2026-07-15.json).

Known residual risks are explicit:

- PromptTripwire is not a hardened boundary against a malicious repository or same-user local attacker.
- A local out-of-contract change may be detected only after it occurs inside a disposable worktree; the original checkout remains protected and the run is interrupted.
- A tracked secret inside an otherwise approved source path can still be read; secret pattern matching is a backstop, not proof.
- Required-check executable lookup is limited to the fixed macOS system/Homebrew `PATH` used by the P0 build.
- App Server/schema CLI surfaces remain labeled experimental even though runtime uses only the measured normal-schema profile and never enables runtime `experimentalApi`.
- The bounded canary cannot detect same-schema semantic drift outside the behavior it observes; this remains a residual risk.
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

The historical Build Week evidence baseline is `codex-cli 0.144.4`, `gpt-5.6-sol`/low for planning, and `gpt-5.6-terra`/low for comparison. Active code does not branch on that Codex version. The full accepted/changed/rejected record, dated commits from `39a32d7` through `dc77c15`, live evidence links, and the formal `/feedback` retrieval rule are in [docs/CODEX_COLLABORATION.md](docs/CODEX_COLLABORATION.md). The `/feedback` Session ID is intentionally not replaced by a local task UUID or committed to source; it must be copied from the primary Codex task into the Devpost field.

## License

PromptTripwire is licensed under the [Apache License 2.0](LICENSE).

## Status

Specification baseline: 2026-07-20. Measured App Server compatibility, three-real-probe smoke, tool-free App Server Sol/Terra comparison, source-bound Japanese reference presentation, live compliant execution, full P0 traceability, macOS secret scan, seven specification fixtures, recorded replay, release reproducibility, and judge archive verification are covered by executable gates. No separate OpenAI API credential is required. The owned v0.1.2 demo, captions, thumbnail, and UI captures are present in the repository and excluded from the judge archive. v0.1.12 is the release candidate for Issue #43's judge-facing provenance, support-count, and contract-preview UX. The last anonymously verified public distribution before this candidate is [v0.1.11](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.11), with macOS arm64 archive SHA-256 `33efb9b1d9cca9f22f0b843169d9d59efd80c744aee5601cc7fb1e1ad36b816b`. Earlier public releases remain immutable historical evidence. YouTube upload is authorized for the separately disclosed v0.1.2 evidence capture; Devpost final submission remains behind an explicit human confirmation gate.
