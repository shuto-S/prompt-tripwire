# Devpost submission draft

This file prepares the English submission fields. It is not a saved or final Devpost submission.

The demo is a v0.1.2 capture. The judge distribution is v0.1.12. Releases v0.1.3 through v0.1.12 improved compatibility, safety, localization, and presentation precision without changing the video's human-approval or contract boundary.

## Project identity

- **Name:** PromptTripwire
- **Category:** Developer Tools
- **Tagline:** See where Codex disagrees before it writes code.
- **Repository URL:** `https://github.com/shuto-S/prompt-tripwire`
- **Repository access:** Public, Apache-2.0
- **Supported platform:** macOS arm64
- **Release artifact:** [v0.1.12 macOS arm64](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.12), release candidate pending publication and anonymous verification
- **Release SHA-256:** `33efb9b1d9cca9f22f0b843169d9d59efd80c744aee5601cc7fb1e1ad36b816b` (2,341,471 bytes; 927 files; source `7f5d55c8bbdc6e54cdd448fdf2b9b2751cc5c099`)
- **Demo video:** `<PENDING HUMAN CONFIRMATION: upload to YouTube, then add the anonymously verified public URL>`; [local v0.1.2 review copy](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-demo.mp4), 2:52.862 with audio. The recording predates the v0.1.3 launcher hardening through v0.1.12 measured-compatibility and explicit-only Plugin improvements described below.
- **Codex /feedback Session ID:** `<PENDING: paste the formal Session ID captured outside source into Devpost>`

The formal Session ID was captured on 2026-07-15 and is intentionally retained outside source until Devpost entry. Do not replace the placeholder with a local task/thread UUID.

## One-line pitch

Codex asks when it knows it is uncertain. PromptTripwire detects when reasonable Codex runs silently disagree—and turns the human answer into an execution contract.

## Inspiration

A coding agent can produce a confident plan while silently choosing deletion semantics, API compatibility, dependency scope, or an external action the developer never approved. Reviewing one plan does not reveal that another equally reasonable Codex run would make a different product decision. Action approvals arrive later, after the ambiguity has already shaped the implementation.

PromptTripwire uses observed plan divergence as early evidence. It asks only about choices that change behavior, scope, data, APIs, permissions, reversibility, or verification, then carries the answer into execution.

## Concrete judge story

The safe judge task looks small: update `greeting(name)` so it trims surrounding
whitespace and returns `Hello, stranger!` for an empty trimmed name. The hidden
decision is compatibility. Reasonable same-input Codex plans may disagree about
whether callers that relied on the old whitespace behavior should change.

PromptTripwire runs three read-only probes, reports how many valid probes
support each material alternative, and labels whether the decision came from
observed divergence, deterministic policy, both, or insufficient provenance.
The judge—not Codex—chooses **Allow local implementation**. The resulting
contract permits only `src/greeting.js` and `test/greeting.test.js`, requires
`npm test`, and keeps dependencies, network, remote writes, publish, deploy,
release, and other external effects blocked. Execution occurs in a disposable
worktree; the report ties the observed diff and passing check back to the
approved contract hash while the original fixture remains unchanged.

## What it does

1. Freezes a Git snapshot without modifying the user's checkout.
2. Runs three fresh, read-only Codex planning threads against identical task, snapshot, instructions, model, and schema inputs.
3. Uses GPT-5.6 Structured Outputs in a separate tool-free App Server thread to normalize consensus, divergence, unknowns, and evidence references.
4. Applies `deterministic-v2` fail-closed rules to the original task and the validated plans for destructive, external, privileged, production, dependency, API, and irreversible effects, while preserving task-only provenance instead of claiming probe support.
5. Shows at most three focused decision cards at a time in a loopback-only Decision Inbox or terminal fallback.
6. When Japanese is selected, shows a source-bound reference translation of the task and decision content while keeping an expandable, deterministically sanitized authoritative source copy and unchanged approval identity.
7. Creates an immutable, content-addressed execution contract bound to the approved snapshot.
8. Runs Codex in a disposable worktree, denies network/remote/high-impact effects, correlates approvals to contract evidence, and interrupts deviations.
9. Produces a sanitized JSON/Markdown report with decisions, contract hash, threads/models, observed actions, checks, diff scope, and remaining unknowns.

## How it was built

PromptTripwire is a local TypeScript/Node.js workspace. It uses one OpenAI integration path: `codex app-server` over stdio. Before reading the target repository, one shared profile measures the resolved executable's consumed normal-schema surface, handshake, and bounded private-temp canary; the version string is audit metadata, not an allowlist. That App Server path supplies authentication, threads, schema-constrained turns, streamed items, approvals, diffs, token usage, and interruption. The existing Codex CLI login is reused; PromptTripwire does not require `OPENAI_API_KEY` or copy Codex credentials.

