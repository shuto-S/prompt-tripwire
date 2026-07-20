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

**Status:** Historical v0.1.0-v0.1.10 decision; superseded by D-041 for v0.1.11 and later.

**Decision:** P0 uses `codex-cli 0.144.4` over stdio and only methods/fields in the schema generated without `--experimental`. It fails before probing on CLI or canonical schema drift and never enables runtime `experimentalApi`.

**Reason:** The live spike proved the required handshake, approvals, output schema, diff notifications, minimal child environment, and interruption. The umbrella command and generators are still labeled experimental, and granular approval requires the experimental capability despite appearing in the normal schema, so exact compatibility checks are required.

### D-013 — Use the Node 24/npm workspace foundation

**Decision:** Use Node.js 24 LTS, npm workspaces, TypeScript 6.0.3, built-in `node:test`, ESLint 10, and Prettier 3. Keep the foundation dependencies development-only and record their licenses.

**Reason:** Node 24 is the supported judge baseline and npm workspaces avoid another package manager. TypeScript 7.0.2 was evaluated but rejected because the current `typescript-eslint` peer range ends below 6.1; forcing an unsupported dependency tree would weaken reproducibility.

### D-014 — Keep filesystem resolution outside the pure policy matcher

**Decision:** The policy package receives a requested path plus trusted symlink-resolution and case-ambiguity facts from the caller. The probe coordinator must first audit every materialized symlink and block the entire batch before thread creation when a link is external, broken, or unresolvable. The App Server adapter must then canonicalize the root, command CWD, and each structured action path independently for every approval. Missing resolution evidence, shell-expanded or ambiguous structured path text, explicit parent traversal, absolute-path escape, case ambiguity, protected paths, raw shell commands, and unknown structured actions are denied. A structured absolute probe-action path is permitted only when its canonical target remains inside the probe root because App Server can report `${cwd}/README.md` rather than a relative path.

**Reason:** The deterministic policy layer must remain independent of filesystem and process access. Explicit evidence inputs preserve that boundary while preventing the matcher from treating an unresolved path or raw command prefix as safe. A startup walk catches an already-materialized escape before any model thread exists, while per-action canonicalization covers filesystem change and nonexistent-path suffixes after that audit.

### D-015 — Materialize snapshots with disposable Git worktrees

**Decision:** Snapshot preparation uses only read-only Git commands against the user's checkout. Probe worktrees are detached; execution worktrees use generated local branches. Hooks and global/system Git configuration are disabled, child environment inheritance is minimized, submodules are materialized with network transports disabled and no fetch, and the source checkout's content and Git state are fingerprinted before and after each worktree operation.

**Reason:** Git worktrees preserve exact tracked commits and binary patches while keeping all planned and partial execution changes outside the user's checkout. Explicit fingerprint and cleanup results make containment and cleanup failures observable instead of assuming isolation succeeded.

### D-016 — Use the Node 24 release-candidate SQLite module

**Decision:** Require Node.js 24.15 or newer and use the built-in `node:sqlite` `DatabaseSync` API with extension loading disabled, defensive mode enabled, WAL, foreign keys, and private filesystem permissions. Do not add a native SQLite package for the MVP.

**Reason:** [Node.js marked `node:sqlite` as Stability 1.2 (release candidate) in 24.15.0](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html). The synchronous API fits the single-user local controller, avoids native-addon installation risk, and is exercised on the pinned Node 24 CI baseline. Startup fails closed on an older runtime instead of silently selecting another storage implementation. This remains an explicit release-candidate dependency rather than being described as a fully stable Node API.

### D-017 — Bind plan identity in the adapter and trust only structured static-read actions

