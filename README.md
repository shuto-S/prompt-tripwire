# PromptTripwire

> See where Codex disagrees before it writes code.

PromptTripwire is a local-first preflight and execution gate for Codex. It runs the same engineering task through multiple independent, read-only Codex planning threads, turns material disagreements into a small number of human decisions, and binds the approved choices into an execution contract.

Implementation is in progress. The Codex App Server 0.144.4 adapter, three independent real planning probes, GPT-5.6 Structured Outputs comparator, deterministic policy normalization, terminal and browser review/approval flows, immutable contracts, Git snapshot/worktree containment, contract-bound execution/deviation handling, and crash-safe local persistence are executable and tested.

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

After review, PromptTripwire creates a versioned execution contract. Codex runs in an isolated worktree with network access disabled by default. Contract deviations pause the run and require an explicit update or rejection.

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
- [Decision log and open questions](docs/DECISIONS.md)
- [Codex App Server 0.144.4 feasibility spike](docs/CODEX_APP_SERVER_SPIKE.md)

`docs/SPECIFICATION.md` is the authoritative product scope. The other documents provide implementation detail and evidence.

## Development baseline

Supported Build Week development baseline:

- macOS on arm64;
- Node.js 24.15 or newer in the Node 24 LTS line (`.nvmrc` and `.node-version`);
- npm 11 or newer, with npm 11.17.0 recorded in `packageManager`;
- `codex-cli 0.144.4` with the pinned normal-schema hash.

Install a clean checkout with one command:

```sh
npm ci
```

Run the complete local foundation verification:

```sh
npm run check
```

Individual entry points are available for `typecheck`, `lint`, `build`, `test:unit`, `test:integration`, `test:e2e`, `check:boundaries`, `check:versions`, `check:schema`, and `check:licenses`. CI runs the same checks on `macos-latest` and verifies that build/test steps leave no tracked or unignored artifacts.

Run the bounded real-probe smoke test with an authenticated Codex CLI:

```sh
npm run smoke:real-probes
```

The 2026-07-14 fixture run used `codex-cli 0.144.4`, `gpt-5.6-sol`, and low reasoning. It produced three schema-valid plans on distinct fresh thread IDs with the same snapshot/task hashes, cleaned all disposable worktrees, and left the source checkout unchanged. The sanitized metadata evidence is in [`fixtures/app-server/real-probes-2026-07-14.json`](fixtures/app-server/real-probes-2026-07-14.json); plan text, raw reasoning, command output, and process environments are intentionally not retained.

Run the bounded comparator model evaluation (two fixtures × two models, one attempt each) only with an existing OpenAI API credential:

```sh
npm run eval:comparator
```

The evaluator records only pass/fail, candidate counts, timing, and token usage. It never prints prompts, plans, model output, or credentials. `gpt-5.6-terra` with low reasoning is the provisional comparator default because the current official model guidance positions Terra as the cost/intelligence balance; the Sol/Terra Responses API evaluation has not been run in this checkout because no API credential was available, so this is not an empirical model-selection claim.

`tripwire review RUN_ID` starts a random-port loopback Decision Inbox and keeps it available until Ctrl-C. The capability token appears only in the one-time URL fragment, is removed from the address bar after bootstrap, and is required as an authorization header for the aggregate review API and authenticated fetch-based SSE stream. The UI shows at most three decision cards plus the remaining count, never preselects a high-impact option, supports selection, free-form resolution, defer, pre-approval edit, explicit approval, cancellation, deviation display, keyboard operation, visible focus, and assistive-technology state announcements. It loads only its bundled React/Vite assets and renders model content as escaped text.

Use `tripwire review RUN_ID --terminal` for the terminal fallback. Both interfaces require expected run versions and idempotency keys for mutations, and execution remains disabled until every blocker is resolved and the content-addressed contract is explicitly approved.

`tripwire run --contract CONTRACT_ID` creates a fresh disposable execution worktree and Codex thread from the approved snapshot. The runtime disables network and remote tool surfaces, accepts a pathless file approval only after correlating it to a same-ID file item whose disclosed paths match the contract, declines permission or unknown-action requests, interrupts out-of-scope file changes, runs only the exact contract checks through sandboxed `command/exec`, persists the real exit codes and final path scope, and removes the worktree at the terminal state. A paused run can only continue through a new contract version and a clean execution worktree; partial work is never resumed.

## Build Week positioning

- **Track:** Developer Tools
- **Codex:** repository-grounded planning probes and approved execution
- **GPT-5.6:** schema-constrained comparison of plans into human-reviewable decisions
- **Differentiator:** detect ambiguity from actual Codex implementation divergence before code is written, then enforce the resulting contract

The project is being created during the OpenAI Build Week submission period. The initial commit is the baseline for all implementation work.

## Codex collaboration record

Codex was used to research the current OpenAI integration surfaces, challenge the UI-first concept, define the local-first product boundary, draft the requirements and threat model, verify the App Server boundary, establish the TypeScript/npm test foundation, implement and test the domain/policy/snapshot layers, build the SQLite-backed controller and CLI foundation, implement the version-pinned App Server adapter with three real independent probes, complete the Responses API comparator and terminal decision/contract flow, implement the loopback-only browser Decision Inbox with keyboard and security E2E coverage, and implement the contract-bound execution gate with approval matching, diff monitoring, interruption, clean amendment restart, sandboxed required checks, and audit reporting. During live verification, Codex identified that App Server 0.144.4 reports `pwd` and `sed` as unknown command actions; the implementation kept unknown actions denied and tightened probe instructions instead of inferring safety from raw shell text. It also confirmed that normal-schema file approval requests omit target paths but follow a same-ID file item carrying the paths; the implementation accepts only that correlated, contract-valid case and keeps uncorrelated requests deny-only, with repeated item/final-diff validation and disposable containment. Codex found no OpenAI API credential in the runtime environment, so it added a bounded secret-safe Sol/Terra evaluator and explicitly left the live comparison unclaimed. The human set Codex CLI 0.144.4 as the compatibility baseline and authorized autonomous implementation through the pre-submission milestone; implementation choices are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

Before submission, this section must be expanded with:

- concrete examples of Codex suggestions that were accepted, changed, or rejected;
- the exact GPT-5.6 and Codex model versions used;
- the core Codex `/feedback` Session ID;
- links to implementation commits and dated evidence.

## Status

Specification baseline: 2026-07-14. App Server hard gate and three-real-probe milestone passed with documented constraints on 2026-07-14. Domain, deterministic policy, Git isolation, App Server planning/execution adapters, Responses comparator, terminal/browser review and approval, contract enforcement, deviation interruption, sandboxed checks, audit reporting, and local persistence are implemented; the live Sol/Terra API evaluation, packaging, license selection, and judge-ready installation are pending.