Planning uses `gpt-5.6-sol` at low reasoning. Comparison uses `gpt-5.6-terra` at low reasoning after a bounded Sol/Terra evaluation. Zod-derived schemas validate model output, a deterministic policy engine adds mandatory decisions, `node:sqlite` persists crash-safe state, Git worktrees contain probe/execution changes, and React/Vite provides a bundled same-origin Decision Inbox. The v0.1.2 distribution also audits canonical symlink containment before probes and at each static-read approval, expires the review capability at lifecycle/idle boundaries without changing run state, propagates only a non-secret Plugin re-entry sentinel through the minimal App Server environment, rolls failed installs/upgrades back across local and Codex Plugin state, and verifies deterministic archive output.

An API-key-free live Plugin invocation of the clean v0.1.2 artifact then exposed a pinned Codex App Server 0.144.4 compatibility mismatch: a structured `listFiles` action with command `ls` was reported as an actual command through `/bin/zsh -c` or `/bin/zsh -lc`. The public v0.1.3 release accepts only those exact three-token launcher envelopes, re-tokenizes and cross-checks the single inner command, and keeps the existing grammar, canonical-path, protected-content, sandbox, and network checks. It also assigns App Server an empty controller-owned mode-`0700` `ZDOTDIR`, rejects missing actual commands, observes failed command/file items, and denies direct planning-probe reads of `.git` content.

A fresh v0.1.3 install then exposed a second boundary: the child App Server retained the exact explicit Plugin task, rediscovered the installed PromptTripwire Skill, and attempted to read it outside the disposable repository. The run correctly failed closed before review or implementation. v0.1.4 disables Plugin contributions at shared App Server startup without rewriting the task, retains the re-entry sentinel, preserves custom Codex-home authentication for App Server only, and accepts the pinned basename-only or multi-target `rg` shape only after every actual operand passes canonical and protected-content checks.

v0.1.5 adds browser-locale-aware Japanese Decision Inbox chrome and a visible
`日本語 / English` switch. Localization never rewrites the task, model output,
evidence, decision identifiers, contract content, mutations, or reports, and it
cannot select a decision or approve a contract.

v0.1.6 keeps the runtime behavior unchanged and corrects every release name,
archive path, install root, uninstall command, and Git marketplace tag shipped
inside the judge documentation. The v0.1.5 tag and assets remain untouched.

v0.1.7 fixes a deterministic-policy false positive found during a real
approval-to-execution rehearsal. An explicit coordinated prohibition such as
`Do not add dependencies, access the network, publish, deploy, or perform any
external action` now remains one negated list. Ambiguous comma splices and
later positive clauses still fail closed. The approval, contract, containment,
report, authentication, Plugin, and platform boundaries are unchanged.

v0.1.8 constrains each planning probe's `commands` output to literal shell-free
argv strings. It keeps the already-active PromptTripwire workflow directive and
explanatory check prose out of that field, while malformed values remain
fail-closed instead of being normalized into executable authority.

v0.1.9 requires planning probes to invoke allowlisted inspection programs by
bare name. A real v0.1.8 flow twice stopped fail-closed when Codex 0.144.4 chose
`/bin/ls` and App Server reported it as `unknown`. v0.1.9 removes that notation
at generation while keeping the unknown-action and canonical-path gates intact.

v0.1.10 adds a separate Japanese reference-presentation turn after final
decision normalization. It reuses the authenticated Codex App Server with no
tools or network and binds output to exact source decision/option IDs and effect
counts. The UI labels the translation as reference text and exposes the source;
policy, decision IDs, mutations, contracts, hashes, execution, and reports never
consume the translation. Invalid or unavailable output falls back visibly to
source text without inferring approval.

v0.1.12 replaces numeric Codex version gates with measured normal-schema,
handshake, and bounded-canary compatibility. The attestation is bound to the
snapshot and contract and is remeasured before approval and execution; any
drift makes the prior approval stale. The bundled Plugin Skill also declares
`allow_implicit_invocation: false`, so Codex requires an explicit
`$prompt-tripwire:preflight` mention. Secret-like source text is redacted before
the translation turn and from the browser DTO without changing canonical
persistence, IDs, hashes, contracts, or mutations.
No hook, MCP server, hosted backend, API key, or automatic approval is added.

## Challenges