**Decision:** Codex produces the identity-free `PlanArtifactContent` schema. The App Server adapter binds the probe ID, fresh thread ID, snapshot hash, and task hash after validating the final agent message. Probe commands continue only when the App Server reports one `CommandAction` of `read`, `listFiles`, or `search`; its CWD and action path resolve canonically inside the disposable worktree; its actual command is a single allowlisted static-read program with bounded non-executing flags and operands that match the structured type/path; and no permission or network expansion is requested. Relative action paths resolve from the command CWD; root-contained absolute structured paths are accepted after canonical proof; and a nonexistent suffix derives canonical containment from its nearest existing ancestor. Shell expansion/ambiguity, explicit `..` segments, compound or redirected commands, shell/interpreter wrappers, the `-` standard-input sentinel, symlink-following searches, executable read hooks, unresolved paths, and `unknown` actions are denied. Direct reads also deny default protected paths by lexical and canonical name. Recursive content search walks its effective target first and fails closed when visible protected content, or hidden protected content enabled by `rg --hidden` or any positive inclusion glob, is reachable; a negative-only glob does not broaden hidden reachability. A `listFiles` action remains names-and-metadata-only and may enumerate protected names without content access. Raw command text can only narrow a structured action; it never establishes safety by itself. Before starting any probe thread, the coordinator also performs D-014's complete materialized-symlink audit; a containment failure is a batch blocker rather than a retryable probe failure.

**Reason:** Giving the model identity fields would let schema-valid output claim the wrong probe or snapshot. App Server action data is itself untrusted: checking only its type/path could label a dangerous underlying command as a read. Cross-validating an intentionally small command grammar preserves useful `cat`, bounded `head`/`tail`/`wc`/print-only `sed`, `rg`, `ls`, and non-executing `find` inspection while rejecting stdin-dependent reads and execution-capable flags such as `rg --pre` and `find -exec`. Applying the shared protected-path policy to content access prevents planning from becoming a secret-reading channel, while keeping list-only discovery usable for safe navigation. App Server 0.144.4 can still report apparently read-only command shapes as `unknown`; classifying those from raw text would contradict the fail-closed protocol boundary. Probe instructions therefore avoid command shapes that the pinned structured parser cannot identify. Completed command/file items and non-empty diffs remain independently monitored.

### D-018 — Bind comparison identity locally and keep model failure in manual review

**Status:** The identity binding and fail-closed fallback remain active. The direct Responses API transport was superseded by D-022 on 2026-07-15.

**Decision:** Use the official OpenAI JavaScript SDK `responses.parse` with a Zod-derived Structured Output schema, `store: false`, no tools, and only the normalized task plus validated plan artifacts. The adapter binds comparison, snapshot, task, and plan identities after semantic evidence/probe validation. Refusal, invalid schema/reference, secret-like output, and timeout retry once; a second failure creates a deterministic unknown candidate and cannot produce an auto-approved contract. `gpt-5.6-terra` with low reasoning is provisional until the bounded Sol/Terra Responses API evaluation is run.

**Reason:** Model-created identity and evidence references are untrusted. Persisting attempts and token usage supports auditability, while a deterministic manual-review fallback preserves useful plan/policy evidence without treating an unavailable comparator as consensus. The current runtime has no OpenAI API credential, so model quality/cost selection must remain explicitly unverified rather than inferred from Codex authentication or documentation alone.

### D-019 — Use an authenticated loopback React Decision Inbox

**Decision:** Build the browser review surface as bundled React/Vite assets served by a Node HTTP server bound to `127.0.0.1` on a random port. Scope a 256-bit capability to one run, bootstrap it through a URL fragment, remove the fragment immediately, and use authorization-header fetches for both aggregate state and SSE. Require exact Host, Origin, expected version, and idempotency on mutations. Keep the listener only while the run is reviewable; close and revoke the in-memory capability on terminal/non-reviewable state, archive, run loss, or 30 minutes without authenticated activity when no authenticated SSE stream remains active. Closure never mutates the run or infers approval. Editing an unapproved contract reopens all decisions and creates the next immutable contract version; the superseded contract remains stored but inactive.

**Reason:** An aggregate first read avoids a client waterfall and full raw plans, while native semantic controls preserve keyboard and assistive-technology behavior. Header-authenticated streaming keeps the capability out of query and Referer logs. Strict loopback/run scoping, same-origin checks, bounded capability lifetime, bundled assets, React text escaping, CSP, and frame denial reduce the local-web attack surface without adding a hosted backend or account system. Separating listener closure from persisted decision state avoids converting transport loss or inactivity into human intent.

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

