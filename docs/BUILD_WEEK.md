# OpenAI Build Week plan and compliance

Status date: 2026-07-19

Official source: [OpenAI Build Week Official Rules](https://openai.devpost.com/rules)

The official rules remain the source of truth. This document is an implementation checklist, not a substitute for rechecking the rules before submission.

## 1. Submission fit

- **Track:** Developer Tools
- **Project type:** local CLI plus lightweight local web UI
- **Primary user:** engineers delegating non-trivial repository work to Codex
- **Codex use:** multiple repository-grounded planning threads and contract-bound execution
- **GPT-5.6 use:** strict structured comparison of plans into consensus, divergence, unknowns, and evidence-linked decision candidates

## 2. Current official requirements

As of 2026-07-18, the rules state:

- Submission period: July 13, 2026 at 9:00 PT through July 21, 2026 at 17:00 PT.
- Deadline in Japan: July 22, 2026 at 09:00 JST.
- Free project access must remain available through the judging period ending
  August 5, 2026 at 17:00 PT.
- The project must be built with Codex and GPT-5.6 and fit one of four tracks.
- It must install and run consistently as depicted.
- The submission needs a text description and a public YouTube demo with audio under three minutes.
- The video must explain what was built and how Codex and GPT-5.6 were used.
- The code repository must be public with relevant licensing or private and shared with `testing@devpost.com` and `build-week-event@openai.com`.
- The README must explain collaboration with Codex, Codex acceleration, human product/engineering/design decisions, and contributions from GPT-5.6 and Codex.
- A `/feedback` Codex Session ID from the thread where most core functionality was built is required.
- Developer tools need installation instructions, supported platforms, and a judge-ready way to test without rebuilding from scratch.
- Submission materials must be in English or include English translations.

## 3. Scope created during the event

PromptTripwire has no pre-event codebase. The specification and repository begin during the submission period.

The initial specification commit is the baseline. All implementation must retain dated Git history and Codex session evidence. If code or assets from another project are reused later, their pre-existing origin and Build Week extension must be documented before submission.

## 4. Judging strategy

The official judging categories are equally weighted.

### Technological Implementation

Demonstrate real Codex App Server integration, three independent read-only Codex threads, GPT-5.6 Structured Outputs, deterministic policy, immutable contracts, runtime approval handling, and a contained deviation stop. Avoid mocked core behavior in the submitted demo.

### Design

Show one coherent flow from CLI task intake to focused decision cards, contract approval, execution, and report. The UI exists to compress judgment, not decorate raw model output.

### Potential Impact

Use a credible task where two plausible implementations have different data or product consequences. Quantify time/cost only from actual tests. Clearly identify Codex users as the initial audience.

### Quality of the Idea

Emphasize the three-part wedge: identical-input Codex divergence, decision extraction, and execution-contract enforcement. Acknowledge adjacent plan-review and approval tools and show the specific difference.

## 5. Delivery plan

| Date (JST) | Target |
|---|---|
| Jul 14 | Specification, research, protocol assumptions, repository baseline |
| Jul 15 | Domain schemas, state machine, policy tests, fake App Server harness |
| Jul 16 | Git snapshot containment and three real read-only Codex probes |
| Jul 17 | GPT-5.6 comparator, deterministic decision extraction, terminal review |
| Jul 18 | Local Decision Inbox UI and contract approval |
| Jul 19 | Execution gate, deviation interruption, clean restart, reports |
| Jul 20 | End-to-end tests, security checks, packaging, judge install path |
| Jul 21 | Demo recording, English copy, Devpost draft, permissions, buffer |
| Jul 22 before 09:00 | Final verification and submission only; no risky feature work |

If the schedule slips, retain the differentiated vertical slice. Cut P1 features, extra platforms, historical analytics, and visual polish before cutting real probes or contract enforcement.

## 6. Judge-ready distribution

The selected target is a relocatable compiled/runtime macOS arm64 archive that does not require a TypeScript source build. It includes:

- supported OS/architecture and minimum versions;
- Codex authentication prerequisites;
- authenticated Codex CLI setup, with no separate API-key requirement;
- one-command install and uninstall;
- a bundled dependency-free safe fixture repository and demo task;
- an offline replay mode for UI exploration if live model limits occur, clearly labeled recorded and enforced read-only;
- a live mode for judges to verify the real Codex/GPT-5.6 integration;
- troubleshooting for permissions, API limits, and unsupported Codex versions.
- deterministic archive metadata and a two-build reproducibility check;
- transactional runtime-plus-Plugin install/upgrade with owned uninstall boundaries.

Recorded replay may support judging reliability but cannot substitute for the working live project shown in the demo.

## 7. Final local demo (172.862 seconds)

The owned [v0.1.2 demo video](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-demo.mp4),
[thumbnail](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/prompt-tripwire-v0.1.2-thumbnail.png), [English
captions](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/prompt-tripwire-v0.1.2-demo.en.srt), [live Decision Inbox
capture](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/decision-inbox-v0.1.2-live.png), and [sanitized report
capture](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/assets/demo/evidence-report-v0.1.2.png) are committed for review and
offline playback. The video is 1920×1080 H.264 with AAC stereo audio and
embedded English subtitles. Its 2:52.862 runtime is below the three-minute
limit; the sidecar contains 74 cues with a measured maximum of 19.08 characters
per second. The [demo notes](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/README.md) record the media hash, narration,
format, and evidence boundary.

This is explicitly a v0.1.2 capture. v0.1.3 added the pinned App Server's exact
zsh launcher compatibility and startup isolation. v0.1.4 is a further
compatibility and fail-closed patch, not a newly recorded demo: it preserves the
exact Plugin task while disabling child Plugin contributions, keeps the
re-entry sentinel, preserves custom Codex-home login for App Server only, and
validates every target in basename-only or multi-target static searches.
v0.1.5 adds Japanese Decision Inbox presentation and a visible language switch;
it is also not a newly recorded demo. Contract-bound task, evidence, mutation,
approval, and report data remain unchanged.
v0.1.6 keeps that product behavior unchanged and corrects the versioned
quickstart, install, uninstall, and marketplace references packaged in the
judge archive.

v0.1.7 corrects a deterministic-policy false positive discovered during the
final approval-to-execution rehearsal. Explicit coordinated prohibition lists
such as `Do not add dependencies, access the network, publish, deploy, or
perform any external action` remain under one negation. Ambiguous comma splices
and later positive clauses remain fail-closed. No approval, contract,
containment, report, authentication, Plugin, or platform boundary is weakened.

The captured flow is:

1. the hidden-decision problem and explicit Plugin invocation;
2. three same-input, read-only Codex planning probes and the tool-free GPT-5.6 comparator;
3. an actual API-key-free v0.1.2 Decision Inbox with one unresolved compatibility decision, no dependency blocker, and no human choice selected;
4. an explicit transition to a separate safe-fixture run that a human approved earlier;
5. its contract-bound isolated execution and passing required check;
6. the sanitized report, thin Plugin architecture, re-entry guard, and supported baseline.

The live inspect left the source checkout, HEAD, and worktree list unchanged.
The later contract/execution/report footage is not represented as a continuation
of that untouched Inbox. The public YouTube upload will become the primary demo
only after the prepared title, description, visibility, captions, and thumbnail
receive human confirmation. The repository media remains a review fallback and
is excluded from the judge release archive.

## 8. Submission checklist

### Product

- [x] All P0 functional requirements implemented.
- [x] Run the complete v0.1.7 source and release gates after the version bump.
- [x] Real Codex App Server integration; no mocked core demo.
- [x] Real GPT-5.6 Structured Outputs integration.
- [x] Judge-ready install that does not require rebuilding.
- [x] Fixture/replay data contains no private code or credentials.
- [x] Known limitations visible in README and submission.

### Repository

- [x] Apache-2.0 selected as the project license for the public repository.
- [x] README includes installation, supported platforms, test instructions, architecture summary, and Codex collaboration.
- [x] Public repository and `v0.1.2` / `v0.1.3` / `v0.1.4` / `v0.1.5` / `v0.1.6` Releases verified anonymously.
- [x] Publish the verified `v0.1.6` macOS arm64 artifact and checksum, then verify both anonymously.
- [ ] Publish the verified `v0.1.7` macOS arm64 artifact and checksum, then verify both anonymously.
- [x] Dated commits distinguish specification, implementation, and submission work.
- [x] Dependency licenses and third-party assets reviewed.
- [x] No secrets in Git history.

### Evidence

- [x] Primary Codex task used for most core functionality retained.
- [x] `/feedback` Session ID captured and stored outside code until submission.
- [x] Exact Codex CLI, Codex model, GPT-5.6, Node, and package versions recorded.
- [x] Accepted, modified, and rejected Codex suggestions documented.
- [x] Human product, engineering, safety, and design decisions documented.
- [x] Actual verification commands and results recorded.

### Submission

- [x] English project description.
- [x] A local v0.1.1 English demo draft with audio under three minutes was preserved separately from the v0.1.2 distribution source.
- [x] Regenerate owned local demo media against v0.1.2.
- [ ] Public YouTube video with audio under three minutes.
- [x] Confirm the regenerated final video contains only owned or permitted assets and trademarks.
- [x] Repository URL, release artifact, checksum, and judge instructions verified from an anonymous clean environment.
- [ ] Free, unrestricted judging access maintained through the judging period.
- [ ] Devpost draft saved early and final submission completed before deadline; final submission requires explicit human confirmation.

## 9. Remaining submission actions

- Present the prepared YouTube video, title, description, visibility, captions, and thumbnail for human confirmation; only then upload and verify playback anonymously.
- Replace the Devpost public video placeholder after YouTube publication and prepare the complete draft; present the final field/attachment/link packet for a separate human confirmation before final submission.

Publication evidence: repository `https://github.com/shuto-S/prompt-tripwire` is Public with Apache-2.0. The prepared v0.1.7 release still requires public-asset and anonymous real-Plugin verification. The public v0.1.6 release and its downloaded artifact/checksum were verified anonymously on 2026-07-19 JST; its macOS arm64 archive SHA-256 is `1b74c4c935e0fec1857b88b2a592f776c01f104a4042d224ef3ac1265fe83c33`. Its public bytes matched the clean tag-aware candidate, the packaged README and Judge Guide self-reference v0.1.6, and an isolated-prefix install enabled Plugin version 0.1.6 without API-key environment variables. A real logged-in Skill invocation exited safely at unapproved `needs_review`; the final rehearsal later exposed the coordinated-negation false positive corrected in v0.1.7. Fixture status, HEAD, and sole-worktree inventory remained unchanged. Targeted uninstall removed only the test Plugin, marketplace, and runtime, and the copied authentication plus token-bearing private log were deleted. The valid public v0.1.5 runtime remains immutable historical evidence with SHA-256 `b9df44c8a44d255a98f00953003d41e743e53059eec26ef79980730dccc5beaf`, but its packaged quickstart still names v0.1.4 and is superseded by later releases. The public v0.1.4 archive SHA-256 is `02a30d1f202e18da556aff576ef6d01d82970973e2566639e116615cc6aea4fa`; the public v0.1.3 archive SHA-256 is `2328e2673ab2fd67d4bd3043dc2c838fc584fad1a10719da28dcbcfd38156682`, the public v0.1.2 archive SHA-256 is `73d61b8262b5c81be558a89b800ddaa0f5d71c4c9e46679893c3c93b1bbfee3f`, and the earlier public v0.1.1 release remains historical evidence with SHA-256 `7a29de3241bab426b2e9b9edd84a6d6f01dd0fc1bf13d71da3927a4a83277f50`. Historical checksums do not verify the v0.1.7 archive.

A final local v0.1.2 H.264/AAC English demo, caption/narration copy, thumbnail,
and owned UI captures are now in `docs/demo/` and `docs/assets/demo/`. The live
Inbox scene remains unresolved and unapproved; the separately disclosed later
scenes use an earlier human-approved safe-fixture run. These files are present
in the repository but intentionally excluded from the compact judge archive.
They are local review evidence, not proof of public YouTube publication.

The v0.1.7 policy patch, Release, checksum, packaged instructions, anonymous
artifact/Plugin verification, and contract-bound rehearsal remain to be
completed before the YouTube confirmation gate. YouTube upload and Devpost
final submission remain blocked on their respective explicit human
confirmations.
