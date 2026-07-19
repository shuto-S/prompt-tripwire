# PromptTripwire product specification

Status: P0 implementation baseline verified

Version: 0.1.9

Date: 2026-07-19

Owner: shuto-S

## 1. Product definition

PromptTripwire is a local-first preflight and execution gate for Codex. Before code is changed, it runs the same task through multiple independent, read-only Codex planning threads. GPT-5.6 converts the resulting structured plans into consensus, divergence, and unknowns. A deterministic policy engine then decides whether the task can proceed, needs human input, or must stop.

The output of review is an immutable, content-addressed execution contract bound to a repository snapshot. The approved Codex run is contained in an isolated worktree and observed for deviations from that contract.

The core promise is:

> Detect implementation-changing ambiguity before it becomes a diff, ask the smallest useful set of questions, and keep execution inside the approved boundary.

## 2. Problem

Coding agents often need to infer missing product and engineering decisions. A single plan does not reveal whether another equally plausible interpretation would:

- change persistent data or public APIs;
- expand the file or service scope;
- introduce a dependency;
- perform an external or irreversible action;
- change security, permission, or compatibility behavior;
- validate success in a materially different way.

Existing plan-review interfaces help a human annotate one plan. Approval and audit tools help govern actions during or after execution. PromptTripwire targets the earlier gap: it obtains multiple repository-grounded interpretations from Codex, shows only consequential disagreements, and carries the chosen interpretation forward as an enforceable contract.

## 3. Goals and non-goals

### 3.1 MVP goals

1. Reveal material differences between plausible Codex implementation plans before any target-repository write.
2. Reduce review load to decision cards backed by traceable evidence.
3. Require confirmation for deterministic high-impact categories even when every model agrees.
4. Bind human choices to an immutable repository snapshot and execution contract.
5. Contain and stop execution when the observed run leaves the approved boundary.
6. Produce a useful local audit record and a visually clear Build Week demo.

### 3.2 Non-goals

- Proving that a consensus plan is correct.
- Replacing code review, tests, static analysis, or security review.
- Making untrusted or malicious repositories safe to execute.
- Operating a hosted multi-tenant control plane.
- Supporting every coding agent in the MVP.
- Automatically choosing high-impact product decisions.
- Guaranteeing prevention of every local file write; the MVP combines sandboxing, approval interception, disposable worktrees, monitoring, and interruption.
- Managing commits, pushes, pull requests, deployments, releases, migrations, or production data without separate explicit authorization.

## 4. Users and primary jobs

### Primary user

An engineer already using Codex for non-trivial repository tasks who wants autonomy without silently delegating ambiguous product or safety decisions.

### Jobs to be done

- “Before Codex implements this issue, show me where another reasonable Codex run would do something materially different.”
- “Ask me only the questions that change scope, behavior, risk, or verification.”
- “After I decide, make sure the implementation run stays within that agreement.”
- “Give me a compact record of what was decided, why, and what Codex actually did.”

## 5. Core workflow

```mermaid
flowchart LR
    A["Task + repository"] --> B["Freeze repository snapshot"]
    B --> C1["Codex probe A\nread-only"]
    B --> C2["Codex probe B\nread-only"]
    B --> C3["Codex probe C\nread-only"]
    C1 --> D["GPT-5.6 structured comparison"]
    C2 --> D
    C3 --> D
    D --> E["Deterministic policy engine"]
    E -->|"No blocking decisions"| G["Execution contract"]
    E -->|"Decisions required"| F["Local Decision Inbox"]
    F --> G
    G --> H["Human approval"]
    H --> I["Isolated Codex execution"]
    I --> J{Observed deviation?}
    J -->|"No"| K["Result + audit report"]
    J -->|"Yes"| L["Interrupt and review"]
    L --> G
```

### 5.1 CLI entry points

The intended command surface is:

```text
tripwire inspect --task "..." [--repo PATH] [--terminal]
tripwire inspect --task-file issue.md [--repo PATH] [--terminal]
tripwire replay [--terminal]
tripwire review RUN_ID [--terminal]
tripwire review RUN_ID --decision DECISION_ID (--option OPTION_ID | --freeform TEXT | --defer)
tripwire review RUN_ID (--approve [--contract CONTRACT_ID] | --cancel)
tripwire approve RUN_ID [--contract CONTRACT_ID]
tripwire run --contract CONTRACT_ID [--terminal]
tripwire status RUN_ID
tripwire report RUN_ID [--format json|markdown]
tripwire cancel RUN_ID
tripwire export RUN_ID --output PATH
```

`inspect` never starts an implementation run. `run` requires an approved, current contract.

### 5.2 Hybrid interface

The CLI is the primary surface. A local web UI opens only when review is useful:

- one or more blocking decisions exist;
- the user explicitly requests review;
- an execution deviation pauses the run.

Headless and terminal-only environments use the same decision schema through a terminal renderer. The UI is not a permanent project-management dashboard.

### 5.3 Recorded judge replay

`tripwire replay` opens one bundled, sanitized Decision Inbox example for UI exploration when a live Codex account is unavailable or rate-limited. It is always labeled `recorded` and `read-only`, accepts no mutations, calls no model, executes no command, and touches no target repository. `--terminal` renders the same recorded decision without opening a listener.

