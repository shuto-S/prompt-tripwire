# PromptTripwire

> See where Codex disagrees before it writes code.

PromptTripwire is a local-first preflight and execution gate for Codex. It runs the same engineering task through multiple independent, read-only Codex planning threads, turns material disagreements into a small number of human decisions, and binds the approved choices into an execution contract.

The local-first P0 engine and judge distribution are implemented and tested: a unified Codex App Server 0.144.4 planning/comparison/execution adapter, three independent real planning probes, tool-free GPT-5.6 structured comparison, deterministic policy normalization, terminal and browser review/approval, immutable contracts, Git worktree containment, contract-bound execution/deviation handling, sanitized audit reports, crash recovery, retention, security/traceability gates, a compiled macOS arm64 archive, a safe fixture, and an explicitly recorded read-only replay.

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
- [Devpost submission draft](docs/DEVPOST_SUBMISSION.md)
- [Codex collaboration record](docs/CODEX_COLLABORATION.md)
- [Decision log and open questions](docs/DECISIONS.md)
- [Codex App Server 0.144.4 feasibility spike](docs/CODEX_APP_SERVER_SPIKE.md)

`docs/SPECIFICATION.md` is the authoritative product scope. The other documents provide implementation detail and evidence.

## Judge quickstart

The judge artifact is a compiled JavaScript/runtime archive for macOS arm64. It does not require the TypeScript source tree or a source build.

Prerequisites are Node.js 24.15+, npm 11+, Git, and an already authenticated `codex-cli 0.144.4`. PromptTripwire reuses the existing Codex CLI login for probes, GPT-5.6 comparison, and execution. It does not require `OPENAI_API_KEY`, expose an API-key setting, or copy Codex credentials.

```sh
shasum -a 256 -c SHA256SUMS.txt
tar -xzf prompt-tripwire-v0.1.0-macos-arm64.tar.gz
cd prompt-tripwire-v0.1.0-macos-arm64
./bin/tripwire --help
./bin/tripwire replay --terminal
```

`tripwire replay` is clearly labeled recorded and read-only; it makes no Codex call and executes no code. The included dependency-free fixture exercises the real `inspect → review → approve → contained execution → report` path. See the [Judge Guide](docs/JUDGE_GUIDE.md) for exact commands, install/uninstall, safety boundaries, and troubleshooting.

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

Individual entry points are available for `typecheck`, `lint`, `build`, `test:unit`, `test:integration`, `test:e2e`, `check:boundaries`, `check:versions`, `check:schema`, `check:licenses`, `check:security`, `check:traceability`, and `check:submission`. `npm run package:macos-arm64` builds the judge archive and `npm run verify:release` verifies its checksum, install/uninstall path, replay, fixture, and content boundaries. CI runs the same source checks on `macos-latest` and verifies that build/test steps leave no tracked or unignored artifacts. The E2E suite replays all seven specification fixtures from [`fixtures/repositories/spec-scenarios.json`](fixtures/repositories/spec-scenarios.json).

Run the bounded real-probe smoke test with an authenticated Codex CLI:

```sh
npm run smoke:real-probes
```

The 2026-07-14 fixture run used `codex-cli 0.144.4`, `gpt-5.6-sol`, and low reasoning. It produced three schema-valid plans on distinct fresh thread IDs with the same snapshot/task hashes, cleaned all disposable worktrees, and left the source checkout unchanged. The sanitized metadata evidence is in [`fixtures/app-server/real-probes-2026-07-14.json`](fixtures/app-server/real-probes-2026-07-14.json); plan text, raw reasoning, command output, and process environments are intentionally not retained.

Run the bounded comparator model evaluation (two fixtures × two models, one attempt each) with the authenticated Codex CLI:

```sh
npm run eval:comparator
```