**Decision:** Package compiled PromptTripwire JavaScript, bundled UI assets, minimal runtime dependencies, checksum, direct launcher, user-local installer/uninstaller, and a dependency-free Git fixture in a macOS arm64 tar archive. The launcher still requires Node 24.15+, Git, npm 11+, and an authenticated `codex-cli 0.144.4`; it does not run a source build. Add `tripwire replay` as a sanitized, disposable, read-only Decision Inbox example that calls no model or command, rejects all mutations, and is persistently labeled recorded. Record source commit, dirty state, source epoch, release tag, archive format, and the size ceiling in the archive manifest. A release-tag build must be clean, use the matching `v<version>` tag that resolves to the packaged commit, and use that commit's timestamp; archive verification independently compares those fields with the current source and enforces the checksum and eight-MiB ceiling.

**Reason:** Build Week judges need a reproducible way to run a developer tool without rebuilding it, while live Codex availability can still be affected by login or usage limits. A relocatable runtime archive is lower-risk than adding a native compiler/signing dependency during the event and preserves the version-pinned App Server boundary. A clearly non-live replay improves review reliability without falsely claiming the core integration works. Binding release provenance to a real tag and rechecking it prevents a same-version archive built from dirty or different source from being mistaken for the published artifact.

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

**Status:** Historical v0.1.4-v0.1.10 decision. D-041 supersedes only its
numeric Codex version requirement; the matching PromptTripwire runtime and
re-entry boundaries remain active.

**Decision:** The Plugin requires the existing macOS arm64 `tripwire` launcher.
The unified installer records that launcher in private installed metadata;
repo/Git installs resolve it from `PATH`, with `PROMPT_TRIPWIRE_BIN` as an
explicit local override. The adapter checks for the pinned runtime and
logged-in Codex CLI 0.144.4, propagates
`PROMPT_TRIPWIRE_PLUGIN_REENTRY=1` to child PromptTripwire processes, retains
only that non-secret sentinel in the minimal App Server process environment,
and conditionally injects it into App Server child commands through
`shell_environment_policy.set` while leaving
`shell_environment_policy.inherit=none` active. The adapter fails closed when
the guard is present, including inside the child Codex thread. Normal
non-Plugin calls inject no guard. V1 does not bundle a second compiled runtime,
publish npm packages, add credentials, or create a new GitHub Release.

**Reason:** The relocatable archive is already the supported packaging and
authentication surface. Bundling its generated tree into a Plugin would create
large duplicated artifacts and a second release path without improving the
Codex-user credential experience. Propagating the guard across both process
boundaries closes deterministic re-entry without broadening environment
inheritance or relying on prompt text.

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

### D-030 — Make the original task first-class deterministic evidence

**Decision:** Identify the hardened policy as `deterministic-v2`. Evaluate the
normalized original task alongside every validated plan so an omitted
high-impact request still creates a blocker. Preserve `task:normalized` as its
own evidence source, merge matching task and plan triggers, and leave probe
support empty when the task is the only source. Classify dependency intent by
positive add/install/update/upgrade/replace/remove/change actions. Suppress a
structured dependency field only when its whole value is an unambiguous
no-change declaration such as `dependency-free`, `no new dependencies`,
`without adding dependencies`, unchanged/preserved dependencies, or a supported
Japanese equivalent; contrast clauses are never suppressed wholesale.
Concrete external mutations are recognized by an action plus its target, with
bounded English and Japanese equivalents for repository administration, issue
transfer, object-store synchronization, and team notifications. A shared noun
does not inherit the most dangerous meaning by itself: downloading a GitHub
release artifact is network evidence, while inspecting or verifying a local
release artifact is not a release/publish request. Plan `commands` are parsed
only as shell-free token sequences and classified through the runtime command
classifier. Ambiguous syntax remains unknown; absolute or parent-traversing
path operands, protected read targets, and output paths become explicit
scope/secret/unknown evidence rather than being hidden inside command prose.
Repository private/internal visibility changes and ownership transfers map to
`remote_write` plus `permission`; changes to main/default branch protection map
to the same pair. S3 object deletion maps to `destructive_data`, `network`, and
`remote_write`. These bounded English and Japanese forms require both an action
and target.

