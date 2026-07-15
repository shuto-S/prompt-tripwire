# PromptTripwire judge guide

PromptTripwire is a local-first preflight and execution gate for Codex. This guide uses the compiled macOS arm64 release artifact; judges do not need the TypeScript source tree or a source build.

## Supported platform and prerequisites

- macOS on Apple silicon (`arm64`)
- Node.js 24.15 or newer
- npm 11 or newer (used only by the dependency-free safe fixture's test script)
- Git
- `codex-cli 0.144.4`
- an existing authenticated Codex CLI session

Check the last prerequisite with:

```sh
codex --version
codex login status
```

PromptTripwire starts `codex app-server` and reuses that authenticated Codex session for probes, GPT-5.6 comparison, and execution. Do not create or configure `OPENAI_API_KEY`; PromptTripwire neither requires nor reads one.

## Verify, unpack, and install

Place the `.tar.gz` and `SHA256SUMS.txt` files in the same directory, then run:

```sh
shasum -a 256 -c SHA256SUMS.txt
tar -xzf prompt-tripwire-v0.1.0-macos-arm64.tar.gz
cd prompt-tripwire-v0.1.0-macos-arm64
./bin/tripwire --version
./bin/tripwire --help
```

The archive runs in place. Optional user-local installation is one command and requires no `sudo`:

```sh
./install.sh
```

The default prefix is `~/.local`. Add `~/.local/bin` to `PATH` if it is not already present. To uninstall:

```sh
~/.local/lib/prompt-tripwire/0.1.0/uninstall.sh
```

Set `PROMPT_TRIPWIRE_PREFIX` for both commands to use another user-owned prefix.

## Thirty-second recorded UI fallback

This path is explicitly recorded and read-only. It does not call Codex, execute code, or claim to verify the live integration.

```sh
./bin/tripwire replay
```

Open the printed loopback URL, inspect the sample divergence and evidence, then press `Ctrl-C`. For a terminal-only check:

```sh
./bin/tripwire replay --terminal
```

## Live safe-fixture flow

The included fixture has no dependencies, credentials, network calls, deploy targets, or external actions. All implementation happens in a disposable worktree; the generated source fixture remains unchanged.

```sh
DIST="$PWD"
FIXTURE="$(mktemp -d)/prompt-tripwire-judge-fixture"
./bin/create-judge-fixture "$FIXTURE"
npm --prefix "$FIXTURE" test
```

1. Inspect with three independent read-only Codex probes and the isolated GPT-5.6 comparator:

   ```sh
   ./bin/tripwire inspect \
     --repo "$FIXTURE" \
     --task-file "$DIST/judge/task.md" \
     --terminal
   ```

   Copy the printed `Run:` value as `RUN_ID`.

2. Review the recorded plans, decision state, and contract preview:

   ```sh
   ./bin/tripwire review RUN_ID --terminal
   ```

   The fixture explicitly requests two compatibility changes, so the deterministic policy normally presents one all-or-none compatibility card. The terminal output includes a complete command for each option. Run the printed command for **Allow local implementation**, then rerun the review command if needed. If a model introduces a separate blocking unknown, keep it visible and resolve only a bounded option shown by the review command; do not broaden paths or capabilities. Non-string inputs are explicitly outside this fixture's scope and should not become an unknown.

3. Approve the current contract and copy the printed contract ID:

   ```sh
   ./bin/tripwire approve RUN_ID
   ./bin/tripwire status RUN_ID
   ```

4. Execute the approved local change in a new disposable worktree:

   ```sh
   ./bin/tripwire run --contract CONTRACT_ID --terminal
   ```

5. Inspect the sanitized evidence:

   ```sh
   ./bin/tripwire report RUN_ID --format markdown
   git -C "$FIXTURE" status --short
   ```

The report should contain the contract hash, Codex/App Server identifiers, observed paths, the real `npm test` result, deviations, and remaining unknowns. `git status --short` for the original fixture should remain empty.

## Safety boundaries

- Planning uses separate fresh threads with identical task/snapshot inputs.
- Planning worktrees are read-only; network, project scripts, interpreters, package managers, and writes are denied.
- GPT-5.6 comparison runs in a fresh empty directory with no tools, network, MCP, apps, or subagents.
- Execution uses another disposable worktree. Network, remote writes, deploy, publish, release, migration application, production data, credentials, and permission expansion remain denied in P0 even if local preparation is approved.
- A local change that cannot be stopped before it occurs is detected inside the disposable worktree, interrupted, and reported. PromptTripwire does not describe detective monitoring as perfect prevention.
- The Decision Inbox binds only to loopback and uses a per-run capability token supplied in a one-time URL fragment.

## Troubleshooting

- `CODEX_VERSION_MISMATCH`: install exactly `codex-cli 0.144.4`; schema drift is fail-closed.
- `DIRTY_CHOICE_REQUIRED`: the source repository is dirty. Use `--dirty committed` to inspect the committed snapshot or `--dirty include` to bind the approved patch.
- Login/usage error: run `codex login status`, sign in with the normal Codex flow if needed, and retry. Do not add an API key specifically for PromptTripwire.
- Recorded replay works but live inspection fails: replay is only a UI fallback; report the live failure rather than presenting replay as integration evidence.
- Unsupported OS/CPU: this Build Week artifact is macOS arm64 only.

## Source-repository verification

Maintainers can reproduce the full suite from a clean checkout:

```sh
npm ci
npm run check
npm run package:macos-arm64
npm run verify:release
```

See `SECURITY.md` for the threat model and residual risk statement.
