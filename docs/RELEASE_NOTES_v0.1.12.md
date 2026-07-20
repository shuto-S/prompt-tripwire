# PromptTripwire v0.1.12

Judge-facing Decision Inbox clarity for macOS arm64. This release keeps the
v0.1.11 measured Codex compatibility, explicit human approval, immutable
contract, and disposable-worktree execution boundaries unchanged.

## What changed

- Classifies each review question as observed probe divergence, deterministic
  policy, both, or unknown provenance using validated persisted structure rather
  than reparsing model prose.
- Shows valid planning-probe counts, material alternative counts, and per-option
  support counts in the primary review view while keeping raw probe identifiers
  in the evidence disclosure.
- Projects the immutable contract into three direct groups: what Codex may
  change, what must pass, and what remains blocked.
- Adds English, Japanese, mobile Japanese, and contract-preview screenshots plus
  a 49-second deterministic UI preview. The preview is explicitly not a live
  Codex inspect, execution, or report recording.
- Strengthens submission metadata checks so the recorded v0.1.2 evidence capture
  and current judge distribution cannot be silently conflated.

## Safety boundaries unchanged

- No model, Plugin, installer, or UI action selects a decision or approves a
  contract on the human's behalf.
- Canonical plans, decisions, contracts, hashes, snapshots, policy results, and
  mutation payloads are unchanged by the new presentation fields.
- Network access, remote writes, deploy, release, secret access, destructive
  operations, and permission expansion remain denied by default.
- The Plugin remains an explicit-only thin CLI adapter with no hook, MCP server,
  hosted backend, or additional credential path.
- `OPENAI_API_KEY` is not required; the existing authenticated Codex CLI session
  is reused.

## Install

```sh
shasum -a 256 -c SHA256SUMS.txt
tar -xzf prompt-tripwire-v0.1.12-macos-arm64.tar.gz
cd prompt-tripwire-v0.1.12-macos-arm64
./install.sh --with-codex-plugin
codex plugin list --json
```

Uninstall only PromptTripwire-owned runtime and Plugin state with:

```sh
~/.local/lib/prompt-tripwire/0.1.12/uninstall.sh --with-codex-plugin
```

## Evidence boundary

The canonical 2:52.862 submission video remains the disclosed v0.1.2 capture
because it contains the retained live inspect and separate human-approved safe
execution evidence. The v0.1.12 Issue #43 media is a deterministic fixture-based
UI preview and is not presented as new live execution evidence.
