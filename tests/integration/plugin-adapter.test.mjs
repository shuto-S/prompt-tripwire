import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  REENTRY_ENV,
  assertSupportedPlatform,
  assertRuntimeVersions,
  buildRuntimeArgs,
  redactOutput,
  runPreflight,
} from "../../plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs";

test("plugin blocks deterministic re-entry before invoking the runtime", () => {
  assert.throws(
    () => runPreflight(["inspect", "--task", "do not implement"], { [REENTRY_ENV]: "1" }),
    (error) => error.code === "REENTRY_BLOCKED",
  );
});

test("plugin rejects unsupported platforms", () => {
  assert.throws(
    () => assertSupportedPlatform("linux", "x64"),
    (error) => error.code === "UNSUPPORTED_PLATFORM",
  );
});

test("plugin delegates inspect without changing the target repository", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-plugin-test-"));
  const repository = join(root, "fixture");
  mkdirSync(repository);
  writeFileSync(join(repository, "README.md"), "fixture\n");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.name", "PromptTripwire Test"],
    ["config", "user.email", "test@example.invalid"],
    ["add", "."],
    ["commit", "-qm", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const runtime = join(root, "tripwire");
  const codex = join(root, "codex");
  const marker = join(root, "args.txt");
  const fake = `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'prompt-tripwire 0.1.8'
  exit 0
fi
printf '%s' "$*" > "$MARKER"
printf '%s\\n' 'Run: fixture-run'
printf '%s\\n' 'State: needs_review'
printf '%s\\n' 'Snapshot: fixture-snapshot'
printf '%s\\n' 'Contract: not approved'
`;
  const fakeCodex = `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' 'codex-cli 0.144.4'; fi
exit 0
`;
  writeFileSync(runtime, fake, { encoding: "utf8", mode: 0o700 });
  writeFileSync(codex, fakeCodex, { encoding: "utf8", mode: 0o700 });
  chmodSync(runtime, 0o700);
  chmodSync(codex, 0o700);
  const before = spawnSync("git", ["status", "--short"], {
    cwd: repository,
    encoding: "utf8",
  }).stdout;
  const output = runPreflight(
    ["inspect", "--repo", repository, "--task", "inspect this fixture", "--dirty", "committed"],
    {
      ["PROMPT_TRIPWIRE_BIN"]: runtime,
      ["PROMPT_TRIPWIRE_CODEX_BIN"]: codex,
      MARKER: marker,
    },
  );
  assert.match(output, /Run: fixture-run/u);
  assert.match(output, /State: needs_review/u);
  assert.equal(
    spawnSync("git", ["status", "--short"], { cwd: repository, encoding: "utf8" }).stdout,
    before,
  );
  assert.match(readFileSync(marker, "utf8"), /inspect --repo/u);
});