- Codex 0.144.4 reports some apparently read-only commands such as `pwd` and `sed` as `unknown`. PromptTripwire kept fail-closed denial and changed probe instructions instead of trusting raw shell text.
- Stable file approval requests omit paths. PromptTripwire accepts one only when a same-thread, same-ID file item already disclosed contract-valid non-empty paths, then validates completed items and diffs again.
- A permitted local command can write before aggregate diff monitoring reacts. PromptTripwire states this honestly: the write is contained in a disposable worktree, detected, interrupted, and never described as perfectly prevented.
- Direct API comparison would add another credential path. Reusing an isolated App Server thread removed the extra API-key setup and secret handling.
- Static-read labels are insufficient when a repository symlink resolves outside the probe worktree. v0.1.2 adds a whole-worktree canonical audit before any probe thread and repeats canonical CWD/path resolution at each approval.
- Runtime files, launchers, marketplace state, and Plugin state form one user-visible installation. v0.1.2 stages local changes and restores the prior verified state when a covered install or upgrade step fails.
- A literal token comparison was too strict for the real App Server launcher representation, but broadly trusting shell wrappers would have introduced startup-file and command-smuggling risks. v0.1.3 normalizes only the two observed zsh envelopes, requires exact inner-action equality, isolates `ZDOTDIR`, and rejects every other shell, flag, argument, compound command, redirection, or substitution.
- A prompt-only re-entry warning cannot stop Plugin discovery that happens before the adapter runs. v0.1.4 preserves the request as task evidence but disables Plugin contributions at process startup and keeps the sentinel as a second control. Lossy search metadata is never trusted in place of validating every command operand.
- A safe read can still become an `unknown` action when a model chooses an executable path such as `/bin/ls`. v0.1.9 requires bare program names in probe instructions and keeps the unknown action denied instead of normalizing raw command text.
- A numeric CLI version can reject compatible updates without proving behavior. v0.1.12 instead validates the exact consumed schema and a bounded semantic canary, then fails closed on missing surfaces or measured drift.

## Accomplishments

- Real three-thread identical-input planning, not persona-generated disagreement.
- Real GPT-5.6 schema-constrained comparison with bounded Sol/Terra evidence.
- Human choices change machine-enforced paths, components, assumptions, and checks.
- High-impact operational intent can authorize local preparation but never silently authorize the operation itself.
- P0 functional requirements FR-001–018 and acceptance criteria AC-001–019 have executable traceability.
- The judge archive runs without rebuilding from TypeScript and includes a safe fixture plus explicitly recorded read-only replay.
- Original task text remains a deterministic safety input even when every generated plan omits a requested high-impact action; task-only evidence never masquerades as probe consensus.
- The Decision Inbox capability closes on terminal/archive boundaries or authenticated inactivity without converting transport shutdown into approval, cancellation, or any other human decision.
- Release packaging normalizes entry order, ownership, modes, timestamps, and gzip metadata, then compares two builds for the same digest.
- The v0.1.4 compatibility patch was derived from a real logged-in Codex CLI/App Server invocation without API-key environment variables and backed by Plugin-context A/B, exact-task live probe, search-operand, environment-isolation, and adversarial containment checks.
- The published v0.1.5 archive was anonymously downloaded, matched byte-for-byte with the clean tagged candidate, installed into an isolated prefix, and invoked from a real logged-in Codex task with API-key variables unset. It stopped at human review with no approved contract and left the fixture unchanged.
- The v0.1.12 release candidate accepts compatible Codex behavior without version branches, packages an explicit-only thin Plugin, adds judge-facing provenance/support/contract-preview UX, and retains transactional install/uninstall plus the existing human approval and containment gates.

## What was learned

The most important product insight was that ambiguity detection and action approval are incomplete in isolation. The useful unit is a chain: multiple grounded interpretations, small explicit decisions, an immutable agreement, and runtime evidence that the implementation stayed inside it.

The most important engineering insight was to distinguish preventive controls from detective controls. App Server event ordering, pathless approvals, and contained writes required precise claims rather than a generic "sandboxed" label.

## What's next

- Verify Linux with the same containment and end-to-end suite before advertising support.
- Expand comparator evaluation beyond two synthetic fixtures.
- Explore custom repository policy files and sanitized team-review exports.
- Revisit narrowly enforceable capability grants only when a stable App Server surface can preserve the current fail-closed guarantees.

Hosted backends, account systems, team approvals, non-Codex adapters, and automatic deploy/release/migration actions remain intentionally out of the MVP.

## Judge instructions