Replay is supporting judge evidence only. It cannot satisfy or replace a live probe, comparison, execution, containment, or acceptance-criterion claim.

### 5.4 Explicit Codex Plugin adapter (P1)

PromptTripwire may be installed as a repo-scoped Codex Plugin named
`prompt-tripwire`. Version 1 exposes one bundled Skill, `preflight`, and no
automatic hook or MCP server. The Skill is opt-in only and delegates to the
existing `tripwire` CLI; it does not duplicate probes, policy, contract
validation, worktree containment, or report rendering.

The Skill passes the exact current task and repository snapshot to `tripwire
inspect` in terminal mode, reports the run summary, and stops while a human uses
the existing Decision Inbox. It must not choose a decision or invoke approval.
After a human-approved current contract exists, it may delegate `tripwire run`
and `tripwire report`. A deterministic `PROMPT_TRIPWIRE_PLUGIN_REENTRY` flag is
propagated in two stages and blocks recursive Plugin invocation: the thin
adapter sets the exact value `1` on the PromptTripwire process, the controller
retains only that non-secret sentinel in the otherwise minimal App Server
environment, and App Server receives the explicit
`shell_environment_policy.set={PROMPT_TRIPWIRE_PLUGIN_REENTRY="1"}` override for
every child command alongside the controller-owned isolated `ZDOTDIR`.
`shell_environment_policy.inherit=none` remains in force, and a normal
non-Plugin invocation receives `ZDOTDIR` but does not inject the sentinel. The adapter
requires the supported macOS arm64 runtime and the existing logged-in Codex
CLI; it introduces no API-key or hosted-backend path.

The exact task text, including the caller's explicit
`prompt-tripwire:preflight` request, remains snapshot-bound input and is never
stripped or rewritten before a child turn. Before any probe, comparison, or
execution thread starts, the shared App Server process disables the pinned
Codex `plugins` feature. This removes installed Plugin contributions, including
the PromptTripwire Skill, from the child model context while retaining the task
bytes as data. It is not represented as disabling standalone system, user, or
repository Skills; if one of those attempts an out-of-repository read, the
normal canonical containment boundary stops the probe. The re-entry sentinel
remains a second deterministic control. A custom `CODEX_HOME`, when present,
is forwarded only to the App Server process so it uses the same existing login;
it is not inherited by App Server child commands.

The thin adapter launches an authenticated nested `codex app-server`. If the
calling Codex shell sandbox prevents that child from reaching the model
service, the Skill may request the caller's normal command permission to run
only the adapter command outside that shell sandbox. This caller-tool
permission is not a PromptTripwire decision, contract approval, or task
implementation authorization. Denial stops preflight safely. When an inspect
attempt made under the caller sandbox ends with the sanitized
`INSUFFICIENT_VALID_PROBES: request failed` symptom, the Skill may retry at most
once through that normal permission path. It must not remove the deterministic
re-entry guard, introduce an API-key path, or relax the probe, comparator,
policy, contract, containment, or executor boundaries.

The macOS arm64 release archive co-distributes that thin adapter with the one
existing runtime. `install.sh --with-codex-plugin` installs the runtime in the
user-local prefix, registers the archive's stable local marketplace root, and
enables `prompt-tripwire@prompt-tripwire-local`. Plain `install.sh` remains
runtime-only. Installation never performs inspection, decision mutation,
approval, or execution.

## 6. Repository snapshot

Every run is bound to a `RepositorySnapshot` containing:

- canonical repository path;
- current commit SHA;
- active branch name, if any;
- submodule SHAs, if present;
- hash of the user-approved dirty patch, if dirty work is included;
- hashes of applicable `AGENTS.md` and PromptTripwire configuration;
- Codex model identifier and reasoning setting;
- normalized task text and task hash;
- creation timestamp and PromptTripwire version.

Default behavior for a dirty checkout is to stop and ask the user to choose one of:

1. inspect the committed snapshot only;
2. include the current dirty patch in the snapshot;
3. cancel.

PromptTripwire must never clean, reset, stash, or overwrite the user's checkout. Probe and execution worktrees are derived from the approved snapshot.

Any snapshot hash change invalidates prior analysis and approval. The user may rerun inspection; a stale contract cannot be forced through with a CLI flag in the MVP.

## 7. Independent Codex probes

### 7.1 Probe invariants

The default probe count is three. Each probe receives:

- the exact same repository snapshot;
- the exact same task text;
- the exact same system/developer instructions;
- the exact same Codex model and reasoning setting;
- the exact same structured plan schema;
- a separate fresh thread with no shared conversation history.

PromptTripwire must not use “security expert,” “minimalist,” or similar role prompts to manufacture disagreement. A later research mode may compare deliberately different perspectives, but its output must not be presented as naturally occurring ambiguity.

### 7.2 Probe containment