The evaluator records only pass/fail, candidate counts, timing, App Server thread/turn IDs, and token usage. It never prints prompts, plans, model output, raw reasoning, process environments, or credentials. On 2026-07-15, both `gpt-5.6-sol` and `gpt-5.6-terra` passed 2/2 at low reasoning. Terra used 48,910 total tokens versus Sol's 49,131, completed in 21,619 ms versus 29,657 ms, and returned no unnecessary unknown on the divergence fixture, so `gpt-5.6-terra`/low remains the bounded empirical default. Sanitized metadata is in [`fixtures/app-server/comparator-eval-2026-07-15.json`](fixtures/app-server/comparator-eval-2026-07-15.json).

`tripwire review RUN_ID` starts a random-port loopback Decision Inbox and keeps it available until Ctrl-C. The capability token appears only in the one-time URL fragment, is removed from the address bar after bootstrap, and is required as an authorization header for the aggregate review API and authenticated fetch-based SSE stream. The UI shows at most three decision cards plus the remaining count, never preselects a high-impact option, supports selection, free-form resolution, defer, pre-approval edit, explicit approval, cancellation, deviation display, keyboard operation, visible focus, and assistive-technology state announcements. It loads only its bundled React/Vite assets and renders model content as escaped text.

Use `tripwire review RUN_ID --terminal` for the terminal fallback. Both interfaces require expected run versions and idempotency keys for mutations, and execution remains disabled until every blocker is resolved and the content-addressed contract is explicitly approved.

`tripwire run --contract CONTRACT_ID` creates a fresh disposable execution worktree and Codex thread from the approved snapshot. The runtime disables network and remote tool surfaces, accepts a pathless file approval only after correlating it to a same-ID file item whose disclosed paths match the contract, declines permission or unknown-action requests, interrupts out-of-scope file changes, runs only the exact contract checks through sandboxed `command/exec`, persists the real exit codes and final path scope, and removes the worktree at the terminal state. A paused run can only continue through a new contract version and a clean execution worktree; partial work is never resumed.

`tripwire report RUN_ID` renders the sanitized JSON or Markdown audit record with contract hash, human decisions, thread/model IDs, observed actions, real checks, final diff scope, deviations, and remaining unknowns. `tripwire export` writes an explicit user-only copy. Terminal runs expire after seven days by default; `tripwire archive` pins one, `tripwire unarchive` restores normal retention, `tripwire purge-expired` removes expired database/artifact data, and `tripwire delete` explicitly removes a non-active run. Active execution and pending-worktree deletion are refused.

## Verified evidence and residual risks

On macOS/arm64 with `codex-cli 0.144.4`, the bounded live execution fixture completed with one contract-scoped file, `npm test` exit 0, no deviation, an unchanged source checkout, and a removed execution worktree. The full local check passes 23 unit, 71 integration, and 17 E2E tests, including App Server disconnect, comparator tool denial/schema failure and late-request isolation, selected-alternative contract binding, P0 allowlist rejection before worktree creation, snapshot drift, duplicate/reordered events, idempotent approval, controller restart, cleanup failure, retention/deletion, conditional Decision Inbox startup, recorded replay immutability, UI capability/origin controls, secret redaction, seven specification fixtures, and FR-001–018 / AC-001–019 traceability. CI runs the same gates on macOS.

Known residual risks are explicit:

- PromptTripwire is not a hardened boundary against a malicious repository or same-user local attacker.
- A local out-of-contract change may be detected only after it occurs inside a disposable worktree; the original checkout remains protected and the run is interrupted.
- A tracked secret inside an otherwise approved source path can still be read; secret pattern matching is a backstop, not proof.
- Required-check executable lookup is limited to the fixed macOS system/Homebrew `PATH` used by the P0 build.
- App Server/schema CLI surfaces remain labeled experimental even though runtime uses only the pinned normal schema.
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

## Status

Specification baseline: 2026-07-15. App Server hard gate, three-real-probe smoke, tool-free App Server Sol/Terra comparison, live compliant execution, full P0 traceability, macOS secret scan, seven specification fixtures, recorded replay, and the judge archive verification are covered by executable gates. No separate OpenAI API credential is required. The repository is currently private and has no project license; public + Apache-2.0 versus private + judge sharing is the remaining distribution decision. Video creation/upload and Devpost save/final submit remain intentionally outside this preparation work.
