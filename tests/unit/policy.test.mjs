import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  containsSecretLikeText,
  createDecisionRound,
  denyPermissionExpansion,
  evaluateDeterministicPolicy,
  matchCommandRequest,
  matchNamedAction,
  matchNetworkRequest,
  matchPathRequest,
  matchesRepositoryPath,
  normalizeRepositoryRelativePath,
  redactText,
  sanitizeForExport,
} from "../../packages/policy/dist/index.js";

function plan(overrides = {}) {
  return {
    probeId: "probe_1",
    summary: "Implement a local validation helper",
    assumptions: [],
    intendedBehavior: ["Validate input locally"],
    filesToChange: ["src/validator.ts"],
    components: ["validator"],
    dataChanges: [],
    publicApiChanges: [],
    dependencyChanges: [],
    commands: ["npm run test:unit"],
    externalEffects: [],
    permissionChanges: [],
    compatibilityImpacts: [],
    reversibility: "reversible",
    unknowns: [],
    ...overrides,
  };
}

test("AC-004: unanimous model output cannot remove deterministic blockers", () => {
  const risky = plan({
    externalEffects: ["deploy to production", "apply database migration", "git push remote write"],
    permissionChanges: ["rotate secret token and expand permission"],
  });
  const blockers = evaluateDeterministicPolicy({
    plans: [risky, { ...risky, probeId: "probe_2" }, { ...risky, probeId: "probe_3" }],
    modelConsensusSafe: true,
  });
  const triggers = new Set(blockers.map((blocker) => blocker.trigger));
  for (const trigger of [
    "deploy_release_publish",
    "production",
    "migration",
    "remote_write",
    "secret",
    "permission",
  ]) {
    assert.equal(triggers.has(trigger), true, `missing ${trigger}`);
  }
  assert.equal(createDecisionRound(blockers).executionAllowed, false);
});

test("safe equivalent plans create no deterministic blocker", () => {
  const safe = plan();
  const blockers = evaluateDeterministicPolicy({
    plans: [safe, { ...safe, probeId: "probe_2" }, { ...safe, probeId: "probe_3" }],
  });
  assert.deepEqual(blockers, []);
  assert.equal(createDecisionRound(blockers).executionAllowed, true);
  assert.equal(
    createDecisionRound(evaluateDeterministicPolicy({ plans: [] })).executionAllowed,
    false,
  );
});

test("AC-004 spec fixture: dependency addition requires an explicit decision", () => {
  const blockers = evaluateDeterministicPolicy({
    plans: [plan({ dependencyChanges: ["add dependency zod"] })],
  });
  assert.ok(blockers.some((blocker) => blocker.trigger === "dependency"));
  assert.equal(createDecisionRound(blockers).executionAllowed, false);
});

test("AC-004 spec fixture: network or deploy command cannot auto-approve", () => {
  const blockers = evaluateDeterministicPolicy({
    plans: [
      plan({
        commands: ["curl https://example.invalid", "vercel deploy --prod"],
        externalEffects: ["deploy to production"],
      }),
    ],
  });
  const triggers = new Set(blockers.map((blocker) => blocker.trigger));
  assert.equal(triggers.has("network"), true);
  assert.equal(triggers.has("deploy_release_publish"), true);
  assert.equal(createDecisionRound(blockers).executionAllowed, false);
});

test("AC-006: decision rounds show three blockers, a remaining count, and stay blocked", () => {
  const blockers = evaluateDeterministicPolicy({
    plans: [
      plan({
        dataChanges: ["delete persistent records", "apply migration"],
        dependencyChanges: ["add dependency"],
        externalEffects: ["network write", "publish release"],
      }),
    ],
  });
  assert.ok(blockers.length >= 5);
  const firstRound = createDecisionRound(blockers);
  assert.equal(firstRound.blockers.length, 3);
  assert.equal(firstRound.remainingCount, blockers.length - 3);
  assert.equal(firstRound.unresolvedCount, blockers.length);
  assert.equal(firstRound.executionAllowed, false);

  const allButOne = new Set(blockers.slice(0, -1).map((blocker) => blocker.blockerId));
  const finalRound = createDecisionRound(blockers, allButOne);
  assert.equal(finalRound.blockers.length, 1);
  assert.equal(finalRound.executionAllowed, false);
  assert.equal(
    createDecisionRound(blockers, new Set(blockers.map((blocker) => blocker.blockerId)))
      .executionAllowed,
    true,
  );
});

