# Decision log

Date: 2026-07-15

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

**Status:** The identity binding and fail-closed fallback remain active. The direct Responses API transport was superseded by D-022 on 2026-07-15.

**Decision:** Use the official OpenAI JavaScript SDK `responses.parse` with a Zod-derived Structured Output schema, `store: false`, no tools, and only the normalized task plus validated plan artifacts. The adapter binds comparison, snapshot, task, and plan identities after semantic evidence/probe validation. Refusal, invalid schema/reference, secret-like output, and timeout retry once; a second failure creates a deterministic unknown candidate and cannot produce an auto-approved contract. `gpt-5.6-terra` with low reasoning is provisional until the bounded Sol/Terra Responses API evaluation is run.

**Reason:** Model-created identity and evidence references are untrusted. Persisting attempts and token usage supports auditability, while a deterministic manual-review fallback preserves useful plan/policy evidence without treating an unavailable comparator as consensus. The current runtime has no OpenAI API credential, so model quality/cost selection must remain explicitly unverified rather than inferred from Codex authentication or documentation alone.

### D-019 — Use an authenticated loopback React Decision Inbox

**Decision:** Build the browser review surface as bundled React/Vite assets served by a Node HTTP server bound to `127.0.0.1` on a random port. Scope a 256-bit capability to one run, bootstrap it through a URL fragment, remove the fragment immediately, and use authorization-header fetches for both aggregate state and SSE. Require exact Host, Origin, expected version, and idempotency on mutations. Editing an unapproved contract reopens all decisions and creates the next immutable contract version; the superseded contract remains stored but inactive.

**Reason:** An aggregate first read avoids a client waterfall and full raw plans, while native semantic controls preserve keyboard and assistive-technology behavior. Header-authenticated streaming keeps the capability out of query and Referer logs. Strict loopback/run scoping, same-origin checks, bundled assets, React text escaping, CSP, and frame denial reduce the local-web attack surface without adding a hosted backend or account system.

### D-020 — Correlate execution file approvals to validated items and run checks through sandboxed argv

**Decision:** Run approved implementation turns with `untrusted` approval and `workspaceWrite` containment in a fresh disposable worktree, with network and remote tool features disabled. Codex 0.144.4 file approval requests contain no target paths, so one is accepted only after a same-thread `item/started` file-change event with the same `itemId` disclosed paths that all match the contract; uncorrelated requests are declined. Completed items, aggregate diffs, and the final Git diff are checked again. Required check strings must parse to one shell-free argv vector, match an approved verification command class, and execute through sandboxed App Server `command/exec`. The check receives only a fixed macOS system/Homebrew executable `PATH`; no user environment values are inherited. Unknown commands, permission expansion, MCP/app requests, network context, and runtime policy amendments pause the run.

**Reason:** Guessing the scope of a pathless approval or treating raw shell prefixes as structured authority would violate fail-closed matching. Correlation to an already validated item preserves deterministic pre-approval without weakening fallback denial; repeated item/diff validation and disposable containment handle a changed or incomplete observation honestly. Sandboxed argv execution provides real check exit codes without granting a general shell or inheriting network authority.

### D-021 — Make retention deletion explicit, reference-safe, and non-active

**Decision:** Terminal runs receive a seven-day retention deadline, archive/unarchive maps to a pinned flag, and users can explicitly delete or purge expired runs. Idempotency rows carry the owning `run_id` and cascade with it. Run deletion also removes orphaned snapshots and private artifact files that have no remaining database reference. Deletion is refused for `running`/`pausing` runs and while any recorded worktree cleanup is pending. Secure SSD erasure is not claimed.

**Reason:** A retention timestamp without a purge path does not satisfy deletion semantics, and deleting only the main run row could leave sensitive result JSON or content-addressed files behind. Conversely, deleting active state or shared artifacts would damage recovery and audit integrity. Run ownership plus reference checks makes the privacy behavior executable and testable.

### D-022 — Reuse Codex App Server authentication for comparison

**Decision:** Replace the direct Responses API comparator transport with a fresh schema-constrained Codex App Server thread. Start App Server outside the target repository, give every comparison a separate empty `0700` temporary CWD, use `ephemeral: true`, read-only sandboxing, network disabled, `untrusted` approval, and no MCP/apps/subagents. Deny every tool or permission request and fail on every tool item or diff. Persist stable App Server thread/turn IDs and token-usage notifications with the comparison attempt. Use the authenticated Codex CLI session without requiring `OPENAI_API_KEY`, reading Codex auth files, or copying its tokens into another client.