test("plugin receives untrusted multiline task bytes only through stdin", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-plugin-stdin-test-"));
  const repository = join(root, "fixture");
  mkdirSync(repository);
  writeFileSync(join(repository, "README.md"), "fixture\n");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.name", "PromptTripwire Test"],
    ["config", "user.email", "test@example.invalid"],
    ["add", "."],
    ["commit", "-qm", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const runtime = join(root, "tripwire");
  const codex = join(root, "codex");
  const taskMarker = join(root, "task.txt");
  const injected = join(root, "injected");
  const task = [
    "Use prompt-tripwire:preflight before implementing this task.",
    `Inspect this exact text: ' ; touch ${injected}; #`,
    `$(touch ${injected})`,
    `\`touch ${injected}\` and $HOME`,
  ].join("\n");
  writeFileSync(
    runtime,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'prompt-tripwire 0.1.8'
  exit 0
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--task" ]; then
    shift
    printf '%s' "$1" > "$TASK_MARKER"
    break
  fi
  shift
done
printf '%s\\n' 'Run: fixture-run'
printf '%s\\n' 'State: needs_review'
`,
    { mode: 0o700 },
  );
  writeFileSync(
    codex,
    `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' 'codex-cli 0.144.4'; fi
exit 0
`,
    { mode: 0o700 },
  );
  const adapter = fileURLToPath(
    new URL(
      "../../plugins/prompt-tripwire/skills/preflight/scripts/run_preflight.mjs",
      import.meta.url,
    ),
  );
  const before = spawnSync("git", ["status", "--short"], {
    cwd: repository,
    encoding: "utf8",
  }).stdout;
  const result = spawnSync(
    process.execPath,
    [adapter, "inspect", "--repo", repository, "--task-stdin"],
    {
      cwd: repository,
      encoding: "utf8",
      input: task,
      env: {
        ...process.env,
        PROMPT_TRIPWIRE_BIN: runtime,
        PROMPT_TRIPWIRE_CODEX_BIN: codex,
        TASK_MARKER: taskMarker,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(taskMarker, "utf8"), task);
  assert.equal(existsSync(injected), false);
  assert.equal(
    spawnSync("git", ["status", "--short"], { cwd: repository, encoding: "utf8" }).stdout,
    before,
  );
});

test("plugin gives a sanitized caller-sandbox hint without removing the re-entry guard", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-plugin-sandbox-hint-test-"));
  const runtime = join(root, "tripwire");
  const codex = join(root, "codex");
  const marker = join(root, "reentry.txt");
  writeFileSync(
    runtime,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'prompt-tripwire 0.1.8'
  exit 0
fi
printf '%s' "$PROMPT_TRIPWIRE_PLUGIN_REENTRY" > "$MARKER"
printf '%s\\n' 'INSUFFICIENT_VALID_PROBES: request failed' >&2
printf '%s\\n' 'Run: run_123e4567-e89b-42d3-a456-426614174000' >&2
printf '%s\\n' 'OPENAI_API_KEY=example-value-that-must-not-leak' >&2
exit 1
`,
    { mode: 0o700 },
  );
  writeFileSync(
    codex,
    `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' 'codex-cli 0.144.4'; fi
exit 0
`,
    { mode: 0o700 },
  );

  assert.throws(
    () =>
      runPreflight(["inspect", "--repo", root, "--task", "inspect this fixture"], {
        PROMPT_TRIPWIRE_BIN: runtime,
        PROMPT_TRIPWIRE_CODEX_BIN: codex,
        MARKER: marker,
      }),
    (error) => {
      assert.equal(error.code, "RUNTIME_FAILED");
      assert.match(error.message, /caller shell sandbox may have blocked/iu);
      assert.match(error.message, /normal Codex command permission/iu);
      assert.match(error.message, /retry the same inspect once/iu);
      assert.match(error.message, /not a PromptTripwire decision or contract approval/iu);
      assert.match(error.message, /Run: run_123e4567-e89b-42d3-a456-426614174000/u);
      assert.match(error.message, /OPENAI_API_KEY=\*\*\*\*/u);
      assert.doesNotMatch(error.message, /example-value-that-must-not-leak/u);
      return true;
    },
  );
  assert.equal(readFileSync(marker, "utf8"), "1");
});

