# OpenAI Build Week plan and compliance

Status date: 2026-07-20

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

v0.1.8 constrains planning-probe `commands` output to literal shell-free argv
strings. It prevents the already-active preflight directive and explanatory
check sentences from becoming avoidable unknown decisions, while the strict
command parser still fails closed on malformed values.

v0.1.9 requires each planning probe to invoke allowlisted inspection programs
by bare name. It prevents Codex 0.144.4 from choosing `/bin/ls`, which the App
Server correctly reports as `unknown`, without normalizing that denied shape or
weakening canonical containment.

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
- [x] Run the complete v0.1.9 source and release gates after the version bump.
- [x] Real Codex App Server integration; no mocked core demo.
- [x] Real GPT-5.6 Structured Outputs integration.
- [x] Judge-ready install that does not require rebuilding.
- [x] Fixture/replay data contains no private code or credentials.
- [x] Known limitations visible in README and submission.

### Repository

- [x] Apache-2.0 selected as the project license for the public repository.
- [x] README includes installation, supported platforms, test instructions, architecture summary, and Codex collaboration.
- [x] Public repository and `v0.1.2` through `v0.1.8` Releases verified anonymously.
- [x] Publish the verified `v0.1.6` macOS arm64 artifact and checksum, then verify both anonymously.
- [x] Publish the verified `v0.1.7` macOS arm64 artifact and checksum, then verify both anonymously.
- [x] Publish the verified `v0.1.8` macOS arm64 artifact and checksum, then verify both anonymously.
- [x] Publish the verified `v0.1.9` macOS arm64 artifact and checksum, then verify both anonymously.
- [ ] Publish the verified `v0.1.10` macOS arm64 artifact and checksum, then verify both anonymously.
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

Publication evidence: repository `https://github.com/shuto-S/prompt-tripwire` is Public with Apache-2.0. The public v0.1.9 archive and checksum were downloaded anonymously on 2026-07-20 JST. SHA-256 `8e1fa4ea296eb7d64c3fb453d21121037c63fe68a919c0fd51de483d6436d9c0`, size 2,314,606 bytes, 921 verified files, and source commit `de6c4bb458793d3395155f370b0c0e22d24ef773` match the clean tag-aware candidate byte-for-byte. Its packaged runtime reports 0.1.9, packaged instructions self-reference v0.1.9, and an isolated API-key-free install enabled Plugin 0.1.9. The real Skill invocation stopped before implementation inside the caller sandbox; the one permitted normal-permission thin-adapter retry reached `needs_review` with one compatibility decision, no approved contract, and an unchanged source checkout. v0.1.10 adds source-bound Japanese reference translation after that review exposed English decision effects, without changing the human-approval or contract boundary. The public v0.1.8 release remains immutable historical evidence with SHA-256 `0b5ca45f3cf497917df9f0b1c531aa4e8cf5b9e75eb46e47128c5fa3d09e351c`; the v0.1.7 archive remains historical evidence with SHA-256 `c6fe5b1f51bfd81dff7ebdce5f5f5f46eef01c6cb4dced0fd7213723ba9611f6`; and the v0.1.6 archive remains historical evidence with SHA-256 `1b74c4c935e0fec1857b88b2a592f776c01f104a4042d224ef3ac1265fe83c33`. Historical checksums do not verify the v0.1.10 archive.

A final local v0.1.2 H.264/AAC English demo, caption/narration copy, thumbnail,
and owned UI captures are now in `docs/demo/` and `docs/assets/demo/`. The live
Inbox scene remains unresolved and unapproved; the separately disclosed later
scenes use an earlier human-approved safe-fixture run. These files are present
in the repository but intentionally excluded from the compact judge archive.
They are local review evidence, not proof of public YouTube publication.

The v0.1.9 public artifact, isolated install, and pre-approval Plugin flow are
verified. The v0.1.10 Japanese-reference patch now requires its own clean
artifact, anonymous verification, API-key-free Plugin flow, explicit human
decision, contained execution, report, and targeted uninstall rehearsal before
the YouTube confirmation gate. YouTube upload and Devpost final submission
remain blocked on their respective explicit human confirmations.

Post-submission product work is separated from the Build Week critical path:
[#35](https://github.com/shuto-S/prompt-tripwire/issues/35) tracks Linux,
[#36](https://github.com/shuto-S/prompt-tripwire/issues/36) custom repository
policy, [#37](https://github.com/shuto-S/prompt-tripwire/issues/37) sanitized
review export, [#38](https://github.com/shuto-S/prompt-tripwire/issues/38)
Codex version policy, and
[#39](https://github.com/shuto-S/prompt-tripwire/issues/39) comparator and
deterministic-policy fixture expansion.
