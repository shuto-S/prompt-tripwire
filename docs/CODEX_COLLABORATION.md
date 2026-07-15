# Codex collaboration record

Status date: 2026-07-15

PromptTripwire was created during the OpenAI Build Week submission period. Codex served as the implementation partner across research, specification, protocol probing, product design, code, tests, security review, and release preparation. Human decisions remained authoritative for product scope, safety tradeoffs, credentials, public behavior, and external publication.

## Where Codex accelerated the work

- Compared Codex integration surfaces and built an executable App Server feasibility spike before product implementation.
- Translated the product idea into a traceable specification, threat model, decision log, architecture, and executable acceptance suite.
- Implemented the domain, policy, Git snapshot, persistence, probe, comparator, UI, execution, reporting, and recovery layers in dated increments.
- Generated fake-protocol and live boundary tests for approvals, event ordering, interruption, schema drift, environment isolation, and contained writes.
- Reconciled specification claims against implementation and strengthened fail-closed behavior where the first implementation was weaker than the written contract.
- Prepared a compiled judge artifact, clean safe fixture, release verification, English submission copy, and rule-to-evidence matrix.

## Human decisions and model contributions

| Outcome | Proposal or observation | Final decision and why |
|---|---|---|
| Accepted | Use three independent Codex planning threads with identical inputs. | Accepted as the core evidence source; role/persona prompts would manufacture divergence. |
| Accepted | Use a CLI-first flow with a conditional loopback Decision Inbox. | Accepted to keep the product native to Codex users while making consequential decisions legible. |
| Accepted | Convert approved choices into an immutable execution contract. | Accepted because a comparison-only tool would not prevent implementation drift. |
| Accepted | Use Codex App Server over local stdio. | Accepted for streamed items, approvals, diffs, interruption, and reuse of normal Codex authentication. |
| Changed | Use the direct OpenAI Responses API for GPT-5.6 comparison. | Replaced with an isolated, tool-free App Server thread after the human required zero extra credential setup for Codex users. |
| Changed | Reject every pathless file approval. | Narrowed to same-thread/same-`itemId` correlation with a previously disclosed contract-valid file item; empty, renamed, or uncorrelated paths still fail closed. |
| Changed | Inherit no environment for required checks. | Kept secret-free inheritance but supplied a fixed macOS system/Homebrew executable `PATH` so approved checks can actually start. |
| Changed | Treat comparator failure as missing evidence only. | Persisted observed thread/turn/usage metadata for failed attempts and forced deterministic manual review. |
| Rejected | Continue the earlier ContextForge concept. | Rejected for a sharper Codex-specific wedge: observed plan divergence plus contract enforcement. |
| Rejected | Give probes different expert personas. | Rejected because disagreement must arise from identical inputs. |
| Rejected | Display a synthetic aggregate risk score. | Rejected in favor of named categories, effects, reversibility, and evidence. |
| Rejected | Classify raw `pwd` or `sed` strings as safe when App Server reports `unknown`. | Rejected; the human chose fail-closed denial and narrower instructions rather than raw-text trust. |
| Rejected | Enable runtime experimental APIs for granular permissions. | Rejected; P0 pins the normal 0.144.4 schema and treats permission expansion as deny-only. |
| Rejected | Allow confirmed deploy, migration, release, remote write, or network operations inside P0. | Rejected; approval may cover local preparation only, while operational effects remain outside the executor. |

## Exact implementation baseline

- Codex CLI/App Server: `codex-cli 0.144.4`, normal schema only, stdio transport
- Planning probes: `gpt-5.6-sol`, low reasoning, three fresh threads
- Comparator: `gpt-5.6-terra`, low reasoning, fresh ephemeral tool-free thread
- Comparator evaluation: Sol 2/2 and Terra 2/2 on two bounded fixtures; Terra used 48,910 total tokens in 21,619 ms versus Sol's 49,131 in 29,657 ms
- Runtime: Node.js 24.15+ baseline, npm 11.17.0 package manager record

The Sol/Terra result is a bounded engineering choice, not a general model-quality or cost claim. Re-evaluate it if the fixtures, models, or App Server change.

## Dated implementation commits

| Date | Commit | Evidence |
|---|---|---|
| 2026-07-14 | `39a32d7` | TypeScript/npm workspace foundation |
| 2026-07-14 | `6d4b109` | Immutable domain contracts |
| 2026-07-14 | `32cfc70` | Deterministic policy gates |
| 2026-07-14 | `f351fe7` | Isolated Git snapshots/worktrees |
| 2026-07-14 | `9caa585` | Crash-safe local controller |
| 2026-07-14 | `439b684` | Independent real Codex probes |
| 2026-07-14 | `ee024e4` | GPT-5.6 comparison and terminal review |
| 2026-07-14 | `e2afe75` | Loopback Decision Inbox |
| 2026-07-14 | `bbdfaaa` | Contract-bound execution |
| 2026-07-14 | `c6a7cb6` | Audit/security/recovery suite |
| 2026-07-14 | `3b8ca38` | Live execution and security completion |
| 2026-07-15 | `dc77c15` | App Server authentication reuse for comparison |

Sanitized live evidence is retained in `fixtures/app-server/real-probes-2026-07-14.json`, `fixtures/app-server/comparator-eval-2026-07-15.json`, and `fixtures/app-server/judge-live-2026-07-15.json`. The last record covers the compiled archive's API-key-free inspect → decision → approval → contained execution → report flow. Raw reasoning, credentials, full environments, plan text from private work, and command output are intentionally not retained.

## Primary Codex task and `/feedback`

The primary Codex task that carried the specification and core implementation must be opened in Codex and submitted through `/feedback` with the existing session attached. The Session ID displayed after that submission is the Build Week value. A local task/thread UUID is not substituted for it and is not committed to source. The final ID belongs only in the Devpost submission field or private submission checklist.

This upload completed on 2026-07-15 through the App Server `feedback/upload` method with the retained primary thread attached. The returned Session ID remains outside the repository for Devpost entry.
