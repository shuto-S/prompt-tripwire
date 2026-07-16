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
tar -xzf prompt-tripwire-v0.1.1-macos-arm64.tar.gz
cd prompt-tripwire-v0.1.1-macos-arm64
./bin/tripwire --version
./bin/tripwire --help
```

The shortest user-local setup installs the runtime and Codex Plugin together
and requires no `sudo`:

```sh
./install.sh --with-codex-plugin
codex plugin list --json
```

The installed display name is `PromptTripwire`; its Skill name is
`prompt-tripwire:preflight`. In a new Codex task, invoke it explicitly:

```text
Use prompt-tripwire:preflight before implementing this task.
```

The default runtime and marketplace root is
`~/.local/lib/prompt-tripwire/0.1.1`. The marketplace retains the relative
`./plugins/prompt-tripwire` source. The installer verifies macOS arm64, Node.js,
Git, Codex 0.144.4, and the existing login; it never runs inspect, decisions,
approval, or implementation. It does not require `OPENAI_API_KEY`.
An upgrade in the same prefix repoints only launchers owned by a verified older
PromptTripwire install and rejects unrelated files or symlinks.

Plain `./install.sh` remains runtime-only and does not register a Codex Plugin.
Add `~/.local/bin` to `PATH` if using the runtime directly. To remove the
Plugin, its owned marketplace registration, and runtime together:

```sh
~/.local/lib/prompt-tripwire/0.1.1/uninstall.sh --with-codex-plugin
```

The targeted uninstall leaves every other Plugin and marketplace untouched and
is safe when PromptTripwire is already absent. Set `PROMPT_TRIPWIRE_PREFIX` for
both commands to use another user-owned prefix.

For a Git-marketplace fallback, first keep the artifact's `tripwire` launcher
on `PATH` or set `PROMPT_TRIPWIRE_BIN`, then run:

```sh
codex plugin marketplace add shuto-S/prompt-tripwire --ref main
codex plugin add prompt-tripwire@prompt-tripwire-local
codex plugin list --marketplace prompt-tripwire-local
```

The Skill always stops for human Decision Inbox choices and explicit contract
approval. Neither the installer nor the calling Codex task may approve on the
user's behalf.

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
- `CODEX_LOGIN_REQUIRED`: sign in through the normal `codex login` flow; do not create an API key for PromptTripwire.
- `RUNTIME_MISSING`: use the complete release directory; do not copy only `install.sh` away from its payload.

## Source-repository verification

Maintainers can reproduce the full suite from a clean checkout:

```sh
npm ci
npm run check
npm run package:macos-arm64
npm run verify:release
```

See `SECURITY.md` for the threat model and residual risk statement.