**Reason:** A probabilistic plan can omit an operation that the user explicitly
requested, so plan-only policy evidence could remove a mandatory confirmation.
At the same time, treating every mention of dependencies as an intended change
creates false blockers and erodes trust. Separate task provenance preserves the
fail-closed backstop without inventing independent probe support, while narrow
whole-field no-change handling improves precision without letting a negated
clause hide a later positive action. Action-and-target matching also preserves
category accuracy: a read-only remote fetch cannot silently become publication,
and a concrete external mutation cannot disappear behind a harmless noun or a
nearby documentation/test context. Explicit repository administration,
branch-protection, and object-deletion mappings close high-impact omissions
without turning their service names into blanket blockers.

### D-031 — Bound Decision Inbox capability lifetime without inferring approval

**Decision:** A live Decision Inbox listener exists only while its run is in
`needs_review`, `ready_for_approval`, or `paused`. Close it on any other state,
archive, controller/run loss, or 30 minutes with no authenticated API activity
and no active authenticated SSE connection. Closing ends streams and revokes
the in-memory capability but performs no persisted decision, approval,
cancellation, or run transition. An explicit later review of a still-reviewable
run receives a new capability. At most one live capability may exist per run
across local processes: after bind and lifecycle revalidation, issuance
atomically advances a non-secret SQLite generation lease. The bearer token
remains in memory. Generation replacement changes no run, decision, contract,
or approval state; the older listener rejects its next authenticated request and
closes after bounded polling. Validate the boundary before and after bind,
before every API response, and again after reading a bounded mutation body.
UI-originated review mutations must also require an unarchived row and the
current generation inside the same immediate database transaction. The final
blocking answer, its idempotency/provenance records, next hash-validated draft
contract, and `ready_for_approval` transition must be one transaction. A
`_cancel` or `_rerun` answer and the `cancelled` transition must likewise be one
transaction without creating a contract. Failure of the generation, version, or
contract checks rolls back the complete outcome; approval remains a separate
human mutation. The controller-derived outcome is not part of the client
idempotency fingerprint, preserving replay compatibility with v0.1.1 final
answers while a genuinely different answer still conflicts. Resolve an SSE initial event before
sending stream headers. A mutation body must finish within five seconds; after
the response grace expires, force-close remaining connections so an incomplete
authenticated POST cannot hold the revoked listener open.

**Reason:** A detached Plugin or CLI process can otherwise leave a loopback
capability reachable after review is no longer active. Lifecycle and idle expiry
reduce that exposure, while keeping transport shutdown separate from human
intent preserves the existing fail-closed approval boundary. A byte limit alone
does not bound a client that stops sending before the declared body ends, so the
body deadline and forced transport closure are required for deterministic
lifecycle completion. A process-local token registry alone permits two CLI or
Plugin processes to leave two valid listeners for one run; a persisted
non-secret generation gives replacement and mutation a deterministic SQLite
ordering without storing the bearer or weakening approval semantics. Keeping the
final answer and its derived ready-or-cancel state in that same ordering prevents
a superseding process from stranding a committed answer between two transactions.

### D-032 — Separate caller command permission from PromptTripwire approval

**Decision:** The thin Plugin adapter may request the calling Codex task's
normal command permission to launch only the adapter outside a restrictive
caller shell sandbox so its nested, authenticated `codex app-server` can reach
the model service. This outer tool permission is not a Decision Inbox choice,
contract approval, or task implementation authorization. PromptTripwire keeps
the same minimal App Server environment, two-stage re-entry guard, probe and
comparator restrictions, deterministic policy, immutable contract gate,
worktree containment, and executor denials. If the caller denies permission,
preflight stops. After a sandboxed inspect returns the sanitized
`INSUFFICIENT_VALID_PROBES: request failed` symptom, the Skill may retry at most
once through the normal permission path and must not disable the guard, add an
API-key credential path, or repeatedly escalate.