**Reason:** PromptTripwire is a Codex-user tool, so a second credential path adds setup and secret-handling risk without product value. Codex App Server already supports authenticated model turns and JSON Schema output, while arbitrary direct API calls cannot safely reuse the CLI's ChatGPT session. An isolated tool-free thread preserves comparator boundaries and keeps one version-pinned protocol surface. The bounded 2026-07-15 App Server evaluation passed both fixtures on Sol and Terra; Terra used 48,910 total tokens versus Sol's 49,131, completed in 21,619 ms versus 29,657 ms, and did not add an unnecessary unknown on the divergence fixture.

### D-023 — Bind selected plan scope and keep high-impact operations deny-only in P0

**Decision:** A selected model-divergence option expands the execution contract only with paths, components, assumptions, and verification commands shared by the probes that support that option, in addition to the global intersection. Free-form answers do not expand those machine-enforced fields. Deterministic high-impact decisions offer an implementation-only choice: the contract may authorize local code changes that prepare a disclosed effect, while network, remote writes, deploy, release, migration application, production-data operations, billing, credentials, and permission expansion remain denied by the P0 executor. Before worktree creation, the runtime rejects reserved allowlist policies and high-impact allowed command classes. Comparison thread IDs keep their deny-all classification for the App Server client lifetime, and failed comparison attempts retain any observed thread, turn, and usage metadata.

**Reason:** Previously, human choices changed only descriptive contract text while path scope and required checks always came from unselected plan intersections or unions. That made a valid selected alternative either unenforceable or over-broad. The UI also said “Allow as stated” although the version-pinned runtime always disabled these operational capabilities. Binding scope to probe support makes the choice enforceable; labeling operational intent as implementation-only accurately preserves the fail-closed runtime boundary. Permanent comparison classification prevents delayed requests from falling through to the less restrictive probe policy, and failure metadata completes the audit trail promised by D-022.

### D-024 — Open review conditionally and use the OS account boundary as local approval context

**Decision:** `tripwire inspect` starts the loopback Decision Inbox and prints its one-time URL when the result needs review, and `tripwire run` does the same when a deviation pauses execution, unless `--terminal` was requested. A dirty checkout error names the two non-destructive rerun choices, and a Codex version mismatch reports the required and detected versions; other CLI failures remain generic to avoid leaking untrusted detail. Approval persists the timestamp and immutable contract hash but does not copy the local account name into the contract or export. The private single-user database under the OS account is the P0 approving context.

**Reason:** The documented hybrid workflow was not reached from `inspect`, forcing a second command even when review was immediately useful, while generic dirty/version errors did not tell the user how to recover. Conversely, persisting an OS username adds a personal identifier without strengthening the same-user threat boundary or providing a cryptographic identity proof. Conditional review startup, terminal fallback, and narrowly allowlisted error detail align the implementation with the local-first workflow and privacy model.

### D-025 — Ship a relocatable macOS arm64 archive with an unmistakable recorded fallback

**Decision:** Package compiled PromptTripwire JavaScript, bundled UI assets, minimal runtime dependencies, checksum, direct launcher, user-local installer/uninstaller, and a dependency-free Git fixture in a macOS arm64 tar archive. The launcher still requires Node 24.15+, Git, npm 11+, and an authenticated `codex-cli 0.144.4`; it does not run a source build. Add `tripwire replay` as a sanitized, disposable, read-only Decision Inbox example that calls no model or command, rejects all mutations, and is persistently labeled recorded.

**Reason:** Build Week judges need a reproducible way to run a developer tool without rebuilding it, while live Codex availability can still be affected by login or usage limits. A relocatable runtime archive is lower-risk than adding a native compiler/signing dependency during the event and preserves the version-pinned App Server boundary. A clearly non-live replay improves review reliability without falsely claiming the core integration works.

### D-026 — Keep deterministic compatibility evidence complete but actionable

**Decision:** Treat explicit “compatibility preserved/no impact” plan values as non-findings. Group all remaining compatibility findings into one deterministic all-or-none decision while retaining every underlying description, probe, component, and evidence reference. The allow option authorizes the disclosed local implementation and leaves all other P0 runtime boundaries unchanged; it does not falsely describe compatibility behavior itself as a denied runtime operation. Terminal review prints stable decision/option IDs and complete mutation commands. Probe instructions record only material unresolved implementation questions, not a tool limitation after equivalent static evidence was obtained. Comparator prompts enumerate the exact allowed probe and repository-evidence IDs, while adapter-side validation remains authoritative.

**Reason:** The first live judge-artifact run on 2026-07-15 completed real probes and comparison without API-key environment variables, but seven paraphrased compatibility statements, one no-impact statement, and resolved inspection/tool notes expanded into eleven decisions. The terminal renderer then displayed labels without the identifiers required by its own CLI syntax. An all-or-none compatibility choice preserves every deterministic finding and is safer than heuristic semantic suppression, while actionable commands make the terminal fallback genuinely complete.

