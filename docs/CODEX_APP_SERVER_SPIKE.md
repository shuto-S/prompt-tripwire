# Codex App Server 0.144.4 feasibility spike

Status: P0 hard gate passed with documented constraints

Validation date: 2026-07-14

Environment: macOS 26.5.2 (25F84), arm64, Node.js 26.5.0, `codex-cli 0.144.4`

## Decision

Continue the MVP on the documented App Server stdio protocol, pinned to `codex-cli 0.144.4`. P0 uses only methods and fields present in the schema generated without `--experimental`. It does not opt into `initialize.params.capabilities.experimentalApi`, permission profiles, granular approvals, dynamic tools, or WebSocket transport.

The `codex app-server` CLI help still labels the umbrella command and schema generators experimental. The official App Server documentation separately identifies stdio as the default transport, WebSocket as experimental, and individual fields that require the experimental capability. PromptTripwire therefore treats the normal generated schema as a version-pinned compatibility surface, not as a semver-stable public API. Any CLI or canonical schema hash drift fails before probing.

Official references:

- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Sandboxing](https://learn.chatgpt.com/docs/sandboxing)

## Executable evidence

Run from the repository root:

```sh
node scripts/spikes/codex-app-server.mjs schema
node scripts/spikes/codex-app-server.mjs replay
node scripts/spikes/codex-app-server.mjs live-command
node scripts/spikes/codex-app-server.mjs live
```

`live` uses the existing Codex authentication and makes bounded model calls. It intentionally does not print or persist raw reasoning, full environments, or command output.

Committed evidence:

- `fixtures/app-server/schema-manifest-0.144.4.json`
- `fixtures/app-server/live-evidence-2026-07-14.json`
- `fixtures/app-server/golden-handshake.jsonl`
- `fixtures/app-server/duplicate-events.jsonl`
- `fixtures/app-server/reordered-events.jsonl`
- `fixtures/app-server/disconnect.jsonl`

## Stable P0 surface

The normal 0.144.4 schema contains the required surface:

| Direction | Required methods/events |
|---|---|
| Client request | `initialize`, `thread/start`, `turn/start`, `turn/interrupt` |
| Client notification | `initialized` |
| Server request | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval` |
| Server notification | `thread/started`, `turn/started`, `item/started`, `item/completed`, `turn/diff/updated`, `serverRequest/resolved`, `turn/completed` |

The live golden flow completed as:

```text
initialize -> initialized -> thread/start -> turn/start -> item/completed -> turn/completed
```

The strict `outputSchema` result was parsed and validated as `{ "status": "ok" }`. A separate live turn reached `turn/completed.status = interrupted` after `turn/interrupt`.

The normal schema contains 267 files and canonical SHA-256 `ccb435118d3dfae2cfe0dff56e4955398edfc5c54351985a45e8de256c34e3bb`. The experimental schema contains 337 files. Experimental-only methods include process control, realtime, remote control, environment, collaboration-mode, and thread-pagination surfaces; none is required by P0.

## Observed containment boundary

| Operation | Configuration | Observation | Classification |
|---|---|---|---|
| Target write with standalone `command/exec` | `readOnly`, network false | Sandbox rejected the write; file absent | Prevented |
| Network request with standalone `command/exec` | `readOnly`, network false | Request failed | Prevented |
| Interpreter with standalone `command/exec` | `readOnly`, network false | `node --version` ran | Not prevented by sandbox alone |
| Package manager, build, and test fixtures | `readOnly`, network false, minimal child environment | `npm` and the controlled scripts did not run | Prevented in the recorded environment |
| Four model-requested command attempts | `untrusted` + `readOnly` | Four approval requests, all declined; no file changed | Declined before execution |
| Model file change | `untrusted` + `readOnly` | `item/fileChange/requestApproval`, declined, file absent | Declined before execution |
| Model file change in disposable root | `never` + `workspaceWrite` | File applied, `fileChange` completed, three diff notifications | Detected after contained write |
| Permission expansion through normal-schema configuration | `untrusted` + `readOnly` | No permission request emitted | Not observed |
| Granular `request_permissions` configuration | no experimental capability | Runtime rejected the thread before a turn | Experimental-only in practice |
| Turn cancellation | live in-flight turn | Final status `interrupted` | Prevented further work after interrupt |

Consequences:

1. Probe turns use `untrusted` plus `readOnly`, network false, and a client that declines every non-inspection command/file/permission request.
2. Probe code never uses standalone `command/exec`; it bypasses turn approval flow and the sandbox alone does not classify interpreter, build, test, or package-manager intent.
3. Completed command/file items and aggregate diffs remain authoritative detective signals. A local write may already exist inside the disposable worktree before `turn/diff/updated` is processed.
4. Permission expansion is deny-only in P0. The client can decline a normal-schema permission request if one arrives, but P0 does not invoke or depend on granular `request_permissions` because the runtime requires the experimental capability.
5. User-facing reports distinguish Prevented, Declined before execution, Detected after contained write, and Not observed.

## Child environment

The App Server process receives only `HOME`, optional `CODEX_HOME`, locale,
user, shell, terminal, temporary-directory, and `PATH` variables needed to
locate the pinned CLI and existing authentication. It is started with:

```text
shell_environment_policy.inherit=none
```

A synthetic canary present in the App Server process was absent from a sandboxed child command. The spike never dumps the environment. Explicit per-command environment overrides remain prohibited unless a future contract names them.

A 2026-07-18 follow-up against the same 0.144.4 binary also compared Plugin
context with and without `--disable plugins`. The flag removed the installed
PromptTripwire Plugin contribution and bundled `preflight` Skill while
preserving the literal invocation text in the task. A live API-key-free planning
probe then completed with repository-contained static reads and no approval
request. Standalone system and user Skills remained discoverable, so this is
recorded as Plugin-contribution isolation rather than a global Skill switch.

## Assumption resolution

| Assumption | Resolution |
|---|---|
| A-001 approval coverage | Continue with constraints. Command/file approvals are observed before execution under `untrusted`; allowed or non-intercepted writes still require disposable containment and post-write diff monitoring. Stable permission expansion was not observed and is deny-only. |
| A-002 minimal child environment | Confirmed for 0.144.4 with `inherit=none`; the canary was not inherited. Keep an explicit minimal App Server environment and never persist an environment dump. |
| A-003 schema/minimum version | Confirmed at exactly 0.144.4. Generate the normal schema at build/test time, canonicalize it, compare its hash, and use only normal-schema runtime fields. The generator may be experimental; runtime experimental capability is not allowed. |

## Acceptance feasibility

- AC-002 is feasible through layered read-only sandboxing, `untrusted` approval handling, static-inspection instructions, event monitoring, and an unchanged original checkout check. Sandbox mode alone is insufficient for command-class denial.
- AC-010 is feasible because contained writes produce authoritative file items and `turn/diff/updated`; interruption is verified separately.
- AC-011 is feasible for command/file/network denial. Permission expansion is fail-closed and cannot be approved in P0; the normal-schema permission-request event remains supported if emitted.
- AC-019 is feasible through exact CLI version plus canonical schema hash checks and idempotent/corruption-aware event replay fixtures.

## Residual risk

- The App Server compatibility surface can change despite the normal/experimental schema split, so exact version and schema drift checks are mandatory.
- A trusted command may run without an approval request. Probe instructions and approval handling reduce this risk, while completed-item/diff monitoring and disposable worktrees provide recovery; they do not turn reactive detection into prevention.
- `item/permissions/requestApproval` exists in the normal schema, but an end-to-end permission request was not observed without experimental granular approval configuration.
- The spike proves behavior on the recorded macOS/arm64 environment only.
