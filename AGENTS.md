# PromptTripwire repository instructions

Read `docs/SPECIFICATION.md`, `docs/ARCHITECTURE.md`, and `docs/SECURITY.md` before implementing product behavior.

## Source of truth

- `docs/SPECIFICATION.md` is authoritative for product scope and acceptance criteria.
- `docs/ARCHITECTURE.md` owns component boundaries and protocol choices.
- `docs/SECURITY.md` owns trust boundaries and fail-closed behavior.
- If implementation requires changing an approved behavior, update the relevant specification and `docs/DECISIONS.md` in the same change.

## Product invariants

- Planning probes are independent, use the same inputs, and cannot modify the target repository.
- Model output never bypasses deterministic confirmation rules.
- No execution begins against a stale or unapproved contract.
- Network, deploy, release, remote writes, permission expansion, destructive data operations, and secret access are denied by default.
- A local file change that cannot be prevented must be contained in a disposable worktree, detected, and interrupted; do not describe reactive detection as perfect prevention.
- Do not log API keys, tokens, environment values, raw reasoning, or secret-like content.
- The local UI binds only to loopback and requires a per-run capability token.

## Build Week evidence

- Preserve dated commits and the primary Codex session.
- Keep the README collaboration section current with human decisions and Codex contributions.
- Do not claim a feature works until its acceptance criterion has an executable test or verified demo.

## Changes

- Keep the MVP local-first and single-user.
- Avoid adding a hosted backend, user account system, team workflow, IDE extension, or non-Codex agent adapter unless the scope is explicitly revised.
- New dependencies, branch creation, commits, pushes, releases, and deployment require the user's explicit request.
