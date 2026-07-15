# OpenAI Build Week plan and compliance

Status date: 2026-07-15

Official source: [OpenAI Build Week Official Rules](https://openai.devpost.com/rules)

The official rules remain the source of truth. This document is an implementation checklist, not a substitute for rechecking the rules before submission.

## 1. Submission fit

- **Track:** Developer Tools
- **Project type:** local CLI plus lightweight local web UI
- **Primary user:** engineers delegating non-trivial repository work to Codex
- **Codex use:** multiple repository-grounded planning threads and contract-bound execution
- **GPT-5.6 use:** strict structured comparison of plans into consensus, divergence, unknowns, and evidence-linked decision candidates

## 2. Current official requirements

As of 2026-07-15, the rules state:

- Submission period: July 13, 2026 at 9:00 PT through July 21, 2026 at 17:00 PT.
- Deadline in Japan: July 22, 2026 at 09:00 JST.
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

Recorded replay may support judging reliability but cannot substitute for the working live project shown in the demo.

## 7. Demo outline (target 165 seconds)

1. **0–15s — Problem:** one confident Codex plan can hide an unmade product decision.
2. **15–35s — Task:** run `tripwire inspect` on a repository task with deletion semantics.
3. **35–65s — Real probes:** show three read-only Codex threads and identical snapshot/task hashes.
4. **65–100s — Decision Inbox:** show one consequential disagreement, effects, and repository evidence.
5. **100–120s — Contract:** choose an option and approve the generated boundary.
6. **120–150s — Enforcement:** start Codex; show either a prohibited deviation being interrupted or a compliant execution completing.
7. **150–165s — Report and stack:** show contract hash/audit record; state Codex and GPT-5.6 roles.

Keep full-plan comparisons, setup narration, and secondary features out of the video.

## 8. Submission checklist

### Product

- [x] All P0 functional requirements implemented.
- [x] AC-001 through AC-019 passing on the supported macOS build.
- [x] Real Codex App Server integration; no mocked core demo.
- [x] Real GPT-5.6 Structured Outputs integration.
- [x] Judge-ready install that does not require rebuilding.
- [x] Fixture/replay data contains no private code or credentials.
- [x] Known limitations visible in README and submission.

### Repository

- [x] Apache-2.0 selected as the project license for the public repository.
- [x] README includes installation, supported platforms, test instructions, architecture summary, and Codex collaboration.
- [x] Public repository verified anonymously; `v0.1.0` Release and macOS arm64 artifact are reachable without authentication.
- [x] Dated commits distinguish specification, implementation, and submission work.
- [x] Dependency licenses and third-party assets reviewed.
- [x] No secrets in Git history.

### Evidence

- [x] Primary Codex task used for most core functionality retained.
- [ ] `/feedback` Session ID captured and stored outside code until submission.
- [x] Exact Codex CLI, Codex model, GPT-5.6, Node, and package versions recorded.
- [x] Accepted, modified, and rejected Codex suggestions documented.
- [x] Human product, engineering, safety, and design decisions documented.
- [x] Actual verification commands and results recorded.

### Submission

- [x] English project description.
- [ ] Public YouTube video with audio under three minutes.
- [ ] Video contains only owned or permitted assets and trademarks.
- [ ] Repository URL and judge instructions verified from a clean machine/account.
- [ ] Free, unrestricted judging access maintained through the judging period.
- [ ] Devpost draft saved early and final submission completed before deadline.

## 9. Remaining submission actions

- Formal `/feedback` Session ID from the retained primary Codex task.
- Public YouTube demo and owned submission media.
- Final Devpost save/submit.

Publication evidence (2026-07-15 JST): repository `https://github.com/shuto-S/prompt-tripwire` is Public with Apache-2.0, release `v0.1.0` is live, and the unauthenticated release asset SHA-256 is `fbff8b060d6309d151f5ffdf66fc2c76abf2ebe39da4122195bba2c801856b98`.

These do not block the product specification or local release candidate, but they must be closed before external publication and final submission.
