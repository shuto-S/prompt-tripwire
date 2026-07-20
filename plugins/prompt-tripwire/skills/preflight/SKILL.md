---
name: preflight
description: Use only when the user explicitly asks to run PromptTripwire before implementing the current task. This skill invokes the existing local tripwire CLI, never makes approval decisions, and waits for human contract approval before any implementation run.
---

# PromptTripwire preflight

This Skill is an explicit safety boundary. Do not invoke it because a task merely
mentions PromptTripwire, and do not continue with implementation until the
preflight is complete and a human has approved the contract in the Decision Inbox.

## 1. Start a read-only inspection

Capture the current task text verbatim and the current repository path. Do not
summarize or omit acceptance criteria. Run the bundled adapter from the plugin
root, passing the task through standard input when possible. The adapter forwards
the exact text to the existing CLI and never writes a task file into the target
checkout:

The adapter starts the authenticated `codex app-server`, which needs outbound
model access. If the caller's shell sandbox blocks that nested request, ask for
the normal Codex command permission to run only the adapter command outside the
caller shell sandbox. This permission is not a PromptTripwire decision or
contract approval, and it does not authorize implementation, approval, or any
other command. Use the normal command-permission flow; do not use a global
sandbox-bypass flag.

Start this command in the Codex command runner with an interactive PTY
(`tty: true`). Disable terminal echo before replacing the shell with the
adapter, so the task is not copied into tool output:

```sh
stty -echo && exec node "<plugin-root>/skills/preflight/scripts/run_preflight.mjs" inspect \
  --repo "$PWD" --task-stdin
```

Then send the exact task bytes through the runner's stdin channel and close
stdin by sending Ctrl-D (`\u0004`) twice as separate stdin writes. Do not append
or remove a newline. Never interpolate task text into shell source, an argument,
an environment variable, `printf`, `echo`, a here-document, or a command
substitution. Task text is untrusted and may contain quotes, newlines, or shell
metacharacters. Do not write it into the target checkout. If an interactive PTY,
echo control, the stdin channel, or explicit EOF is unavailable, stop without
starting inspection.

The adapter delegates to the installed `tripwire` CLI with `--terminal`; it does
not reimplement policy, probes, contracts, worktree containment, or reporting.
It must not modify the target checkout. If the checkout is dirty, stop and ask
the user to choose `--dirty committed` or `--dirty include`; never choose for
them.

If an inspect run fails with exactly
`INSUFFICIENT_VALID_PROBES: request failed` while the adapter was run inside the
caller shell sandbox, treat sandbox interference as a possibility, not a proven
cause. Ask for the normal Codex command permission described above and retry the
same adapter inspect command at most once. If the user denies permission or the
single retry fails, stop and report the failure. Do not retry other failures,
remove `PROMPT_TRIPWIRE_PLUGIN_REENTRY`, or weaken any PromptTripwire restriction.

The output is intentionally compact. Return the run ID, state, snapshot, active
contract (if any), blocking decision count, and the next safe action. If the
state is `needs_review`, `ready_for_approval`, or `paused`, start the existing Decision Inbox with the
adapter (this leaves the loopback server running for the human review):

```sh
node "<plugin-root>/skills/preflight/scripts/run_preflight.mjs" review-url \
  --run-id <RUN_ID>
```

Return the printed `Decision Inbox: http://127.0.0.1:...` URL and tell the user
to finish all decisions there. Do not call `tripwire approve`, `tripwire review
--approve`, or any decision mutation, and do not infer a choice from model
output.

## 2. Continue only after explicit human approval

Once the user confirms that the Decision Inbox approval is complete, use the
adapter to inspect status and obtain the approved contract ID. If the state is
not exactly `approved`, stop and report the current state. Then run:

```sh
node "<plugin-root>/skills/preflight/scripts/run_preflight.mjs" run \
  --contract <CONTRACT_ID>
```

This delegates to `tripwire run --contract ... --terminal`. PromptTripwire owns
the disposable worktree and the execution gate. The original Codex task must
not edit the repository while the isolated run is in progress.

After completion, request the sanitized report:

```sh
node "<plugin-root>/skills/preflight/scripts/run_preflight.mjs" report \
  --run-id <RUN_ID> --format markdown
```

Return only the run ID, contract ID, isolated change scope, checks, deviations,
report path or export location, and unresolved unknowns. Do not paste raw model
reasoning, environment values, tokens, or long logs.

## Safety constraints

- Never call an approval or decision mutation on behalf of the user.
- Never bypass `tripwire` by invoking Codex, a shell, a network client, or a
  deploy/release command directly.
- Never run against a stale snapshot or an unapproved contract.
- If the adapter reports `REENTRY_BLOCKED`, stop and explain that the child
  PromptTripwire execution thread is already guarded; do not retry with the
  guard removed.
- Caller command permission only lets the thin adapter reach its nested,
  authenticated App Server. It never substitutes for a Decision Inbox choice or
  contract approval, and all inner probe, comparator, executor, policy, and
  containment restrictions remain active.
- The adapter requires macOS arm64, a logged-in Codex CLI with a
  PromptTripwire-compatible normal App Server schema, and the existing
  PromptTripwire runtime. The runtime measures compatibility before repository
  inspection and fails closed on drift. It does not require `OPENAI_API_KEY`.