test("plugin redacts malformed and short Basic and Bearer credentials across output boundaries", () => {
  const cases = [
    {
      input: "Authorization: Basic q",
      expected: "Authorization: Basic ****",
      secrets: ["q"],
    },
    {
      input: "Authorization: Bearer a:b",
      expected: "Authorization: Bearer ****",
      secrets: ["a:b"],
    },
    {
      input: "Authorization: Bearer a:b; diagnostic context",
      expected: "Authorization: Bearer ****",
      secrets: ["a:b", "diagnostic context"],
    },
    {
      input: "Authorization: Basic abc$def, trailing context",
      expected: "Authorization: Basic ****",
      secrets: ["abc$def", "trailing context"],
    },
    {
      input: '{"Authorization":"Basic Z","x":1}',
      expected: '{"Authorization":"Basic ****","x":1}',
      secrets: ["Z"],
    },
    {
      input: '{"Authorization":"Bearer a:b","x":1}',
      expected: '{"Authorization":"Bearer ****","x":1}',
      secrets: ["a:b"],
    },
    {
      input: '{"Authorization":"Basic abc$def?","x":1}',
      expected: '{"Authorization":"Basic ****","x":1}',
      secrets: ["abc$def?"],
    },
    {
      input: '{"Authorization":"Bearer a:\\"b","x":1}',
      expected: '{"Authorization":"Bearer ****","x":1}',
      secrets: ['a:\\"b'],
    },
    { input: "Bearer ?", expected: "Bearer ****", secrets: ["?"] },
    { input: 'Bearer "a:b"', expected: "Bearer ****", secrets: ["a:b"] },
    {
      input: 'Basic \\"a b:c$?\\" next',
      expected: "Basic **** next",
      secrets: ["a b:c$?", "b:c$?"],
    },
    {
      input: "Bearer \\'alpha beta:gamma$delta?\\' next",
      expected: "Bearer **** next",
      secrets: ["alpha beta:gamma$delta?", "beta:gamma$delta?"],
    },
    { input: "Bearer abc$def", expected: "Bearer ****", secrets: ["abc$def"] },
    { input: "Basic 'abc$def'", expected: "Basic ****", secrets: ["abc$def"] },
    {
      input: "Bearer abc$def, next",
      expected: "Bearer ****, next",
      secrets: ["abc$def"],
    },
    { input: "Basic a:b; next", expected: "Basic ****; next", secrets: ["a:b"] },
    {
      input: "Bearer abc? next",
      expected: "Bearer ****? next",
      secrets: ["abc"],
    },
  ];

  for (const { input, expected, secrets } of cases) {
    const output = redactOutput(input);
    assert.equal(output, expected);
    for (const secret of secrets) assert.equal(output.includes(secret), false, input);
  }

  const decisionInbox =
    "Decision Inbox: http://127.0.0.1:43100/runs/run_123#token=capability-value-1234";
  assert.equal(redactOutput(decisionInbox), decisionInbox);
});