After publication, download the v0.1.12 macOS arm64 release artifact and its matching checksum, verify them together, and follow `JUDGE_GUIDE.md`. Its packaged README and Judge Guide self-reference v0.1.12. v0.1.11 and earlier releases remain immutable historical evidence. It supports:

- direct `./bin/tripwire` execution;
- one-command user-local install/uninstall;
- `tripwire replay` for an explicitly recorded, read-only UI sample;
- a dependency-free safe fixture for the real inspect → review → approve → contained execution → report flow;
- no PromptTripwire account, hosted service, source build, or separate OpenAI API key.

Known limitations are visible in the README, Judge Guide, and security document. Judges should use a repository they trust enough to inspect with Codex; PromptTripwire is not a malware-analysis sandbox.

## Suggested tags

`codex`, `gpt-5.6`, `developer-tools`, `agentic-workflows`, `security`, `code-review`, `typescript`, `local-first`

## Prepared media

Issue #43 also has a repository-local 49-second source preview with English
narration and subtitles plus English, Japanese, mobile Japanese, and contract
screenshots. It demonstrates the updated judge-facing presentation using a
deterministic safe fixture. It is supplemental review material only: it is not
a live Codex run, not execution evidence, and not footage of the published
v0.1.12 judge distribution. It must not silently replace the canonical v0.1.2
submission demo or be uploaded as final evidence without a separate version and
human review.

- **Thumbnail:** [original PromptTripwire thumbnail](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-thumbnail.png)
- **Demo video:** [local v0.1.2 review copy](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-demo.mp4) — 2:52.862, 1920×1080 H.264, AAC stereo 48 kHz, embedded default English `mov_text` subtitles
- **English captions:** [74-cue sidecar](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/prompt-tripwire-v0.1.2-demo.en.srt) — maximum measured rate 19.08 characters per second
- **Narration and evidence notes:** [demo documentation](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/README.md)
- **Screenshot — human-decision boundary:** [live v0.1.2 Decision Inbox](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/decision-inbox-v0.1.2-live.png) — one unresolved compatibility decision, no dependency blocker, no selected option, and no approved contract
- **Screenshot — result evidence:** [sanitized report](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/evidence-report-v0.1.2.png) — a separate earlier human-approved safe-fixture run, with two contract-scoped paths, passing `npm test`, no deviation, and no remaining unknown

The Inbox scene is from an actual API-key-free v0.1.2 Codex Skill inspect. Its
source status, HEAD, and worktree list remained unchanged. The later contract,
execution, and report scenes are explicitly disclosed in the narration as a
separate safe-fixture run that a human approved earlier; they are not presented
as a continuation of the untouched Inbox. Repository media is excluded from
the compact release archive. After publication, the public YouTube video will
be the primary submission link and this repository copy will remain the
review/offline fallback.

## YouTube confirmation packet (upload pending)

The media is the completed v0.1.2 capture; v0.1.12 is the final judge
distribution and includes later compatibility, safety, localization,
documentation, and deterministic-policy precision patches. Before opening the upload flow,
present this entire packet to the human and wait for explicit confirmation.
The public URL and anonymous playback verification remain pending.

- **Title:** `PromptTripwire — Human Decisions and Contract-Bound Codex Execution`
- **Description:**

  > PromptTripwire is a local-first preflight and execution gate for Codex.
  >
  > It runs three independent read-only Codex App Server planning probes against
  > the same task and repository snapshot, turns material disagreement into
  > explicit human decisions, and executes an approved contract in an isolated
  > Codex thread and disposable Git worktree.
  >
  > Built for the OpenAI Build Week Developer Tools track with Codex App Server,
  > gpt-5.6-sol planning probes, and a tool-free gpt-5.6-terra comparator.
  >
  > Repository: https://github.com/shuto-S/prompt-tripwire
  > Release (macOS arm64): https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.12
  >
  > This video is the completed v0.1.2 capture. v0.1.12 is the final judge
  > distribution to install; the footage is not presented as a v0.1.12
  > recording.
  >
  > No separate OPENAI_API_KEY is required. PromptTripwire reuses the logged-in
  > Codex CLI / App Server session and never auto-approves human decisions.

- **Upload file:** `docs/assets/demo/prompt-tripwire-v0.1.2-demo.mp4` — 2:52.862, 1920×1080, 30 fps, H.264 video, AAC stereo 48 kHz; SHA-256 `dcc4c8f602ea32ee893a47661316be3a83093ebb46647f08b0e44a0ab4e2f8a7`
- **Captions:** `docs/demo/prompt-tripwire-v0.1.2-demo.en.srt` — English, 74 cues
- **Thumbnail:** `docs/assets/demo/prompt-tripwire-v0.1.2-thumbnail.png` — 1280×720
- **Visibility:** Public
- **Audience:** Not made for kids
- **Language:** English
- **Category:** Science & Technology
- **License:** Standard YouTube License