- CWD is a temporary worktree containing the approved tracked snapshot.
- Sandbox mode is read-only.
- Network access is disabled.
- Project scripts, interpreters, package managers, build tools, and test commands are denied during planning.
- Only bounded static inspection operations are allowed.
- Probe turns use normal-schema `approvalPolicy: "untrusted"`; PromptTripwire declines command, file-change, and permission requests outside the static-inspection policy.
- Probe execution never uses App Server `command/exec`, because standalone command execution bypasses turn-level approval handling and read-only sandboxing alone does not classify interpreter, build, test, or package-manager intent.
- Before any probe thread starts, PromptTripwire recursively audits the materialized worktree without following symlinked directories. Every symlink must resolve successfully to a canonical target inside that worktree; an external, broken, or otherwise unresolvable symlink fails the whole probe batch with `PROBE_CONTAINMENT_VIOLATION`, is not retried as an ordinary probe failure, and cannot degrade to two probes.
- Every static-read approval treats the App Server action as untrusted and independently validates both its structured type/path and actual command. CWD and action paths containing shell expansion or ambiguous syntax (`~`, variables, command substitution, globs, or brace expansion), explicit `..` segments, and absolute-path escape are rejected before canonical matching. The command must be one allowlisted static-read program with bounded flags and operands that semantically match the structured action. For the pinned App Server's lossy `search.path`, a basename is accepted only when it identifies exactly one explicit `rg` operand; every one of one or more operands is separately canonicalized and checked for repository containment and protected-content reachability. Arbitrary shell/interpreter wrappers, compound syntax, redirection, the `-` standard-input sentinel, symlink-following search flags (`rg -L`/`--follow`), `rg --pre`, `find -exec`/write predicates, and type/path mismatch are denied. On macOS, PromptTripwire points `ZDOTDIR` at a fresh empty mode-`0700` directory before child commands start. The exact Codex App Server 0.144.4 process envelopes `/bin/zsh -c <structured-command>` and `/bin/zsh -lc <structured-command>` are then unwrapped only when they contain exactly one inner command whose fail-closed tokens equal the structured action; the inner command receives every normal static-read, path, and protected-content check. Direct reads of default protected/secret-like paths are denied by both lexical and canonical target, and a content search is approved only when a filesystem walk proves it cannot reach a protected file under the command's hidden-file semantics. `rg --hidden` and any positive `--glob`/`-g` inclusion are conservatively treated as hidden-file reachability; a negative-only glob does not expand it. List-only actions may expose repository-relative names and metadata, but never protected file contents. App Server may report a root-contained absolute structured action path, which is allowed only when its canonical target remains inside the probe root. Missing resolution evidence or a canonical target outside the probe root is denied. Internal symlinks whose canonical target remains inside the worktree are allowed.
- Probe developer instructions require each allowlisted inspection program to be invoked by its exact bare name. Model-generated executable paths such as `/bin/ls`, relative executable paths, and explicit shell invocations are not normalized into an allowed action; when Codex App Server 0.144.4 classifies them as `unknown`, the probe remains fail-closed. The App Server's own exact supported zsh envelope is still independently unwrapped and validated as described above.
- `.git` and every descendant are protected probe content paths even when they do not match a secret filename pattern. A list-only action may enumerate their names, but a planning probe cannot read Git administrative contents or the disposable worktree's absolute gitdir pointer.
- Started, completed, and failed command/file items plus aggregate diffs are still inspected; only explicitly declined items are non-executed. If an unexpected local action was not presented for approval, it is treated as a deviation detected inside the disposable worktree, not described as prevented.
- Probe timeout defaults to five minutes and is configurable downward or upward.
- Probe concurrency defaults to three and is capped at three for the MVP.

### 7.3 Plan artifact schema

Each `PlanArtifact` must contain:

```text
summary
assumptions[]
intended_behavior[]
files_to_read[]
files_to_change[]
components[]
data_changes[]
public_api_changes[]
dependency_changes[]
commands[]
external_effects[]
permission_changes[]
compatibility_impacts[]
reversibility
verification_steps[]
unknowns[]
repository_evidence[]
```

`repository_evidence` entries reference paths and line spans or repository metadata. They do not contain hidden chain-of-thought. Unknown fields are rejected; missing required fields fail validation.

## 8. Comparison and decision extraction

### 8.1 GPT-5.6 responsibilities

GPT-5.6 receives the task plus validated plan artifacts in a fresh ephemeral Codex App Server thread rooted at an empty disposable directory, not unrestricted tool access. The thread is read-only, has network disabled, declines every tool or permission request, and uses a schema-constrained final response. Structured Outputs must return:

- normalized consensus items;
- materially different alternatives;
- unresolved unknowns;
- affected behaviors, files, data, APIs, commands, and external systems;
- evidence references back to source plan fields;
- a concise suggested question and recommendation, when justified.

The recommendation is advisory. The model cannot mark a deterministic policy trigger as safe or approve execution.

### 8.2 Material divergence

A difference is material if choosing one alternative over another can change at least one of:

- user-visible behavior or acceptance criteria;
- persistent data, migration, or deletion semantics;
- public API, compatibility, or authentication behavior;
- affected repository components or file scope;
- dependency or infrastructure footprint;
- permissions, secrets, or network access;
- external side effects;
- reversibility or rollback path;
- required verification.

Naming, prose ordering, and equivalent implementation details are suppressed unless the user asks to inspect them.

### 8.3 Deterministic policy triggers