**Reason:** A live Plugin invocation proved that the calling Codex
`workspace-write` shell sandbox can block the nested App Server request even
though the same adapter and existing CLI login work outside that outer
sandbox. Treating the normal tool-launch permission as human contract approval
would collapse two unrelated trust boundaries. A narrow, visible, one-retry
path preserves usability without weakening PromptTripwire's internal safety
model or introducing another credential route.

### D-033 — Normalize only the pinned App Server's exact macOS command envelopes

**Decision:** When Codex App Server 0.144.4 reports a planning command item as
`/bin/zsh -c <structured-command>` or `/bin/zsh -lc <structured-command>`, treat
only those exact three-token process envelopes as the pinned launcher shape. Before
starting App Server, create a fresh empty mode-`0700` directory inside its
disposable runtime root and pass it as the child `ZDOTDIR` through the existing
deny-by-default shell environment policy. Tokenize the single inner command
again and require its tokens to equal the structured
`CommandAction.command` before the existing command-class, flag, operand,
canonical-path, protected-content, and network checks run. Continue to deny
every other shell path, shell flag, extra argument, malformed inner command,
compound command, and structured/actual command mismatch.
An approval request with a missing or null actual command is denied. Started,
completed, and failed command/file items are validated; only an explicitly
declined item is treated as non-executed.

**Reason:** The release-candidate live Plugin check showed App Server wrapping a
safe structured `listFiles` action (`ls`) in both `/bin/zsh -c ls` and
`/bin/zsh -lc ls` forms. Comparing those outer argv directly to `ls` rejected
every planning probe even though the documented structured action and inner
command were safe. Pinned, exact envelope normalization restores the intended
action policy without trusting an arbitrary command string: both representations
must agree and the inner command receives the same fail-closed validation as a
direct command. Isolating `ZDOTDIR` prevents the accepted zsh process envelope
from loading user startup files outside that validated inner command.
Root-owned global zsh startup files remain part of the supported host trust
boundary.

### D-034 — Keep Git administrative metadata out of probe content reads

**Decision:** Treat `.git` and every descendant as a protected planning-probe
content path under both lexical and canonical checks. Continue to allow the
`listFiles` class to enumerate Git metadata names without reading their content.

**Reason:** A disposable worktree stores `.git` as a file containing an absolute
gitdir pointer, and a normal checkout can store remote configuration or helper
metadata below `.git`. Neither is necessary planning evidence, and exposing it
would weaken the existing protected-path boundary. Listing remains useful for
repository navigation and does not grant content access.

### D-035 — Preserve Plugin invocation text while isolating child App Server context

**Decision:** Keep the exact original task, including an explicit
`prompt-tripwire:preflight` invocation, in the snapshot and every planning
input. Start every shared child Codex App Server 0.144.4 process with its stable
`plugins` feature disabled before creating probe, comparison, or execution
threads. Continue the two-stage `PROMPT_TRIPWIRE_PLUGIN_REENTRY` guard as a
separate control. Do not claim that this disables standalone system, user, or
repository Skills; their out-of-repository actions remain subject to the normal
fail-closed containment boundary. Retain an explicitly set `CODEX_HOME` only in
the minimal App Server process environment so a custom logged-in Codex home is
used consistently, while `shell_environment_policy.inherit=none` keeps it out
of child commands.

For the pinned App Server's lossy search metadata, allow a basename-only
`search.path` only when it uniquely names one explicit `rg` operand. Accept one
or more explicit search paths only after canonical containment and
protected-content checks succeed independently for every operand; one unsafe
target rejects the full action.

**Reason:** A live v0.1.3 Plugin invocation kept the correct task bytes, but the
child App Server contributed the installed PromptTripwire Skill again and tried
to read it outside the disposable repository before the adapter re-entry guard
could run. Disabling Plugin contributions removes that pre-invocation discovery
without changing the task or duplicating Plugin logic. The same pinned canary
then exposed basename-only and multi-target structured search metadata for an
otherwise bounded repository read. Validating every command operand restores
that observed safe shape without trusting lossy metadata, weakening canonical
containment, or allowing protected content.