The Release line targets the v0.1.12 asset after publication and anonymous verification.
Show the complete title, description, visibility, captions, thumbnail, and
settings once more and wait for explicit human confirmation. Uploading,
publishing, or changing visibility before that confirmation is prohibited by
this preparation checklist.

## Final Devpost confirmation packet (submission pending)

Prepare and, if useful, save the draft without final-submitting it. Immediately
before final submission, show the human the complete assembled entry and wait
for explicit confirmation. The confirmation view must include:

- project name, Developer Tools category, tagline, public repository, Apache-2.0 license, and macOS arm64 support;
- the anonymously verified v0.1.12 Release URL and checksum evidence;
- the anonymously verified public YouTube URL, thumbnail, and v0.1.2-capture/v0.1.12-distribution disclosure;
- the exact body from **One-line pitch** through **What's next**, plus **Judge instructions**, known limitations, and tags;
- the README, Judge Guide, release notes, demo documentation, screenshots, captions, and repository review-copy links;
- the formal Codex `/feedback` Session ID in Devpost's dedicated field, copied from the retained external record and never written into this repository; and
- the final submit control, still untouched.

Saving or previewing a draft is not authorization to submit. Do not press the
final Devpost submit control until the human explicitly confirms the displayed
packet.

## Rights and English review

- Submission copy, fixture, diagrams, and UI are original project material.
- UI uses system fonts and CSS; no third-party runtime images, fonts, analytics, stock media, or copied design assets.
- The final local demo uses only owned product screen capture, original copy, a macOS system voice, and system fonts. It contains no music, OpenAI/Devpost logos, stock media, third-party repository content, or unlicensed assets.
- The committed media was reviewed for capability tokens, secrets, raw model reasoning, and local absolute paths; none are retained.
- Third-party software is listed in `docs/DEPENDENCIES.md` and checked from the lockfile.
- README, testing instructions, release notes, and this draft are English.

## Final external-action checklist

- [x] Select public + Apache-2.0 as the repository route.
- [x] Preserve the anonymously verified historical v0.1.1 artifact SHA-256: `7a29de3241bab426b2e9b9edd84a6d6f01dd0fc1bf13d71da3927a4a83277f50`.
- [x] Build, publish, and anonymously verify the distinct v0.1.2 artifact and checksum.
- [x] Build, publish, and anonymously verify the v0.1.4 compatibility-patch artifact and checksum.
- [x] Build and locally verify the v0.1.6 documentation-correction artifact and checksum.
- [x] Publish and anonymously verify the v0.1.6 artifact, checksum, and packaged instructions.
- [x] Build, publish, and anonymously verify the v0.1.7 deterministic-policy precision artifact and packaged instructions; its real Plugin flow exposed the plan-command issue corrected in v0.1.8.
- [x] Build, publish, and anonymously verify the v0.1.8 plan-command guidance artifact, checksum, and packaged instructions; its real Plugin flow exposed the bare-program issue corrected in v0.1.9.
- [x] Build, publish, and anonymously verify the v0.1.9 bare-program guidance artifact, checksum, packaged instructions, isolated install, and real pre-approval Plugin flow.
- [x] Build, publish, and verify the v0.1.10 Japanese-reference artifact and checksum as historical evidence.
- [x] Publish and anonymously verify the completed v0.1.11 measured-compatibility artifact, checksum, packaged instructions, API-key-free explicit Plugin installation, and targeted uninstall.
- [ ] Publish and anonymously verify the v0.1.12 Issue #43 judge-UX artifact, checksum, packaged instructions, API-key-free explicit Plugin installation, and targeted uninstall.
- [x] Obtain the formal `/feedback` Session ID from the primary Codex task and retain it outside source.
- [x] Regenerate the owned local v0.1.2 demo with audio under three minutes, English captions, thumbnail, and screenshots.
- [ ] Obtain explicit human confirmation for the resolved YouTube packet, upload the completed v0.1.2 demo/captions, and verify public playback anonymously.
- [x] Add the reviewed owned thumbnail, screenshots, video, captions, and narration to the repository.
- [ ] Save the Devpost draft.
- [ ] Present the complete Devpost packet and obtain explicit human confirmation immediately before final submission.
- [ ] Final-submit before July 22, 2026 at 09:00 JST only after that confirmation.