test("repository-relative POSIX path matching fails closed", () => {
  assert.deepEqual(normalizeRepositoryRelativePath("src//./feature.ts"), {
    ok: true,
    path: "src/feature.ts",
  });
  assert.equal(matchesRepositoryPath("src/nested/feature.ts", "src/**"), true);
  assert.equal(matchesRepositoryPath(".env", "**/.env"), true);

  const contract = { allowedPaths: ["src/**", ".env"], protectedPaths: ["src/protected/**"] };
  assert.equal(
    matchPathRequest(
      { requestedPath: "src/feature.ts", resolvedPath: "src/feature.ts", caseAmbiguous: false },
      contract,
    ).outcome,
    "allow",
  );
  const rejected = [
    { requestedPath: "/tmp/feature.ts", resolvedPath: "src/feature.ts", caseAmbiguous: false },
    { requestedPath: "../feature.ts", resolvedPath: "src/feature.ts", caseAmbiguous: false },
    { requestedPath: "src/Feature.ts", resolvedPath: "src/Feature.ts", caseAmbiguous: true },
    { requestedPath: "src/link", resolvedPath: "../outside", caseAmbiguous: false },
    { requestedPath: "src/link", resolvedPath: null, caseAmbiguous: false },
    {
      requestedPath: "src/protected/file.ts",
      resolvedPath: "src/protected/file.ts",
      caseAmbiguous: false,
    },
    { requestedPath: ".env", resolvedPath: ".env", caseAmbiguous: false },
    { requestedPath: "src/link", resolvedPath: ".ssh/id_ed25519", caseAmbiguous: false },
    { requestedPath: "other/file.ts", resolvedPath: "other/file.ts", caseAmbiguous: false },
  ];
  for (const request of rejected) {
    assert.equal(matchPathRequest(request, contract).outcome, "deny");
  }
});

test("unknown, raw, denied, or partially approved compound commands are denied", () => {
  const allowReadAndTest = {
    allowedCommandClasses: ["static_read", "test"],
    deniedCommandClasses: ["network"],
  };
  assert.equal(
    matchCommandRequest(
      { source: "structured", actions: [{ program: "rg", args: ["needle", "src"] }] },
      allowReadAndTest,
    ).outcome,
    "allow",
  );
  assert.equal(
    matchCommandRequest(
      {
        source: "structured",
        actions: [{ program: "sed", args: ["-n", "1,20p", "src/file.ts"] }],
      },
      allowReadAndTest,
    ).outcome,
    "allow",
  );
  const rejected = [
    { source: "raw", actions: [{ program: "rg", args: ["needle"] }] },
    { source: "structured", actions: [{ program: "mystery-tool", args: [] }] },
    { source: "structured", actions: [{ program: "sh", args: ["-c", "npm test"] }] },
    { source: "structured", actions: [{ program: "./rg", args: ["needle", "src"] }] },
    { source: "structured", actions: [{ program: "rg", args: ["--pre=cat", "needle"] }] },
    {
      source: "structured",
      actions: [{ program: "find", args: ["src", "-exec", "touch", "file", "+"] }],
    },
    {
      source: "structured",
      actions: [
        { program: "rg", args: ["needle", "src"] },
        { program: "curl", args: ["https://example.com"] },
      ],
    },
  ];
  for (const request of rejected) {
    assert.equal(matchCommandRequest(request, allowReadAndTest).outcome, "deny");
  }
  for (const action of [
    { program: "sed", args: ["-i", "s/a/b/", "src/file.ts"] },
    { program: "find", args: ["src", "-delete"] },
    { program: "sort", args: ["input", "-o", "output"] },
  ]) {
    assert.equal(
      matchCommandRequest({ source: "structured", actions: [action] }, allowReadAndTest).outcome,
      "deny",
    );
  }
  const readOnlyNetwork = {
    allowedCommandClasses: ["network"],
    deniedCommandClasses: ["remote_write"],
  };
  for (const action of [
    { program: "gh", args: ["api", "repos/example", "-f", "state=closed"] },
    { program: "gh", args: ["api", "repos/example", "-XPOST"] },
    { program: "curl", args: ["-X", "POST", "https://example.com"] },
    { program: "wget", args: ["--post-data=value", "https://example.com"] },
    { program: "ssh", args: ["example.com", "touch", "file"] },
  ]) {
    assert.equal(
      matchCommandRequest({ source: "structured", actions: [action] }, readOnlyNetwork).outcome,
      "deny",
    );
  }
});

