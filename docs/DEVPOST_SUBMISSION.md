# Devpost submission draft

This file prepares the English submission fields. It is not a saved or final Devpost submission.

## Project identity

- **Name:** PromptTripwire
- **Category:** Developer Tools
- **Tagline:** See where Codex disagrees before it writes code.
- **Repository URL:** `https://github.com/shuto-S/prompt-tripwire`
- **Repository access:** Public, Apache-2.0
- **Supported platform:** macOS arm64
- **Release artifact:** `https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.0`
- **Demo video:** `<PENDING: public YouTube URL, audio, under 3 minutes>`
- **Codex /feedback Session ID:** `<PENDING: run /feedback in the primary Codex task, attach the existing session, and copy the returned Session ID here>`

Do not replace the Session ID placeholder with a local task/thread UUID.

## One-line pitch

PromptTripwire runs the same repository task through three independent Codex plans, turns implementation-changing disagreement into explicit human decisions, and enforces the approved result as a contract around the final Codex run.

## Inspiration

A coding agent can produce a confident plan while silently choosing deletion semantics, API compatibility, dependency scope, or an external action the developer never approved. Reviewing one plan does not reveal that another equally reasonable Codex run would make a different product decision. Action approvals arrive later, after the ambiguity has already shaped the implementation.

PromptTripwire uses observed plan divergence as early evidence. It asks only about choices that change behavior, scope, data, APIs, permissions, reversibility, or verification, then carries the answer into execution.

## What it does

1. Freezes a Git snapshot without modifying the user's checkout.
2. Runs three fresh, read-only Codex planning threads against identical task, snapshot, instructions, model, and schema inputs.
3. Uses GPT-5.6 Structured Outputs in a separate tool-free App Server thread to normalize consensus, divergence, unknowns, and evidence references.
4. Applies deterministic fail-closed rules for destructive, external, privileged, production, dependency, API, and irreversible effects.
5. Shows at most three focused decision cards at a time in a loopback-only Decision Inbox or terminal fallback.
6. Creates an immutable, content-addressed execution contract bound to the approved snapshot.
7. Runs Codex in a disposable worktree, denies network/remote/high-impact effects, correlates approvals to contract evidence, and interrupts deviations.
8. Produces a sanitized JSON/Markdown report with decisions, contract hash, threads/models, observed actions, checks, diff scope, and remaining unknowns.

## How it was built

PromptTripwire is a local TypeScript/Node.js workspace. It uses one OpenAI integration path: `codex app-server` 0.144.4 over stdio. That path supplies authentication, threads, schema-constrained turns, streamed items, approvals, diffs, token usage, and interruption. The existing Codex CLI login is reused; PromptTripwire does not require `OPENAI_API_KEY` or copy Codex credentials.

Planning uses `gpt-5.6-sol` at low reasoning. Comparison uses `gpt-5.6-terra` at low reasoning after a bounded Sol/Terra evaluation. Zod-derived schemas validate model output, a deterministic policy engine adds mandatory decisions, `node:sqlite` persists crash-safe state, Git worktrees contain probe/execution changes, and React/Vite provides a bundled same-origin Decision Inbox.

## Challenges

- Codex 0.144.4 reports some apparently read-only commands such as `pwd` and `sed` as `unknown`. PromptTripwire kept fail-closed denial and changed probe instructions instead of trusting raw shell text.
- Stable file approval requests omit paths. PromptTripwire accepts one only when a same-thread, same-ID file item already disclosed contract-valid non-empty paths, then validates completed items and diffs again.
- A permitted local command can write before aggregate diff monitoring reacts. PromptTripwire states this honestly: the write is contained in a disposable worktree, detected, interrupted, and never described as perfectly prevented.
- Direct API comparison would add another credential path. Reusing an isolated App Server thread removed the extra API-key setup and secret handling.

## Accomplishments

- Real three-thread identical-input planning, not persona-generated disagreement.
- Real GPT-5.6 schema-constrained comparison with bounded Sol/Terra evidence.
- Human choices change machine-enforced paths, components, assumptions, and checks.
- High-impact operational intent can authorize local preparation but never silently authorize the operation itself.
- P0 functional requirements FR-001–018 and acceptance criteria AC-001–019 have executable traceability.
- The judge archive runs without rebuilding from TypeScript and includes a safe fixture plus explicitly recorded read-only replay.

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

Download the macOS arm64 release artifact and checksum, then follow `JUDGE_GUIDE.md`. The archive supports:

- direct `./bin/tripwire` execution;
- one-command user-local install/uninstall;
- `tripwire replay` for an explicitly recorded, read-only UI sample;
- a dependency-free safe fixture for the real inspect → review → approve → contained execution → report flow;
- no PromptTripwire account, hosted service, source build, or separate OpenAI API key.

Known limitations are visible in the README, Judge Guide, and security document. Judges should use a repository they trust enough to inspect with Codex; PromptTripwire is not a malware-analysis sandbox.

## Suggested tags

`codex`, `gpt-5.6`, `developer-tools`, `agentic-workflows`, `security`, `code-review`, `typescript`, `local-first`

## Media placeholders

- **Thumbnail (recommended 1280×720):** `<PENDING: original PromptTripwire title + Decision Inbox crop; no third-party logo>`
- **Screenshot 1:** `<PENDING: CLI showing three same-snapshot probe completions>`
- **Screenshot 2:** `<PENDING: Decision Inbox with one material divergence and evidence>`
- **Screenshot 3:** `<PENDING: contract-bound execution report/deviation evidence>`
- **Demo video:** `<PENDING: public YouTube URL; audio; under 3:00>`

## Rights and English review

- Submission copy, fixture, diagrams, and UI are original project material.
- UI uses system fonts and CSS; no third-party runtime images, fonts, analytics, stock media, or copied design assets.
- The later demo should use only product screen capture and original narration. Do not add music, OpenAI/Devpost logos, third-party repository content, or unlicensed assets.
- Third-party software is listed in `docs/DEPENDENCIES.md` and checked from the lockfile.
- README, testing instructions, release notes, and this draft are English.

## Final external-action checklist

- [x] Select public + Apache-2.0 as the repository route.
- [x] Verify the final GitHub Release artifact/checksum from an unauthenticated download: `fbff8b060d6309d151f5ffdf66fc2c76abf2ebe39da4122195bba2c801856b98`.
- [ ] Obtain the formal `/feedback` Session ID from the primary Codex task.
- [ ] Record and upload the public YouTube demo with audio under three minutes.
- [ ] Replace thumbnail/screenshot/video placeholders with owned media.
- [ ] Save the Devpost draft.
- [ ] Final-submit before July 22, 2026 at 09:00 JST.
