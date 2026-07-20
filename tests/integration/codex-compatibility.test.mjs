import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AppServerError,
  CodexAppServerClient,
  CodexCompatibilityVerifier,
  createMemoryTransportPair,
  validateGeneratedCompatibilitySchema,
} from "../../packages/codex-app-server/dist/index.js";
import { createRepositorySnapshot } from "../../packages/domain/dist/index.js";

function generateCurrentSchema(output) {
  const result = spawnSync("codex", ["app-server", "generate-json-schema", "--out", output], {
    cwd: tmpdir(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

async function writeFakeCodex(path, schemaSource, version = "9.9.9") {
  const source = `#!/usr/bin/env node
import { cpSync } from "node:fs";
import readline from "node:readline";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write(${JSON.stringify(`codex-cli ${version}\n`)});
  process.exit(0);
}
if (args[0] === "app-server" && args[1] === "generate-json-schema") {
  const out = args[args.indexOf("--out") + 1];
  cpSync(${JSON.stringify(schemaSource)}, out, { recursive: true });
  process.exit(0);
}
if (args[0] !== "app-server") process.exit(2);
let thread = 0;
let turn = 0;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return send({ id: message.id, result: {} });
  if (message.method === "model/list") return send({
    id: message.id,
    result: {
      data: [{
        id: "gpt-5.6-sol",
        model: "gpt-5.6-sol",
        isDefault: true,
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: [{ reasoningEffort: "low" }]
      }],
      nextCursor: null
    }
  });
  if (message.method === "thread/start") {
    thread += 1;
    return send({
      id: message.id,
      result: {
        thread: { id: "thread_fake_" + thread },
        model: message.params.model,
        reasoningEffort: "low"
      }
    });
  }
  if (message.method === "turn/start") {
    turn += 1;
    const turnId = "turn_fake_" + turn;
    const threadId = message.params.threadId;
    const prompt = message.params.input[0].text;
    const nonce = prompt.slice(prompt.lastIndexOf(" ") + 1);
    const item = {
      id: "item_fake_" + turn,
      type: "agentMessage",
      text: JSON.stringify({ nonce })
    };
    send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
    send({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress" } } });
    send({ method: "item/started", params: { threadId, turnId, item } });
    send({ method: "item/completed", params: { threadId, turnId, item } });
    send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
    return;
  }
  if (message.method === "turn/interrupt") return send({ id: message.id, result: {} });
  if (message.id !== undefined) send({ id: message.id, result: {} });
});
`;
  await writeFile(path, source, { mode: 0o700 });
}

test("an arbitrary Codex version passes when schema, handshake, and bounded canary are compatible", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-compatible-fake-"));
  const schema = join(root, "schema");
  const codex = join(root, "codex.mjs");
  try {
    generateCurrentSchema(schema);
    await writeFakeCodex(codex, schema, "9.9.9");
    const session = await new CodexCompatibilityVerifier({
      codexPath: codex,
      temporaryParent: root,
      canaryTimeoutMs: 5_000,
    }).open();
    try {
      assert.equal(session.attestation.codexVersion, "9.9.9");
      assert.equal(session.attestation.profileVersion, 1);
      assert.match(session.attestation.executableSha256, /^[a-f0-9]{64}$/u);
      assert.match(session.attestation.compatibilityFingerprint, /^[a-f0-9]{64}$/u);
    } finally {
      await session.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe additive schema stays compatible while a required method removal fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-tripwire-schema-profile-"));
  const baseline = join(root, "baseline");
  const additive = join(root, "additive");
  const incompatible = join(root, "incompatible");
  const completedIncompatible = join(root, "completed-incompatible");
  const notificationIncompatible = join(root, "notification-incompatible");
  try {
    generateCurrentSchema(baseline);
    await cp(baseline, additive, { recursive: true });
    await cp(baseline, incompatible, { recursive: true });
    await cp(baseline, completedIncompatible, { recursive: true });
    await cp(baseline, notificationIncompatible, { recursive: true });
    const threadStartPath = join(additive, "v2", "ThreadStartResponse.json");
    const threadStart = JSON.parse(await readFile(threadStartPath, "utf8"));
    threadStart.properties.futureOptional = { type: ["string", "null"] };
    await writeFile(threadStartPath, `${JSON.stringify(threadStart, null, 2)}\n`);
    for (const lifecycle of ["ItemStartedNotification.json", "ItemCompletedNotification.json"]) {
      const itemPath = join(additive, "v2", lifecycle);
      const itemSchema = JSON.parse(await readFile(itemPath, "utf8"));
      itemSchema.definitions.ThreadItem.oneOf.push({
        type: "object",
        required: ["id", "type"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["futureToolVariant"] },
          futureOptional: { type: ["string", "null"] },
        },
      });
      await writeFile(itemPath, `${JSON.stringify(itemSchema, null, 2)}\n`);
    }
    assert.equal(
      validateGeneratedCompatibilitySchema(additive).schemaFingerprint,
      validateGeneratedCompatibilitySchema(baseline).schemaFingerprint,
    );

    const requestsPath = join(incompatible, "ClientRequest.json");
    const requests = JSON.parse(await readFile(requestsPath, "utf8"));
    requests.oneOf = requests.oneOf.filter(
      (entry) => entry.properties?.method?.enum?.[0] !== "model/list",
    );
    await writeFile(requestsPath, `${JSON.stringify(requests, null, 2)}\n`);
    assert.throws(
      () => validateGeneratedCompatibilitySchema(incompatible),
      (error) => error instanceof AppServerError && error.code === "CODEX_COMPATIBILITY_FAILED",
    );

    const completedPath = join(completedIncompatible, "v2", "ItemCompletedNotification.json");
    const completed = JSON.parse(await readFile(completedPath, "utf8"));
    const completedAgentMessage = completed.definitions.ThreadItem.oneOf.find(
      (entry) => entry.properties?.type?.enum?.[0] === "agentMessage",
    );
    completedAgentMessage.required = completedAgentMessage.required.filter(
      (field) => field !== "text",
    );
    await writeFile(completedPath, `${JSON.stringify(completed, null, 2)}\n`);
    assert.throws(
      () => validateGeneratedCompatibilitySchema(completedIncompatible),
      (error) => error instanceof AppServerError && error.code === "CODEX_COMPATIBILITY_FAILED",
    );

    const clientNotificationPath = join(notificationIncompatible, "ClientNotification.json");
    const clientNotification = JSON.parse(await readFile(clientNotificationPath, "utf8"));
    clientNotification.oneOf = [];
    await writeFile(clientNotificationPath, `${JSON.stringify(clientNotification, null, 2)}\n`);
    assert.throws(
      () => validateGeneratedCompatibilitySchema(notificationIncompatible),
      (error) => error instanceof AppServerError && error.code === "CODEX_COMPATIBILITY_FAILED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unknown App Server request is rejected and interrupts the protocol", async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  serverTransport.onMessage((message) => {
    if (message?.method === "initialize") {
      serverTransport.send({ id: message.id, result: {} });
    }
  });
  const client = new CodexAppServerClient(clientTransport);
  await client.initialize();
  serverTransport.send({ id: 99, method: "future/unsafe/request", params: {} });
  await assert.rejects(
    client.listModels(),
    (error) => error instanceof AppServerError && error.code === "UNSUPPORTED_APP_SERVER_REQUEST",
  );
  await client.close();
});

test("bounded canary fails closed when nonce semantics change", async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  let threadId = "thread_canary";
  serverTransport.onMessage((message) => {
    if (message?.method === "initialize") {
      serverTransport.send({ id: message.id, result: {} });
    } else if (message?.method === "thread/start") {
      serverTransport.send({
        id: message.id,
        result: { thread: { id: threadId }, model: message.params.model, reasoningEffort: "low" },
      });
    } else if (message?.method === "turn/start") {
      const turnId = "turn_canary";
      serverTransport.send({ id: message.id, result: { turn: { id: turnId } } });
      queueMicrotask(() => {
        serverTransport.send({
          method: "turn/started",
          params: { threadId, turn: { id: turnId, status: "inProgress" } },
        });
        const item = {
          id: "agent_canary",
          type: "agentMessage",
          text: JSON.stringify({ nonce: "changed" }),
        };
        serverTransport.send({ method: "item/started", params: { threadId, turnId, item } });
        serverTransport.send({ method: "item/completed", params: { threadId, turnId, item } });
        serverTransport.send({
          method: "turn/completed",
          params: { threadId, turn: { id: turnId, status: "completed" } },
        });
      });
    } else if (message?.method === "turn/interrupt") {
      serverTransport.send({ id: message.id, result: {} });
    }
  });
  const client = new CodexAppServerClient(clientTransport);
  await client.initialize();
  await assert.rejects(
    client.runCompatibilityCanary({
      cwd: tmpdir(),
      model: "gpt-5.6-sol",
      reasoningEffort: "low",
      nonce: "expected",
      timeoutMs: 1_000,
    }),
    (error) => error instanceof AppServerError && error.code === "CODEX_COMPATIBILITY_FAILED",
  );
  await client.close();
});

test("an additive ThreadItem enum is allowed in schema but denied if it actually arrives", async () => {
  const [clientTransport, serverTransport] = createMemoryTransportPair();
  let interruptObserved = false;
  serverTransport.onMessage((message) => {
    if (message?.method === "initialize") {
      serverTransport.send({ id: message.id, result: {} });
    } else if (message?.method === "thread/start") {
      serverTransport.send({
        id: message.id,
        result: {
          thread: { id: "thread_unknown_enum" },
          model: message.params.model,
          reasoningEffort: "low",
        },
      });
    } else if (message?.method === "turn/start") {
      const threadId = message.params.threadId;
      const turnId = "turn_unknown_enum";
      serverTransport.send({ id: message.id, result: { turn: { id: turnId } } });
      queueMicrotask(() => {
        serverTransport.send({
          method: "turn/started",
          params: { threadId, turn: { id: turnId, status: "inProgress" } },
        });
        serverTransport.send({
          method: "item/started",
          params: {
            threadId,
            turnId,
            item: { id: "future_item", type: "futureToolVariant" },
          },
        });
      });
    } else if (message?.method === "turn/interrupt") {
      interruptObserved = true;
      serverTransport.send({ id: message.id, result: {} });
    }
  });
  const client = new CodexAppServerClient(clientTransport);
  await client.initialize();
  const snapshot = createRepositorySnapshot({
    repositoryPath: tmpdir(),
    commitSha: "1".repeat(40),
    branch: "main",
    submodules: {},
    dirtyPatchHash: null,
    instructionHash: "a".repeat(64),
    configHash: "b".repeat(64),
    task: "Plan without changing files",
    model: { id: "gpt-5.6-sol", reasoningEffort: "low" },
    codexVersion: "9.9.9",
    promptTripwireVersion: "0.1.11",
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  await assert.rejects(
    client.runPlanProbe({
      probeId: "probe_unknown_enum",
      cwd: tmpdir(),
      snapshot,
      model: snapshot.model.id,
      reasoningEffort: snapshot.model.reasoningEffort,
      timeoutMs: 1_000,
    }),
    (error) => error instanceof AppServerError && error.code === "PROBE_CONTAINMENT_VIOLATION",
  );
  assert.equal(interruptObserved, true);
  await client.close();
});