`deterministic-v2` evaluates both the normalized original task and all validated
plan artifacts. The task is first-class policy evidence and a fail-closed
backstop when one or every plan omits a requested high-impact action. Task
evidence is identified as `task:normalized`; a blocker supported only by the
task has no probe-support attribution, while matching task and plan evidence is
merged without losing either source. Task text does not fabricate repository or
probe evidence.

Original-task matching is action-and-target oriented and supports bounded
English and Japanese equivalents for external mutations such as repository
archive/rename, issue transfer, object-store synchronization, and team
notification. Service names or artifact nouns alone are not mutations. In
particular, download/fetch/retrieve of a GitHub release artifact is network
evidence but not release/publish evidence, and local inspect/verify/test wording
is neither. A concrete release action remains blocking.

The same bounded task rules explicitly classify making a repository private or
internal, or transferring its ownership, as both `remote_write` and
`permission`; changing protection for the main or default branch has the same
two categories. Deleting an S3 object is classified as `destructive_data`,
`network`, and `remote_write`. These action-and-target forms are covered in
English and Japanese without treating a bare repository, branch, or S3 mention
as an operation.

The following always require explicit human confirmation, even under unanimous plans:

- data deletion, destructive transformation, or migration application;
- production or shared-environment changes;
- deploy, release, publish, commit, push, or pull-request creation;
- remote writes to GitHub or another service;
- authentication, authorization, identity, secret, or permission changes;
- billing, payments, quotas, or cost-bearing operations;
- network access or installation of a new dependency;
- public API or schema breaking changes;
- irreversible or materially difficult-to-reverse actions;
- expansion beyond the task's approved repository or writable roots.

Unknown classification is fail-closed and becomes a decision.

Dependency classification is action-oriented rather than mention-oriented.
Adding, installing, updating, upgrading, replacing, removing, or otherwise
changing a dependency is blocking. An entire structured `dependency_changes`
value that unambiguously declares no change is not a blocker, including
`dependency-free`, `no new dependencies`, `without adding dependencies`,
`dependencies unchanged/preserved`, `新しい依存関係は追加しない`,
`依存関係を変更しない`, and `依存関係の変更はない`. A no-change expression
combined with `but`, `except`, `while`, `ただし`,
or another contrasting clause is not exempt; the positive action is still
evaluated. Negated task language such as “do not deploy” does not authorize or
request that operation. An explicit coordinated prohibition such as
`Do not A, B, C, or D` keeps the negation over every comma-separated item. A
bare comma splice without that terminal coordinator remains fail-closed, and a
later positive clause introduced by `but`, `then`, a new subject/modal, or a
new sentence cannot be hidden by the earlier negation.

Each validated `commands` value is accepted for deterministic classification
only when it is a shell-free token sequence. PromptTripwire classifies that
sequence through the command policy and evaluates actual path/config/output
operands; ambiguous syntax is unknown, while absolute or parent-traversing
paths, write outputs, and protected read targets create the corresponding
scope, unknown, or secret evidence.

Planning probes must put only literal shell-free argv command strings in
`commands` (for example, `npm test`). Prose wrappers, backticks, ordering
phrases, and workflow directives such as the already-active PromptTripwire
preflight invocation belong outside `commands`; explanatory check prose belongs
in `verificationSteps`. Schema descriptions and probe developer instructions
state this rule, while malformed command values remain fail-closed as `unknown`.

For P0, confirming one of these effects can authorize only the local code changes that prepare it. It does not authorize PromptTripwire to perform a network, remote-write, deploy, release, migration-application, production-data, billing, credential, or permission-expansion operation. Those runtime effects remain denied and require a separate, explicitly authorized workflow outside the P0 executor.

### 8.4 Question budget

The Decision Inbox shows at most three unresolved decisions per review round. It must never hide additional blocking decisions:

- remaining count is displayed;
- execution remains disabled until all blocking decisions are resolved;
- closely coupled decisions may be grouped only when one answer necessarily determines all grouped outcomes;
- deterministic compatibility findings may use one all-or-none card only when every underlying effect and evidence reference remains visible and the allow option accepts the entire disclosed set;
- low-impact informational differences are available under “Evidence,” not promoted to blocking questions.

No aggregate numeric “risk score” is used in the MVP. Category, impact, reversibility, and evidence are more inspectable than an invented number.

## 9. Decision Inbox

Each decision card contains:

- one concrete question;
- why the decision is required;
- two or three mutually exclusive options, plus a free-form override;
- expected behavioral and technical impact per option;
- affected files, data, APIs, permissions, and external systems;
- which probes support each option;
- repository evidence links;
- deterministic policy triggers, if any;
- an optional recommendation with its rationale;
- “defer/cancel” when no safe decision can be made.

The terminal renderer includes the stable decision and option IDs plus complete `tripwire review` commands. A visible option must be actionable without querying the private database or opening the browser UI.

For a high-impact operational effect, the implementation-only option must state that the local code change may be prepared while the actual operation remains denied by the P0 runtime.

High-impact decisions have no preselected default. Keyboard operation, visible focus, semantic headings, labels, and screen-reader status updates are P0 requirements.

