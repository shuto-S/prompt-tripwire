# Decision log

Date: 2026-07-14

This log separates confirmed product decisions from assumptions that still require implementation validation.

## Confirmed decisions

### D-001 — Build PromptTripwire, not ContextForge

**Decision:** The Build Week project will focus on implementation-changing ambiguity and execution boundaries around Codex. The earlier ContextForge direction was discarded.

**Reason:** The problem is easier to demonstrate, has a sharper Codex-specific interaction, and can be tested with concrete before-code decisions.

### D-002 — UI is conditional, not the product core

**Decision:** Use a CLI-first hybrid. Open a lightweight local Decision Inbox only for review or deviations, with a terminal fallback.

**Reason:** A visual decision card makes consequences understandable and improves the demo, but a permanent dashboard would add friction and place the product in a crowded monitoring category.

### D-003 — The differentiator is observed plan divergence

**Decision:** Run the same task through three independent Codex planning threads using identical inputs. Do not create role/persona prompts to force disagreement.

**Reason:** The evidence should represent instability in Codex's interpretation of the task, not differences PromptTripwire intentionally injected.

### D-004 — Do not show three full plans by default

**Decision:** Normalize plans into focused decision cards. Full plan artifacts remain available as evidence.

**Reason:** Human judgment is easier when the interface exposes the choice, effects, and provenance instead of requiring manual textual diffing.

### D-005 — No synthetic aggregate risk score

**Decision:** Use named categories, effects, reversibility, and evidence. Do not calculate a single risk number in the MVP.

**Reason:** A model-derived score would look precise without being reliably calibrated and would be difficult for engineers to audit.

### D-006 — GPT-5.6 proposes; deterministic policy gates

**Decision:** GPT-5.6 uses Structured Outputs to extract comparison candidates. Fixed policy rules add mandatory decisions and can deny actions regardless of model consensus.

**Reason:** Structured comparison benefits from a model, but irreversible, external, privileged, and production effects cannot depend on a probabilistic approval classification.

### D-007 — Contract enforcement is mandatory

**Decision:** The approved choices become a versioned execution contract. The subsequent Codex run is observed and paused on deviations.

**Reason:** Without enforcement, PromptTripwire would be a visually polished ambiguity report and overlap heavily with plan-review tools.

### D-008 — Use Codex App Server over stdio

**Decision:** Integrate with the stable App Server surface for threads, turns, events, approvals, diffs, and interruption. Do not use experimental WebSockets for the MVP.

**Reason:** PromptTripwire needs deep local event control. Stdio is documented and avoids exposing a network listener for Codex protocol traffic.

### D-009 — Local-first, single-user MVP

**Decision:** No hosted PromptTripwire backend, account system, team approvals, or cloud source storage. Local UI binds only to loopback.

**Reason:** This reduces security scope and setup time while matching the developer workflow and Build Week schedule.

### D-010 — Isolate execution from the user's checkout

**Decision:** Probes and execution use separate temporary worktrees. A contract amendment restarts from a clean worktree.

**Reason:** It protects user changes, makes rollback reliable, and honestly contains local writes that may be detected only after they occur.

### D-011 — Default private GitHub repository

**Decision:** Create the initial repository as private because the user did not specify visibility and the first commit is an incomplete specification baseline.

**Reason:** Visibility is reversible. Accidental publication is not. Final Build Week visibility and license remain separate decisions.

## Implementation assumptions to validate

### A-001 — App Server approval coverage

Verify which supported-platform file changes are presented for approval before application and which require reactive diff monitoring. User-facing wording must match observed behavior.

### A-002 — Minimal child environment

Verify how App Server propagates environment variables to command execution and how to prevent unrelated secrets from reaching repository processes.

### A-003 — Stable schema and minimum version

Pin the minimum Codex CLI version after protocol tests. Generate schemas from the pinned binary and fail clearly on incompatible versions.

### A-004 — Packaging

Choose between a published npm CLI, signed standalone macOS binary/app, or both after the vertical slice works. Judges must not need to build from source.

### A-005 — Exact model identifiers

Discover models at runtime and record exact identifiers. Do not assume documentation examples are the submission configuration.

## Deferred scope

- non-Codex agent adapters;
- IDE extensions;
- hosted teams and organization policy;
- historical analytics and learned policy;
- pull-request bots;
- automatic commits, pushes, deploys, releases, or migrations;
- Windows support;
- arbitrary untrusted-repository analysis;
- a public plugin marketplace distribution.

## Decision-change rule

Changing D-003, D-006, D-007, D-008, D-009, or D-010 materially changes the product or its safety model. Such a change requires an explicit decision-log entry and synchronized updates to the specification, architecture, security document, acceptance criteria, and demo plan.