### D-027 — Ship a Skill-only, explicit Codex Plugin adapter

**Decision:** Add a repo-scoped `prompt-tripwire` Plugin with the `preflight`
Skill only. The Skill delegates to the existing CLI and is invoked only when a
Codex user explicitly requests it. It does not duplicate policy, probes,
contracts, worktree containment, report handling, or approval mutations. No
automatic hook or MCP server is included in v1.

**Reason:** Codex users need a discoverable entry point without creating a
second safety implementation or silently forcing every task through a blocking
preflight. Keeping the adapter thin preserves the existing tested source of
truth and makes the human approval boundary visible.

### D-028 — Reuse the existing release runtime instead of bundling or publishing

**Decision:** The Plugin requires the existing macOS arm64 `tripwire` launcher.
The unified installer records that launcher in private installed metadata;
repo/Git installs resolve it from `PATH`, with `PROMPT_TRIPWIRE_BIN` as an
explicit local override. The adapter checks for the pinned runtime and
logged-in Codex CLI 0.144.4, propagates
`PROMPT_TRIPWIRE_PLUGIN_REENTRY=1` to child PromptTripwire processes, and fails
closed when the guard is present. V1 does not bundle a second compiled runtime,
publish npm packages, add credentials, or create a new GitHub Release.

**Reason:** The relocatable archive is already the supported packaging and
authentication surface. Bundling its generated tree into a Plugin would create
large duplicated artifacts and a second release path without improving the
Codex-user credential experience.

### D-029 — Co-install the thin Plugin from the existing release archive

**Decision:** Include the repo marketplace, manifest, Skill, and adapter script
in the macOS arm64 runtime archive. Preserve plain `install.sh` as runtime-only
and add `install.sh --with-codex-plugin` for one-command, user-local runtime plus
Plugin installation. The versioned runtime root is also the stable local
marketplace root, so its existing relative `./plugins/prompt-tripwire` source
remains valid. The installer uses only Codex marketplace/plugin lifecycle
commands and records a private pointer to the one installed runtime; it never
runs inspect, decisions, approval, or execution. Targeted uninstall removes the
PromptTripwire selector and removes the marketplace only while it still points
to the owned install root.

**Reason:** Requiring users to install the runtime and then repeat marketplace
and Plugin commands is unnecessary friction for the primary Codex-user flow.
Co-distribution does not create a second runtime or safety implementation, and
the stable relative marketplace layout remains compatible with direct Git
installation for development and fallback use.

## Validated implementation assumptions

### A-001 — App Server approval coverage

**Resolution:** Continue with constraints. Under `untrusted`, live command and file-change attempts produced approval requests that were declined before execution. Under `never`, a disposable-root write completed and three diff notifications followed, so post-write monitoring remains required. Stable permission expansion was not observed; P0 denies it and does not use experimental granular approval.

### A-002 — Minimal child environment

**Resolution:** Confirmed for 0.144.4. Start App Server with an explicit minimal process environment and `shell_environment_policy.inherit=none`. A synthetic App Server canary was absent from the child command. Never persist a full environment dump.

### A-003 — Stable schema and minimum version

**Resolution:** Pin exactly 0.144.4 for the Build Week MVP. Generate the normal schema at build/test time, canonicalize it, and compare its directory hash. Schema generation can remain a build-time experimental tool; runtime experimental capability is prohibited.

### A-004 — Packaging

**Resolution:** Ship the compiled/runtime macOS arm64 archive defined by D-025. Do not publish an npm package or claim a signed/notarized native app for v0.1.0. A GitHub Release remains the preferred delivery surface after repository visibility/license confirmation.

### A-005 — Exact model identifiers

**Resolution:** Real planning probes currently use the discovered `gpt-5.6-sol` identifier with low reasoning. Comparison attempts record the exact model and App Server thread/turn IDs. On 2026-07-15, `npm run eval:comparator` used the existing Codex CLI login and ran two fixtures once on each model at low reasoning. Both models passed 2/2. Terra used 48,910 total tokens versus Sol's 49,131, completed in 21,619 ms versus 29,657 ms, and returned no unnecessary unknown on the divergence fixture; `gpt-5.6-terra`/low is therefore the empirical P0 default for this bounded suite. Re-evaluate if fixtures, models, or App Server behavior change.

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

Changing D-003, D-006, D-007, D-008, D-009, D-010, or D-022 materially changes the product or its safety model. Such a change requires an explicit decision-log entry and synchronized updates to the specification, architecture, security document, acceptance criteria, and demo plan.
