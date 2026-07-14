# Dependency record

Status date: 2026-07-14

PromptTripwire uses npm workspaces and keeps the foundation toolchain development-only. `package-lock.json` is authoritative for resolved transitive versions and integrity hashes.

Runtime persistence uses the built-in `node:sqlite` module from Node.js 24.15+; no third-party SQLite driver or native addon is installed. The API is release-candidate Stability 1.2 and is pinned through the Node baseline and CI rather than treated as a semver-stable package dependency.

## Direct development dependencies

| Package | Version | License | Purpose |
|---|---:|---|---|
| `typescript` | 6.0.3 | Apache-2.0 | Strict typecheck and project-reference build; latest release compatible with the lint parser peer range |
| `@types/node` | 24.13.3 | MIT | Node.js 24 API types |
| `eslint` | 10.7.0 | MIT | JavaScript/TypeScript lint runner |
| `@eslint/js` | 10.0.1 | MIT | ESLint recommended JavaScript rules |
| `typescript-eslint` | 8.64.0 | MIT | Type-aware TypeScript lint configuration |
| `globals` | 17.7.0 | MIT | Node global identifiers for ESLint flat config |
| `prettier` | 3.9.5 | MIT | Deterministic code/config formatting check |

## CI-only tool

| Package | Version | License | Purpose |
|---|---:|---|---|
| `@openai/codex` | 0.144.4 | Apache-2.0 | Generate and verify the pinned normal App Server schema |

## Direct runtime dependencies

| Package | Version | License | Purpose |
|---|---:|---|---|
| `zod` | 4.4.3 | MIT | Strict runtime validation and inferred types for domain artifacts and persisted state |

`npm run check:licenses` verifies that every installed lockfile package records a license and rejects GPL, AGPL, and SSPL dependencies. New runtime dependencies require the same review and a synchronized update to this file.
