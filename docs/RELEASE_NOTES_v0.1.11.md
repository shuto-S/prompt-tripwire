# PromptTripwire v0.1.11 candidate release notes

Status: unreleased source candidate. No GitHub Release, tag, npm publication,
public Plugin Directory submission, deployment, YouTube upload, or Devpost
submission is performed by this change.

## What changed

- Removed numeric Codex version gates from the runtime, Plugin adapter,
  installer, uninstaller, package checks, and active documentation.
- Added one shared machine-readable normal App Server compatibility profile for
  every request, notification, response, required field, type, nullability, and
  known enum consumed by PromptTripwire.
- Added a pre-repository compatibility gate that resolves and digests one Codex
  executable, generates its normal schema in private temporary storage, performs
  the normal handshake, and runs a bounded tool-free, read-only,
  network-disabled nonce canary through that same process.
- Bound executable realpath/digest, reported version, profile version,
  normalized schema fingerprint, canary fingerprint, and compatibility
  fingerprint into the repository snapshot and therefore the immutable
  contract hash.
- Re-measure compatibility immediately before approval and run. Failure or any
  exact attestation drift makes the run stale, and run reuses the verified
  process before creating its disposable worktree.
- Allow safe additive optional schema, unused methods, and schema-only unknown
  enum variants. Unknown requests or variants actually observed at runtime are
  denied and interrupt the turn.
- Keep the Plugin as a thin CLI adapter. Installation checks Codex command
  presence, output shape, and login rather than a version number. Uninstall
  requires no Codex version and does not guess-edit global configuration when
  the command is unavailable.

## Safety boundaries unchanged

- Human decisions and contract approval are never automated.
- Runtime `experimentalApi`, MCP, hooks, hosted services, new credentials,
  network access, remote writes, deploy, release, secret access, destructive
  operations, and permission expansion remain denied.
- Planning and comparison remain read-only and target writes remain contained
  in disposable worktrees with deviation interruption and sanitized reports.
- `OPENAI_API_KEY` is not required; PromptTripwire reuses the existing local
  Codex login.

## Compatibility policy

The code has no per-version allowlist or behavior branch. Historical 0.144.4
Build Week evidence and the current 0.144.6 development smoke are documented
known-good versions only. Other versions pass or fail based on measured normal
schema, handshake, and canary behavior.

The canary is intentionally bounded. Semantic drift that preserves the schema
and lies outside the observed nonce/tool/network behavior remains a residual
risk and is not claimed as verified.

## Install candidate archive

```sh
shasum -a 256 -c SHA256SUMS.txt
tar -xzf prompt-tripwire-v0.1.11-macos-arm64.tar.gz
cd prompt-tripwire-v0.1.11-macos-arm64
./install.sh --with-codex-plugin
codex plugin list --json
```

Uninstall only PromptTripwire-owned runtime and Plugin state with:

```sh
~/.local/lib/prompt-tripwire/0.1.11/uninstall.sh --with-codex-plugin
```