### D-036 — Localize display chrome without translating approval evidence

**Decision:** Provide Japanese and English Decision Inbox chrome in the bundled
React client. Select Japanese when the browser preference is Japanese, keep a
visible `日本語 / English` switch, update the document language, and retain only
the selected `ja`/`en` value in origin-scoped browser storage. Localize fixed UI
labels, state announcements, categories, triggers, and exact
PromptTripwire-owned decision templates at render time. Do not translate or
rewrite snapshot-bound task text, arbitrary model output, repository evidence,
contract content, identifiers, or mutation payloads.

**Reason:** Japanese Codex users should be able to complete the human review
flow without navigating English-only controls, while Build Week judges still
need the existing English presentation. Keeping localization in the display
adapter preserves immutable contract identity and avoids making translation a
new probabilistic input to approval. A two-value local preference adds no
credential path and cannot select, defer, approve, or cancel a run.

### D-037 — Keep explicit coordinated prohibition lists under one negation

**Decision:** When an English prohibition has the explicit shape
`Do not A, B, C, or D` or the equivalent terminal `and` form, keep the opening
negation over every bare comma-separated action in that coordinated list. Do
not extend this exemption to a comma splice without a terminal coordinator, or
past `but`, `then`, a new subject/modal, or a new sentence. Continue to classify
those independently positive operations with the existing fail-closed rules.

**Reason:** The real safe fixture said not to change package metadata, add
dependencies, access the network, commit, push, publish, deploy, or perform an
external action. Treating its middle list items as positive requests created
three false blockers and contradicted AC-005. Requiring a visible terminal
coordinator makes the no-change reading bounded, while the existing comma-splice
and contrast tests prevent a negated item from hiding a later requested action.

### D-038 — Constrain plan commands at generation without normalizing prose

**Decision:** Tell every planning probe, both in developer instructions and the
structured-output field description, that `commands` accepts only literal
shell-free argv strings such as `npm test`. The already-active
`prompt-tripwire:preflight` workflow directive and explanatory phrases belong
outside that field, with check prose in `verificationSteps`. Do not add a
post-hoc parser that extracts executable text from prose; malformed values stay
fail-closed as `unknown`.

**Reason:** A real v0.1.7 Plugin inspect produced correct plans but two probes
restated the preflight directive and wrapped `npm test` in sentences. The
deterministic command parser correctly blocked all four as unknown, creating
avoidable human decisions. Generation-time field guidance removes that UX
noise while preserving the runtime's strict parser and unknown-action boundary.

### D-039 — Require bare inspection program names without normalizing paths

**Decision:** Tell every planning probe to invoke each allowlisted static-read
program by its exact bare name, such as `ls` or `cat`. Explicitly prohibit
model-authored absolute or relative executable paths and explicit shells. Keep
the deterministic command policy unchanged: an App Server `unknown` action such
as `/bin/ls` remains a containment violation and is never converted into an
allowed `listFiles` action. Continue to unwrap only the pinned App Server's
independently validated exact zsh envelope.

**Reason:** A real v0.1.8 Plugin inspect twice failed closed because one of three
Codex 0.144.4 probes issued the otherwise read-only program as `/bin/ls`. The
App Server correctly classified that model-authored path as `unknown`, and
PromptTripwire correctly blocked the batch. Generation guidance removes the
avoidable notation while preserving the structured-action, canonical-path, and
raw-command cross-checks rather than weakening them.

### D-040 — Add source-bound Japanese reference translations without changing authority

**Decision:** Keep D-036's two-value locale preference and fixed chrome, then
add a separate Japanese reference-presentation stage after authoritative
comparison and deterministic decision normalization. Use a fresh ephemeral,
tool-free, read-only, network-denied App Server turn through the existing
logged-in Codex CLI to translate only the task and final decision questions,
reasons, option labels, descriptions, and effects. Treat every source string as
untrusted quoted data. Bind output to the exact decision and option IDs and
effect counts, sanitize it, persist it in a separate `review_presentations`
record, label it as a reference translation, and provide expandable access to
the unchanged authoritative source text. Exclude the presentation from policy,
decision IDs, human mutation fingerprints, contract content/identity, execution,
and reports. On any invalid, secret-like, timed-out, or unavailable result, show
an explicit source-text fallback without selecting or inferring a decision.