test("AC-011: network, named external actions, and permission expansion use exact allowlists", () => {
  const networkPolicy = {
    mode: "allowlist",
    hosts: ["api.openai.com"],
    actions: ["read"],
  };
  assert.equal(
    matchNetworkRequest({ host: "API.OPENAI.COM.", action: "read" }, networkPolicy).outcome,
    "allow",
  );
  for (const request of [
    { host: "api.openai.com", action: "write" },
    { host: "example.com", action: "read" },
    { host: "*.openai.com", action: "read" },
    { host: "api.openai.com", action: "unknown" },
  ]) {
    assert.equal(matchNetworkRequest(request, networkPolicy).outcome, "deny");
  }
  assert.equal(
    matchNetworkRequest(
      { host: "api.openai.com", action: "read" },
      { mode: "allowlist", hosts: ["*.openai.com"], actions: ["read"] },
    ).outcome,
    "deny",
  );
  assert.equal(
    matchNamedAction("github:issue:read", {
      mode: "allowlist",
      allowed: ["github:issue:read"],
    }).outcome,
    "allow",
  );
  assert.equal(
    matchNamedAction("github:issue:write", {
      mode: "allowlist",
      allowed: ["github:issue:read"],
    }).outcome,
    "deny",
  );
  assert.equal(denyPermissionExpansion().outcome, "deny");
});

test("AC-014: secret fixture values and raw reasoning never pass log or export gates", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("../../fixtures/security/secret-redaction.json", import.meta.url), "utf8"),
  );
  const log = [
    `secret=${fixture.knownSecret}`,
    `authorization=${fixture.authorization}`,
    `path=${fixture.secretPath}`,
    fixture.privateKey,
    ["-----BEGIN", "PRIVATE KEY-----\nsynthetic-material\n-----END", "PRIVATE KEY-----"].join(" "),
  ].join("\n");
  const knownSecrets = [fixture.knownSecret, fixture.privateKey];
  const redacted = redactText(log, { knownSecrets });
  assert.ok(redacted.redactionCount >= 5);
  assert.equal(containsSecretLikeText(redacted.text, { knownSecrets }), false);
  for (const value of Object.values(fixture)) assert.equal(redacted.text.includes(value), false);

  const policyBlockers = evaluateDeterministicPolicy({
    plans: [plan({ unknowns: [`Unclassified value ${fixture.knownSecret}`] })],
    knownSecrets,
  });
  assert.equal(
    policyBlockers.some((blocker) => blocker.description.includes(fixture.knownSecret)),
    false,
  );

  const exported = sanitizeForExport(
    {
      message: log,
      rawReasoning: `hidden ${fixture.knownSecret}`,
      processEnv: { OPENAI_API_KEY: fixture.knownSecret },
      nested: { accessToken: fixture.knownSecret },
    },
    { knownSecrets },
  );
  assert.equal(exported.allowed, true);
  if (!exported.allowed) return;
  assert.ok(exported.redactionCount >= 7);
  for (const value of Object.values(fixture)) assert.equal(exported.json.includes(value), false);
  assert.equal(exported.json.includes("hidden"), false);

  const cyclic = {};
  cyclic.self = cyclic;
  assert.deepEqual(sanitizeForExport(cyclic), {
    allowed: false,
    reason: "unsupported_value",
  });
});
