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

### D-012 — Pin Codex 0.144.4 and the normal schema

**Decision:** P0 uses `codex-cli 0.144.4` over stdio and only methods/fields in the schema generated without `--experimental`. It fails before probing on CLI or canonical schema drift and never enables runtime `experimentalApi`.

**Reason:** The live spike proved the required handshake, approvals, output schema, diff notifications, minimal child environment, and interruption. The umbrella command and generators are still labeled experimental, and granular approval requires the experimental capability despite appearing in the normal schema, so exact compatibility checks are required.

### D-013 — Use the Node 24/npm workspace foundation

**Decision:** Use Node.js 24 LTS, npm workspaces, TypeScript 6.0.3, built-in `node:test`, ESLint 10, and Prettier 3. Keep the foundation dependencies development-only and record their licenses.

**Reason:** Node 24 is the supported judge baseline and npm workspaces avoid another package manager. TypeScript 7.0.2 was evaluated but rejected because the current `typescript-eslint` peer range ends below 6.1; forcing an unsupported dependency tree would weaken reproducibility.

### D-014 — Keep filesystem resolution outside the pure policy matcher

**Decision:** The policy package receives a requested path plus trusted symlink-resolution and case-ambiguity facts from the caller. Missing resolution evidence, absolute paths, parent traversal, case ambiguity, protected paths, raw shell commands, and unknown structured actions are denied.

**Reason:** The deterministic policy layer must remain independent of filesystem and process access. Explicit evidence inputs preserve that boundary while preventing the matcher from treating an unresolved path or raw command prefix as safe.

### D-015 — Materialize snapshots with disposable Git worktrees

**Decision:** Snapshot preparation uses only read-only Git commands against the user's checkout. Probe worktrees are detached; execution worktrees use generated local branches. Hooks and global/system Git configuration are disabled, child environment inheritance is minimized, submodules are materialized with network transports disabled and no fetch, and the source checkout's content and Git state are fingerprinted before and after each worktree operation.

**Reason:** Git worktrees preserve exact tracked commits and binary patches while keeping all planned and partial execution changes outside the user's checkout. Explicit fingerprint and cleanup results make containment and cleanup failures observable instead of assuming isolation succeeded.

### D-016 — Use the Node 24 release-candidate SQLite module

**Decision:** Require Node.js 24.15 or newer and use the built-in `node:sqlite` `DatabaseSync` API with extension loading disabled, defensive mode enabled, WAL, foreign keys, and private filesystem permissions. Do not add a native SQLite package for the MVP.

**Reason:** [Node.js marked `node:sqlite` as Stability 1.2 (release candidate) in 24.15.0](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html). The synchronous API fits the single-user local controller, avoids native-addon installation risk, and is exercised on the pinned Node 24 CI baseline. Startup fails closed on an older runtime instead of silently selecting another storage implementation. This remains an explicit release-candidate dependency rather than being described as a fully stable Node API.

### D-017 — Bind plan identity in the adapter and trust only structured static-read actions

**Decision:** Codex produces the identity-free `PlanArtifactContent` schema. The App Server adapter binds the probe ID, fresh thread ID, snapshot hash, and task hash after validating the final agent message. Probe commands continue only when every App Server `CommandAction` is `read`, `listFiles`, or `search`, its cwd and resolved path remain inside the disposable worktree, and no permission or network expansion is requested. Relative action paths resolve from the command cwd. Raw command text and `unknown` actions never establish safety.

**Reason:** Giving the model identity fields would let schema-valid output claim the wrong probe or snapshot. App Server 0.144.4 also reports some apparently read-only shell commands, including `pwd` and `sed`, as `unknown`; classifying those from raw text would contradict the fail-closed protocol boundary. Probe instructions therefore avoid command shapes that the pinned structured parser cannot identify. Completed command/file items and non-empty diffs remain independently monitored.

### D-018 — Bind comparison identity locally and keep model failure in manual review

**Decision:** Use the official OpenAI JavaScript SDK `responses.parse` with a Zod-derived Structured Output schema, `store: false`, no tools, and only the normalized task plus validated plan artifacts. The adapter binds comparison, snapshot, task, and plan identities after semantic evidence/probe validation. Refusal, invalid schema/reference, secret-like output, and timeout retry once; a second failure creates a deterministic unknown candidate and cannot produce an auto-approved contract. `gpt-5.6-terra` with low reasoning is provisional until the bounded Sol/Terra Responses API evaluation is run.

**Reason:** Model-created identity and evidence references are untrusted. Persisting attempts and token usage supports auditability, while a deterministic manual-review fallback preserves useful plan/policy evidence without treating an unavailable comparator as consensus. The current runtime has no OpenAI API credential, so model quality/cost selection must remain explicitly unverified rather than inferred from Codex authentication or documentation alone.

## Validated implementation assumptions

### A-001 — App Server approval coverage

**Resolution:** Continue with constraints. Under `untrusted`, live command and file-change attempts produced approval requests that were declined before execution. Under `never`, a disposable-root write completed and three diff notifications followed, so post-write monitoring remains required. Stable permission expansion was not observed; P0 denies it and does not use experimental granular approval.

### A-002 — Minimal child environment

**Resolution:** Confirmed for 0.144.4. Start App Server with an explicit minimal process environment and `shell_environment_policy.inherit=none`. A synthetic App Server canary was absent from the child command. Never persist a full environment dump.

### A-003 — Stable schema and minimum version

**Resolution:** Pin exactly 0.144.4 for the Build Week MVP. Generate the normal schema at build/test time, canonicalize it, and compare its directory hash. Schema generation can remain a build-time experimental tool; runtime experimental capability is prohibited.

### A-004 — Packaging

Choose between a published npm CLI, signed standalone macOS binary/app, or both after the vertical slice works. Judges must not need to build from source.

### A-005 — Exact model identifiers

**Resolution:** Real planning probes currently use the discovered `gpt-5.6-sol` identifier with low reasoning. The comparator records the exact Responses API model returned by the SDK. `gpt-5.6-terra`/low is a provisional default based on current official positioning; `npm run eval:comparator` performs a bounded Sol/Terra fixture comparison, but it was not run on 2026-07-14 because no OpenAI API credential was available. Do not present the provisional default as an empirical winner.

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