test("plugin redacts common credential shapes from delegated runtime failures", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-plugin-redaction-test-"));
  const runtime = join(root, "tripwire");
  const codex = join(root, "codex");
  const marker = join(root, "reentry.txt");
  const rawSecrets = [
    "codex-secret-value",
    "plain-gh-secret-value",
    "hunter2-secret",
    "slack-secret-1234567890",
    ["xoxb", "1234567890", "abcdefghijklmnop"].join("-"),
    ["AKIA", "1234567890ABCDEF"].join(""),
    "dXNlcjpwYXNzd29yZA==",
    "abcdefgh12345678",
    "postgres://user:pass@localhost/database",
    "credential-value",
    "external-api-secret",
    "external-token-secret",
    "fragment-password-secret",
  ];
  writeFileSync(
    runtime,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'prompt-tripwire 0.1.8'
  exit 0
fi
printf '%s' "$PROMPT_TRIPWIRE_PLUGIN_REENTRY" > "$MARKER"
printf '%s\\n' 'CODEX_API_KEY=codex-secret-value' >&2
printf '%s\\n' 'GH_TOKEN=plain-gh-secret-value' >&2
printf '%s\\n' 'password: hunter2-secret' >&2
printf '%s\\n' 'SECRET="slack-secret-1234567890"' >&2
printf '%s%s%s%s%s\\n' 'xoxb' '-' '1234567890' '-' 'abcdefghijklmnop' >&2
printf '%s%s\\n' 'AKIA' '1234567890ABCDEF' >&2
printf '%s\\n' 'Authorization: Basic dXNlcjpwYXNzd29yZA==' >&2
printf '%s\\n' '{"Authorization":"Basic dXNlcjpwYXNzd29yZA==","x":1}' >&2
printf '%s\\n' 'Bearer abcdefgh12345678, next' >&2
printf '%s\\n' 'postgres://user:pass@localhost/database' >&2
printf '%s\\n' 'credential=credential-value' >&2
printf '%s\\n' 'https://example.invalid/cb?api_key=external-api-secret' >&2
printf '%s\\n' 'https://example.invalid/cb?safe=1&token=external-token-secret' >&2
printf '%s\\n' 'https://example.invalid/cb#password=fragment-password-secret' >&2
printf '%s\\n' 'Decision Inbox: http://127.0.0.1:43100/runs/run_123#token=capability-value-1234' >&2
exit 1
`,
    { mode: 0o700 },
  );
  writeFileSync(
    codex,
    `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' 'codex-cli 0.144.4'; fi
exit 0
`,
    { mode: 0o700 },
  );

  assert.throws(
    () =>
      runPreflight(["inspect", "--repo", root, "--task", "inspect this fixture"], {
        PROMPT_TRIPWIRE_BIN: runtime,
        PROMPT_TRIPWIRE_CODEX_BIN: codex,
        MARKER: marker,
      }),
    (error) => {
      assert.equal(error.code, "RUNTIME_FAILED");
      for (const secret of rawSecrets) assert.doesNotMatch(error.message, new RegExp(secret, "u"));
      assert.match(error.message, /CODEX_API_KEY=\*\*\*\*/u);
      assert.match(error.message, /Authorization: Basic \*\*\*\*/u);
      assert.match(error.message, /"Authorization":"Basic \*\*\*\*"/u);
      assert.match(error.message, /Bearer \*\*\*\*, next/u);
      assert.match(error.message, /\[REDACTED\]/u);
      assert.match(error.message, /\?api_key=\*\*\*\*/u);
      assert.match(error.message, /&token=\*\*\*\*/u);
      assert.match(error.message, /#password=\*\*\*\*/u);
      assert.match(error.message, /#token=capability-value-1234/u);
      return true;
    },
  );
  assert.equal(readFileSync(marker, "utf8"), "1");
});

test("plugin fails closed when Codex is not logged in", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-plugin-login-test-"));
  const runtime = join(root, "tripwire");
  const codex = join(root, "codex");
  writeFileSync(
    runtime,
    `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' 'prompt-tripwire 0.1.8'; fi
`,
    { mode: 0o700 },
  );
  writeFileSync(
    codex,
    `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' 'codex-cli 0.144.4'; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then exit 1; fi
exit 0
`,
    { mode: 0o700 },
  );
  assert.throws(
    () =>
      runPreflight(["status", "--run-id", "run-1"], {
        PROMPT_TRIPWIRE_BIN: runtime,
        PROMPT_TRIPWIRE_CODEX_BIN: codex,
      }),
    (error) => error.code === "CODEX_LOGIN_REQUIRED",
  );
});

test("plugin requires the exact Codex CLI version", () => {
  const root = mkdtempSync(join(tmpdir(), "prompt-tripwire-plugin-version-test-"));
  const runtime = join(root, "tripwire");
  const codex = join(root, "codex");
  writeFileSync(runtime, "#!/bin/sh\nprintf '%s\\n' 'prompt-tripwire 0.1.8'\n", {
    mode: 0o700,
  });
  writeFileSync(codex, "#!/bin/sh\nprintf '%s\\n' 'codex-cli 0.144.40'\n", { mode: 0o700 });
  assert.throws(
    () => assertRuntimeVersions(runtime, { PROMPT_TRIPWIRE_CODEX_BIN: codex }),
    (error) => error.code === "CODEX_VERSION_MISMATCH",
  );
});

test("plugin exposes only non-mutating adapter actions and terminal execution", () => {
  assert.deepEqual(buildRuntimeArgs({ action: "status", runId: "run-1" }), ["status", "run-1"]);
  assert.deepEqual(buildRuntimeArgs({ action: "report", runId: "run-1", format: "json" }), [
    "report",
    "run-1",
    "--format",
    "json",
  ]);
  assert.deepEqual(buildRuntimeArgs({ action: "run", contract: "contract-1" }), [
    "run",
    "--contract",
    "contract-1",
    "--terminal",
  ]);
});