The browser UI provides Japanese and English presentation chrome. It selects
Japanese when the browser's preferred language is Japanese, otherwise English,
and exposes a visible `日本語 / English` switch whose choice is retained for the
current loopback origin. Switching language changes only display labels,
status announcements, and exact PromptTripwire-owned templates. Snapshot-bound
task text, model-authored decisions, repository evidence, contract content,
identifiers, and mutation payloads remain unchanged and are shown in their
source language when no exact product template exists.

The review sequence is:

1. Task and snapshot summary.
2. Up to three decision cards.
3. Consolidated contract preview.
4. Explicit approval, edit, or cancellation.

Full raw plan artifacts are available through an evidence drawer but are not the default presentation.

At most one live Decision Inbox capability exists per run, including when
multiple local processes use the same database, and only while the run is reviewable
(`needs_review`, `ready_for_approval`, or `paused`). Its loopback server closes
when the run leaves those states, when the run is archived, or after 30 minutes
with no authenticated request and no active authenticated SSE connection. A
valid API request refreshes the idle deadline and an active SSE connection
prevents idle expiry; unauthenticated traffic does neither. Closing the server
only revokes that capability and releases the listener. It never resolves a
decision, approves a contract, cancels a run, or otherwise infers human intent.
A later explicit review command creates a fresh capability when the run is
still reviewable. After binding and revalidating the lifecycle, live startup
atomically advances a non-secret generation lease in SQLite. The capability
token remains in memory and is never persisted. Advancing the generation does
not change run state, decisions, or approval; the prior listener rejects its
next authenticated request and closes after bounded lifecycle polling. Each
authenticated request revalidates the lifecycle and generation, and a mutation
revalidates again after its size-bounded body has been read within five seconds.
The corresponding persistence transaction also requires the run to remain
unarchived and the generation to remain current, so an archive, replacement, or
capability-close boundary cannot be crossed by an in-flight slow request. After
the last blocking answer, its human-decision record, resolved decision, draft
contract, and `ready_for_approval` transition commit in that same transaction;
a `_cancel` or `_rerun` answer instead commits the answer and `cancelled`
transition together. A stale generation rolls back the entire outcome, leaving
no stranded answer, contract, or state transition. Explicit contract approval
remains a separate human action. The controller-derived outcome is excluded
from the client request fingerprint so a v0.1.1 final-answer idempotency key
remains replayable after upgrade; changing the decision payload while reusing
that key remains a conflict. After
the bounded close grace, active connections are forcibly closed so a client that
never finishes a request cannot retain the revoked listener.

## 10. Execution contract

An `ExecutionContract` is immutable after approval. Editing creates a new version. It contains:

```text
contract_id
version
run_id
snapshot_hash
task_hash
approved_goal
approved_behaviors[]
approved_assumptions[]
allowed_components[]
allowed_paths[]
protected_paths[]
allowed_command_classes[]
denied_command_classes[]
network_policy
dependency_policy
data_policy
external_effect_policy
required_checks[]
stop_conditions[]
human_decisions[]
unresolved_non_blocking_unknowns[]
model_versions
created_at
approved_at
content_hash
```

New contract previews record the deterministic policy identity in
`model_versions` as `deterministic-v2`.

Approval records the timestamp and contract content hash. In the local single-user P0, the private database and OS account boundary identify the approving context; the account name is not copied into the contract or export. This is an audit record, not a cryptographic proof of legal identity.

Contracts and run artifacts are private local data by default. Export to the repository or another path requires an explicit command.

## 11. Execution and deviation handling

### 11.1 Start conditions

Execution can start only when:

- all blocking decisions are resolved;
- the contract is explicitly approved;
- snapshot and task hashes still match;
- Codex and policy versions are recorded;
- the isolated execution worktree was created successfully;
- requested permissions fit the contract.

### 11.2 Runtime boundary

- Execution occurs in a disposable Git worktree on a generated local branch.
- Workspace writes are confined to that worktree and configured writable roots.
- Network and remote tool surfaces remain disabled for all P0 execution turns. Contract policy fields are reserved for a future executor that can safely enforce a narrower capability.
- Command, file-change, permission, MCP/app, and diff events are observed through Codex App Server.
- Approval requests are accepted only when the event is permitted by the current contract.
- P0 never opts into `experimentalApi`, permission profiles, granular approvals, or dynamic tools. Permission expansion is deny-only; if the normal-schema permission request is emitted, the client grants no additional permission.
- The aggregated diff is checked after each completed change item and at turn completion.

The MVP must be explicit about a platform limitation: a permitted command may produce a local file change before the aggregate diff monitor reacts. This is contained in the disposable worktree with network disabled. On detection, PromptTripwire interrupts the turn, declines pending approvals, preserves evidence, and requires a new contract or cancellation. It must not claim the local write was prevented.

### 11.3 Deviations

A deviation includes:

- a changed or newly created path outside `allowed_paths`;
- modification of a `protected_path`;
- a command or permission outside the approved class;
- new network, dependency, data, or external-effect requirements;
- behavior that contradicts a human decision;
- an expected required check being removed or altered without approval;
- snapshot drift during the run.

The state transition is `running -> pausing -> paused`. The UI shows the requested action, contract clause, observed evidence, and choices:

1. reject and continue only if Codex can safely recover;
2. amend the contract and restart from a clean execution worktree;
3. cancel the run.

