# Security and privacy specification

Status: Required MVP controls; implementation unverified

Date: 2026-07-14

## 1. Security objective

PromptTripwire reduces accidental scope and side effects from an authorized Codex task. It is not a secure malware-analysis sandbox and must not be presented as one.

The MVP supports repositories the user already trusts enough to inspect with Codex. Unknown or adversarial repositories are out of scope.

## 2. Assets

- source code and uncommitted work;
- API keys, Codex credentials, tokens, and environment secrets;
- user identity and local filesystem data;
- Git history and repository integrity;
- human decisions and execution contracts;
- audit evidence and model/thread identifiers;
- external services, production systems, and billable resources reachable from the machine.

## 3. Trust boundaries

```mermaid
flowchart LR
    User["User"] --> CLI["PromptTripwire CLI/UI"]
    Repo["Trusted repository content"] --> Snapshot["Isolated snapshot"]
    CLI --> Controller["Local controller"]
    Controller --> Codex["Codex App Server / service"]
    Controller --> API["OpenAI Responses API"]
    Controller --> Worktree["Disposable execution worktree"]
    Controller --> Store["Private local store"]
    Worktree -. "blocked by default" .-> External["Network / external systems"]
```

Repository text, model output, tool requests, App Server events, local HTTP requests, and persisted data are untrusted inputs even when their transport is authenticated.

## 4. Threats and controls

| Threat | MVP control | Residual risk |
|---|---|---|
| Probe modifies user's work | Probes use a read-only temporary worktree; original checkout is never CWD | Sandbox/platform defects remain possible |
| Prompt injection in repository instructions | Trusted-repository scope, no network, no project scripts, bounded static inspection, explicit instruction/evidence provenance | Tracked malicious content can still influence model output |
| Secret exposure to model or logs | Snapshot tracked files only, deny common secret paths, minimal environment, redaction, no environment dumps or raw reasoning | A tracked secret in an allowed source file can still be read |
| Command injection | Structured command actions, allowlisted static commands in probes, deny unknown/compound execution | Parser or App Server metadata mismatch |
| Symlink/path escape | Resolve real paths, deny absolute/parent escape, protected path precedence, disposable roots | Platform-specific filesystem races |
| Local UI hijack | Loopback bind, random port, per-run capability token, same-origin/CORS/CSP, no remote bind | Other processes under the same OS user may still access local resources |
| Contract tampering | Canonical hash, immutable versions, recompute before use, transactional state | Same-user local attacker can alter both program and data |
| Stale approval | Bind to task/snapshot/config/model hashes; invalidate on drift | Undetected external state drift is possible |
| External or production side effect | Network and remote tools disabled; deterministic decision and explicit allowlist | User can explicitly authorize a dangerous action |
| Approval confusion | Concrete effects, no high-impact default, expected version/idempotency checks | Human review can still be mistaken |
| Malicious model output | Strict schemas plus deterministic policy; model cannot approve | Policy omissions or semantic misclassification |
| Denial of service/cost runaway | Probe/time/token limits, capped concurrency/retry, usage display, cancel | Provider-side cost estimates may be unavailable |
| Audit data leakage | Private OS storage, retention, sanitized export, no telemetry | Local disk is not application-level encrypted |
| Partial change after deviation | Isolated disposable worktree, interrupt, preserve evidence, clean restart | A local write may occur before detection |

## 5. Probe policy

Probe worktrees include only the approved Git snapshot and an explicitly accepted dirty patch. Untracked files are excluded by default.

The probe command policy allows only bounded static inspection needed to understand the repository. Examples may include Git metadata and text search. The actual allowlist must be action-based and tested; this document does not authorize arbitrary `sh -c`, interpreters, project scripts, package managers, builds, tests, or network clients.

The probe process:

- has no network access;
- cannot write the snapshot;
- uses normal-schema `approvalPolicy: "untrusted"` and declines non-inspection command, file-change, and permission requests;
- never uses standalone App Server `command/exec`, because it bypasses turn approvals and read-only sandboxing alone is not a command-class allowlist;
- receives a minimal environment;
- has CPU/time/output limits;
- cannot access arbitrary home-directory paths;
- persists sanitized summaries, not full shell output by default.

If the platform cannot enforce these properties, probing must stop with an actionable error.