**Reason:** Japanese chrome alone left the task and the compatibility effects a
human actually had to judge in English. A separate, source-bound presentation
adapter makes those choices understandable without turning probabilistic
translation into approval evidence. Reusing the authenticated App Server adds
no API-key or hosted-service path; strict binding, source disclosure, and
identity tests preserve the existing human-approval and contract boundaries.

### D-041 — Measure Codex compatibility without version gates

**Decision:** Replace D-012's numeric Codex version and full-schema hash gate
with one version-independent, machine-readable compatibility profile shared by
the normal-schema verifier and runtime parser. Resolve one Codex executable,
record its realpath, digest, and reported version, generate its normal schema in
a private temporary directory with no cache fallback, validate every consumed
request/notification/response plus required field, type, nullability, and known
enum, then complete a private-temp, read-only, network-denied, tool-free bounded
canary through that same App Server process. Do not use runtime
`experimentalApi`. Allow additive optional fields, unused methods, and unknown
schema enum variants; if an unknown request or variant actually arrives, deny
and interrupt.

Bind the resulting profile version, normalized schema fingerprint, canary
fingerprint, executable identity, and compatibility fingerprint into the
repository snapshot so the contract hash includes them transitively. Repeat
the full measurement immediately before approval and run. Any failure or exact
attestation mismatch transactionally makes the run stale. Run must reuse the
verified App Server process and measure before creating its worktree. Plugin
and installers remain thin: they check command presence, version-output shape,
login, platform, and their matching PromptTripwire runtime, but no numeric
Codex version. Uninstall requires no Codex version and never guesses at global
configuration when the command is absent.

**Reason:** A version equality rule rejects compatible Codex updates while a
matching version cannot itself prove protocol or semantic behavior. Measuring
the exact executable and the small surface PromptTripwire consumes preserves
fail-closed behavior without per-version branches. The bounded canary provides
machine-observable semantic evidence, but cannot detect same-schema drift
outside its behavior; that remains an explicit residual risk rather than a
claim of universal compatibility. Historical 0.144.4 fixtures and evidence
remain unchanged as the original validated baseline.

## Validated implementation assumptions

### A-001 — App Server approval coverage

**Resolution:** Continue with constraints. Under `untrusted`, live command and file-change attempts produced approval requests that were declined before execution. Under `never`, a disposable-root write completed and three diff notifications followed, so post-write monitoring remains required. Stable permission expansion was not observed; P0 denies it and does not use experimental granular approval.

### A-002 — Minimal child environment

**Resolution:** Confirmed for 0.144.4. Start App Server with an explicit minimal process environment and `shell_environment_policy.inherit=none`. A synthetic App Server canary was absent from the child command. An explicitly set `CODEX_HOME` is retained only for App Server login/config lookup, not child commands. Every child receives the controller-owned isolated `ZDOTDIR`. For a Plugin-originated run only, retain the exact non-secret `PROMPT_TRIPWIRE_PLUGIN_REENTRY=1` sentinel in that process environment and inject the same value in the same `shell_environment_policy.set` map; do not widen general inheritance. Never persist a full environment dump.

### A-003 — Stable schema and minimum version

**Resolution:** Historical v0.1.0-v0.1.10 resolution, superseded by D-041. The 0.144.4 evidence remains immutable; active runtime compatibility is measured without a numeric version gate and runtime experimental capability remains prohibited.

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

Changing D-003, D-006, D-007, D-008, D-009, D-010, D-022, D-030, D-031, D-032, D-033, D-034, D-035, D-036, D-037, D-038, D-039, D-040, or D-041 materially changes the product or its safety model. Such a change requires an explicit decision-log entry and synchronized updates to the specification, architecture, security document, acceptance criteria, and demo plan.