A contract amendment never resumes from an untrusted partial state in the MVP.

### 11.4 Completion

A run completes only after:

- the Codex turn completed successfully;
- no unresolved deviation remains;
- required checks were run and their actual results recorded;
- the final diff is inside contract scope;
- no commit, push, PR, deploy, release, or migration was performed unless separately and explicitly authorized.

Completion produces a Markdown and JSON report containing decisions, contract hash, model/thread identifiers, observed actions, diff summary, checks, deviations, and remaining unknowns.

## 12. State model

Valid run states are:

```text
created
snapshotting
probing
comparing
needs_review
ready_for_approval
approved
running
pausing
paused
completed
failed
cancelled
stale
```

State transitions are persisted atomically. Restarting the local controller must not turn a paused, failed, or stale run into an executable run.

## 13. Failure behavior

| Failure | Required behavior |
|---|---|
| One probe times out or fails | Retry once. If two valid probes remain, mark analysis degraded and require review. |
| Fewer than two valid probes | Fail closed; no contract can be approved. |
| GPT-5.6 refusal or invalid structured output | Retry once. Then show deterministic diff output and require manual review; no auto-approval. |
| App Server disconnects | Interrupt if possible, mark run failed, and preserve last events. |
| Caller shell sandbox blocks the Plugin's nested App Server request | Return a sanitized permission hint. Retry only the adapter command at most once through the caller's normal Codex command permission; denial or a second failure stops preflight without changing any PromptTripwire approval or runtime boundary. |
| Repository snapshot changes | Mark stale and require a new inspection. |
| Local UI closes, reaches a terminal/archive boundary, or idles for 30 minutes | Revoke the per-run capability and close the listener while keeping the persisted run state unchanged; never infer approval or a decision. |
| Approval response is lost | Remain unapproved; approvals are idempotent by decision ID. |
| Contract store write fails | Fail closed before execution. |
| Required check cannot run | Record the exact reason and finish as paused or failed, not completed. |
| Usage limit or API outage | Preserve resumable analysis state; never continue with missing evidence. |

## 14. Data retention and privacy

- Default storage uses the OS application-data directory, not the target repository.
- Run directories and files use user-only permissions where supported.
- Default retention is seven days after completion; active, paused, and explicitly pinned runs are retained.
- No telemetry or cloud synchronization is enabled in the MVP.
- The App Server uses the user's existing Codex CLI login. PromptTripwire neither requires a separate OpenAI API key nor reads, copies, or exports Codex credentials.
- Raw model reasoning, environment dumps, and full shell environments are not persisted.
- Export is explicit and warns if task text or evidence may be sensitive.

See `SECURITY.md` for the threat model and known limits.

## 15. Functional requirements

| ID | Priority | Requirement |
|---|---|---|
| FR-001 | P0 | Accept task text or a UTF-8 task file and validate a Git repository. |
| FR-002 | P0 | Create and hash an immutable repository snapshot without modifying the user's checkout. |
| FR-003 | P0 | Run three independent read-only Codex probes against identical inputs only after a fail-closed canonical symlink audit. |
| FR-004 | P0 | Validate each probe against the canonical plan schema. |
| FR-005 | P0 | Use GPT-5.6 Structured Outputs to extract consensus, divergence, and unknowns. |
| FR-006 | P0 | Apply `deterministic-v2` confirmation and denial rules to the original task and validated plans after model comparison, preserving evidence provenance and unambiguous dependency no-change semantics. |
| FR-007 | P0 | Render decisions in the local UI and terminal fallback; provide Japanese/English browser chrome without translating or mutating contract-bound source content. |
| FR-008 | P0 | Limit each review round to three cards without hiding remaining blockers. |
| FR-009 | P0 | Create immutable, versioned execution contracts with content hashes. |
| FR-010 | P0 | Reject stale contracts. |
| FR-011 | P0 | Start execution only in an isolated worktree and approved sandbox. |
| FR-012 | P0 | Observe App Server item, approval, diff, permission, and completion events. |
| FR-013 | P0 | Interrupt and pause on a contract deviation. |
| FR-014 | P0 | Require a clean restart after contract amendment. |
| FR-015 | P0 | Generate JSON and Markdown audit reports. |
| FR-016 | P0 | Support cancellation, timeout, crash-safe state, idempotent approval, and bounded Decision Inbox listener lifetime without state inference. |
| FR-017 | P0 | Redact secret-like values and never log credentials or raw reasoning. |
| FR-018 | P0 | Bind the local UI to loopback with a per-run capability token that expires on terminal/archive lifecycle boundaries or 30 minutes of authenticated inactivity. |
| FR-019 | P1 | Allow custom repository policy files. |
| FR-020 | P1 | Export a sanitized review artifact for PR or team discussion. |
| FR-021 | P2 | Add adapters for non-Codex coding agents. |
| FR-022 | P2 | Add historical team policies and shared approvals. |
| PLUG-FR-001 | P1 | Expose an explicit `prompt-tripwire` Plugin Skill that delegates to the existing CLI with the exact task and repository snapshot. |
| PLUG-FR-002 | P1 | Stop for human review and never select a decision or approve a contract automatically. |
| PLUG-FR-003 | P1 | Preserve the exact task while disabling Plugin contributions in every child App Server; fail closed for unsupported platform, missing runtime/login, dirty-choice ambiguity, deterministic re-entry propagated through both the App Server process and its explicit child shell environment, and denied caller command permission; retry a sandboxed nested-App-Server request failure at most once without relaxing inner boundaries. |
| PLUG-FR-004 | P1 | Validate Plugin metadata and Skill packaging with executable manifest, marketplace, smoke, and package-content checks. |
| PLUG-FR-005 | P1 | Co-distribute the thin Plugin adapter in the macOS arm64 archive and provide idempotent, user-local, one-command Plugin install and targeted uninstall without changing other marketplaces or Plugins. |