The client also inspects completed command/file items and aggregate diffs. A trusted command can start without a server approval request, so an unexpected action can be detected only after it begins inside the disposable worktree. Reports must preserve that distinction.

## 6. Secrets

### Never persist or display

- `OPENAI_API_KEY` or Codex authentication tokens;
- GitHub, cloud, package-registry, or database credentials;
- cookies, session tokens, private keys, signing materials;
- full process environments;
- authorization headers;
- raw model reasoning.

### Secret-path policy

Default protected patterns include environment files, key/certificate formats, credential directories, Git credential files, cloud CLI config, SSH material, and known package-manager auth files. Protected paths override allowed paths.

Pattern matching is a backstop, not proof that a file is safe. Before export and log persistence, text passes through value-based and pattern-based redaction. Redaction failures are security bugs and block export.

Credentials are read from the user's existing Codex/OpenAI setup at runtime. PromptTripwire does not provide a settings screen that stores API keys in the MVP.

The Responses comparator uses the official SDK with `store: false` and receives no tools. Only task text and already validated/sanitized plan artifacts are sent. Structured comparison output is rejected if deterministic sanitization would alter it, so secret-like model output cannot be persisted under a content hash. Model refusal, invalid references, timeout, or missing API credentials never infer approval and never fall back to extracting credentials from Codex configuration.

## 7. Network and external tools

Network is denied by default in both planning and execution. A request to enable it is a blocking decision that must state:

- exact purpose;
- destination host or service;
- read versus write intent;
- credential use;
- expected cost or production impact;
- rollback or compensating action.

The P0 contract supports explicit hosts/actions, not unrestricted internet access. MCP/app tools are disabled unless named by the contract. Remote writes, deploy, release, publish, migration application, billing, and production operations require both contract approval and separate user authorization at the point of action.

P0 does not enable runtime experimental APIs, granular approval, or permission profiles. Any normal-schema permission-expansion request that arrives receives an empty grant and pauses the run. Proactive `request_permissions` support is deferred because Codex 0.144.4 requires the experimental capability for the granular route.

## 8. Local UI

- Bind only to loopback.
- Generate a high-entropy capability token for each run.
- Prefer the token in a short-lived URL fragment or secure bootstrap flow rather than persistent query logs.
- Require token and same-origin checks for mutations.
- Set restrictive Content Security Policy and frame protection.
- Disable wildcard CORS.
- Escape all task, repository, command, path, and model-provided text.
- Do not render model-provided HTML.
- Do not load third-party scripts, fonts, analytics, or images.
- Expire access when the controller exits or the run is archived.

## 9. Contract and approval integrity

- Every decision has a stable ID and expected run state.
- Approval requests include the current contract version and content hash.
- Duplicate responses are idempotent; conflicting responses fail.
- High-impact options are never preselected.
- “Approve all future actions” is not exposed by PromptTripwire.
- Session-wide App Server approval is not used when it would bypass per-action contract matching.
- A contract amendment creates a new version and clean execution worktree.

## 10. Logging and retention

Logs use structured event types and references, not raw payload dumps. User-private file permissions are applied where supported.

Default retention:

- completed/failed/cancelled runs: seven days;
- active/paused runs: until resolved;
- pinned runs: until explicit deletion;
- temporary worktrees: removed after terminal state, with cleanup failure reported.

Deletion removes database references and artifacts. Secure erasure on SSDs is not claimed.

## 11. Incident behavior

On policy-engine crash, App Server disconnect, event sequence corruption, snapshot mismatch, redaction failure, or uncertain approval state:

1. stop accepting new execution approvals;
2. interrupt the active turn if possible;
3. disable external/network capability;
4. persist a sanitized error and last trusted state;
5. mark the run failed or paused, never completed;
6. require explicit recovery or a clean restart.

## 12. Known limitations to disclose

- The MVP is not a hardened boundary against a malicious repository or same-user local attacker.
- Model consensus does not imply correctness or safety.
- Some local changes may be detected after they occur inside a disposable worktree.
- Source code and plan metadata are processed by OpenAI services under the user's account and applicable terms.
- Local audit storage relies on OS account and filesystem protections; it is not independently encrypted.
- macOS is the first verified platform; Linux must be tested, and Windows is initially unsupported.

These limitations must appear in user-facing documentation and the Build Week submission rather than being hidden in implementation notes.
