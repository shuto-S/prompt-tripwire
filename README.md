# PromptTripwire

> See where Codex disagrees before it writes code.

PromptTripwire is a local-first preflight and execution gate for Codex. It runs the same engineering task through multiple independent, read-only Codex planning threads, turns material disagreements into a small number of human decisions, and binds the approved choices into an execution contract.

This repository is currently **specification-only**. No runnable implementation has been added yet.

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

`docs/SPECIFICATION.md` is the authoritative product scope. The other documents provide implementation detail and evidence.

## Build Week positioning

- **Track:** Developer Tools
- **Codex:** repository-grounded planning probes and approved execution
- **GPT-5.6:** schema-constrained comparison of plans into human-reviewable decisions
- **Differentiator:** detect ambiguity from actual Codex implementation divergence before code is written, then enforce the resulting contract

The project is being created during the OpenAI Build Week submission period. The initial commit is the baseline for all implementation work.

## Codex collaboration record

Codex was used to research the current OpenAI integration surfaces, challenge the UI-first concept, define the local-first product boundary, draft the requirements and threat model, and review the specification for contradictions. The human product decisions made at this stage are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

Before submission, this section must be expanded with:

- concrete examples of Codex suggestions that were accepted, changed, or rejected;
- the exact GPT-5.6 and Codex model versions used;
- the core Codex `/feedback` Session ID;
- links to implementation commits and dated evidence.

## Status

Specification baseline: 2026-07-14. Implementation, packaging, license selection, and judge-ready installation are pending.