## 16. Non-functional requirements

- **Safety:** deny by default when classification, state, or snapshot is unknown.
- **Reliability:** persisted states and approvals must be recoverable after controller restart.
- **Latency:** probes run concurrently; the UI streams each phase instead of showing an indefinite spinner. No hard latency claim is made until measured on representative repositories.
- **Cost visibility:** show probe count, selected models, token usage when available, retry count, and a pre-run estimate if the provider exposes one.
- **Portability:** the Build Week MVP supports verified macOS builds with Git, Node.js, and an authenticated Codex CLI. No separate OpenAI API credential is required. Linux is the next target but is not advertised as supported until the same containment and end-to-end suite passes. Windows is out of MVP scope.
- **Distribution:** the macOS arm64 release is a compiled JavaScript/runtime archive with checksum, direct launcher, user-local runtime-only and runtime-plus-Plugin installer/uninstaller modes, the repo marketplace and Skill adapter, recorded read-only replay, and a dependency-free safe fixture. Judges do not rebuild the TypeScript source. A tagged artifact must come from a clean tree whose matching version tag resolves to the manifest's source commit, use that commit's timestamp, and satisfy the independently checked checksum and eight-MiB size ceiling.
- **Runtime:** Node.js 24.15+ LTS and Codex CLI 0.144.4 are the pinned implementation baseline. Node 24.15 is the minimum because the built-in SQLite module reached release-candidate status there. A different Codex version or canonical normal-schema hash fails before probing.
- **Accessibility:** complete decision review and approval with keyboard only; WCAG 2.2 AA contrast target.
- **Observability:** structured local events with stable IDs; no secret values or raw chain-of-thought.
- **Compatibility:** use only methods and fields present in the normal App Server schema over stdio. The schema generator and umbrella CLI command are labeled experimental, so exact CLI version and canonical schema drift checks are mandatory; runtime `experimentalApi` is not allowed for P0.

## 17. Acceptance criteria

| ID | Acceptance criterion |
|---|---|
| AC-001 | Given a clean fixture repository and task, `inspect` produces three schema-valid plan artifacts with distinct thread IDs and the same snapshot/task hashes. |
| AC-002 | Before any probe thread starts, an external, broken, or unresolvable worktree symlink fails the whole batch while an internal symlink remains usable; each static-read action also resolves CWD/path canonically. A bounded multi-target `rg` validates every explicit operand and the pinned basename-only metadata shape; attempted target writes, protected or outside targets, network access, interpreters, builds, tests, package-manager commands, and canonical path escapes are denied, and the original checkout remains byte-for-byte unchanged. |
| AC-003 | A fixture where plans differ on persistent deletion shows a decision card with alternatives, effects, probe support, and repository evidence. |
| AC-004 | A deploy, migration apply, secret/permission change, or remote write requested by the original task or present in unanimous plans still requires explicit confirmation under `deterministic-v2`; task-only evidence is labeled as task evidence and does not claim probe support. |
| AC-005 | Equivalent plans with no policy triggers produce a contract preview without a blocking decision; unambiguous dependency no-change expressions and negated operational instructions do not create false blockers, while a later positive contrast clause still does. |
| AC-006 | More than three blockers display three cards plus the remaining count; execution stays disabled until every blocker is resolved. |
| AC-007 | Approval creates an immutable contract whose hash changes when any decision or boundary changes. |
| AC-008 | Changing the commit, approved dirty patch, task, instructions, or configuration marks the contract stale and prevents `run`. |
| AC-009 | `run` creates a disposable worktree and never writes to the user's original checkout. |
| AC-010 | A file change outside approved paths causes interruption, a visible deviation, and no completed status. |
| AC-011 | An unapproved network, dependency, permission, or external action is declined and pauses the run. |
| AC-012 | Amending a contract discards the partial execution worktree and restarts from the approved snapshot. |
| AC-013 | A successful run reports real check commands and outcomes, final diff scope, thread/model IDs, decisions, and contract hash. |
| AC-014 | No API key, token, full environment, raw reasoning, or secret fixture value appears in UI output, logs, reports, or exported artifacts. |
| AC-015 | The Decision Inbox is operable by keyboard and announces probe, review, pause, and completion state changes to assistive technology. A Japanese browser locale selects Japanese chrome, the visible language switch updates the document language and every fixed control/state label, and neither language path preselects or records a decision. |
| AC-016 | Killing and restarting the controller preserves paused/unapproved state and cannot accidentally launch execution. |
| AC-017 | The local API listens only on loopback, rejects missing/invalid capability tokens and cross-origin mutations, loads no third-party runtime assets, and closes its capability on terminal/archive state or after 30 minutes with neither authenticated activity nor an active authenticated SSE connection without mutating or approving the run. |
| AC-018 | One failed probe produces degraded/manual review, fewer than two valid probes block approval, and an unrecoverable GPT-5.6 schema/refusal failure cannot auto-approve. |
| AC-019 | An incompatible Codex App Server version fails before probing with the detected and required versions; duplicate or reordered protocol events cannot duplicate approval or completion. |
| AC-PLUG-001 | The repo marketplace installs the `PromptTripwire` Plugin and exposes its `preflight` Skill to an explicit Codex task. |
| AC-PLUG-002 | Plugin inspect leaves the target checkout's `git status --short` unchanged and returns a compact run summary or Decision Inbox next step. |
| AC-PLUG-003 | No Skill or caller Codex path auto-approves a contract; approval remains an explicit human action. |
| AC-PLUG-004 | The exact Plugin invocation text reaches the snapshot unchanged; every child App Server disables Plugin contributions before thread creation, while the adapter also propagates the deterministic re-entry guard through the PromptTripwire child, the minimal App Server process environment, and `shell_environment_policy.set`. The PromptTripwire Skill is absent from the child Plugin context, a child process observes the guard, and recursive invocation is blocked without broad environment inheritance. |
| AC-PLUG-005 | API-key-free macOS arm64 runtime/login checks, unsupported-platform errors, manifest/marketplace/frontmatter validation, and package-content scans pass; a caller-sandbox request failure yields a sanitized permission hint, denial stops safely, and any permission-path retry is limited to one without removing the re-entry guard. |
| AC-PLUG-006 | The release installer installs and verifies the runtime plus enabled `prompt-tripwire@prompt-tripwire-local` Plugin idempotently; targeted uninstall removes only that Plugin, its owned marketplace registration, and its user-local files. |

## 18. Test strategy

### Unit

- schema validation and canonical hashing;
- plan normalization and equivalence rules;
- deterministic policy table;
- original-task backstop, provenance, dependency no-change, and contrast-clause rules for `deterministic-v2`;
- question grouping and pagination;
- contract matching for paths, commands, data, network, and external effects;
- secret redaction and export sanitization;
- state transition guards.

### Integration

- fake App Server JSON-RPC streams for approvals, file changes, command execution, interruption, disconnect, duplicate events, two-stage re-entry propagation, caller-sandbox request-failure guidance with a one-retry bound, and pre-thread/per-action symlink containment;
- fake App Server schema-constrained comparison fixtures, prohibited-tool requests, invalid schema/reference, retry, timeout, and token-usage notifications;
- Git repositories with clean, dirty, submodule, detached HEAD, renamed file, and snapshot drift cases;
- worktree creation, canonical symlink containment, clean restart, final diff verification, and Decision Inbox terminal/archive/idle closure without inferred approval.

### End-to-end

Use small local fixture repositories for:

1. ambiguous account deletion;
2. API compatibility choice;
3. dependency addition;
4. harmless internal refactor with consensus;
5. deliberate out-of-scope file change;
6. attempted network or deploy command;
7. controller crash during approval and execution.

No end-to-end test may use production credentials or a shared environment.

## 19. Requirement traceability

| Requirement | Primary acceptance evidence |
|---|---|
| FR-001 | AC-001 plus task-text/task-file CLI integration tests |
| FR-002 | AC-002, AC-008, AC-009 |
| FR-003 | AC-001, AC-002, AC-018 |
| FR-004 | AC-001, AC-018 |
| FR-005 | AC-003, AC-005, AC-018 |
| FR-006 | AC-004, AC-005, AC-011 |
| FR-007 | AC-003, AC-015 |
| FR-008 | AC-006 |
| FR-009 | AC-007 |
| FR-010 | AC-008 |
| FR-011 | AC-009 |
| FR-012 | AC-010, AC-011, AC-013, AC-019 |
| FR-013 | AC-010, AC-011 |
| FR-014 | AC-012 |
| FR-015 | AC-013 |
| FR-016 | AC-016, AC-017, AC-018, AC-019 and the failure-behavior table |
| FR-017 | AC-014 |
| FR-018 | AC-017 |
| PLUG-FR-001 | AC-PLUG-001, AC-PLUG-002 |
| PLUG-FR-002 | AC-PLUG-003 |
| PLUG-FR-003 | AC-PLUG-004, AC-PLUG-005 |
| PLUG-FR-004 | AC-PLUG-001, AC-PLUG-005 |
| PLUG-FR-005 | AC-PLUG-001, AC-PLUG-005, AC-PLUG-006 |

P1/P2 requirements do not gate the MVP and require acceptance criteria when promoted.

## 20. MVP completion definition

The MVP is complete only when all P0 requirements and AC-001 through AC-019 pass on macOS, the judge can install or run it without rebuilding from source, and a sub-three-minute demo can show:

1. three real Codex probes;
2. one material disagreement;
3. the focused local Decision Inbox;
4. contract approval;
5. an execution deviation being stopped or an approved run completing;
6. the final audit report.

Anything less is a prototype, not a completed PromptTripwire submission.
