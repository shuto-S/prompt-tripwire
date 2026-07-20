import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import test from "node:test";

import { LocalController } from "../../apps/controller/dist/index.js";
import { startReviewServer } from "../../apps/ui/dist/index.js";
import { createContractPreview } from "../../packages/openai-comparator/dist/index.js";
import { SqlitePersistence } from "../../packages/persistence/dist/index.js";
import { createReviewFixture, createStateFixture } from "../helpers/review-fixture.mjs";

function apiHeaders(server, extras = {}) {
  return { Authorization: `Bearer ${server.capabilityToken}`, ...extras };
}

function mutationHeaders(server, key, origin = server.origin) {
  return apiHeaders(server, {
    Origin: origin,
    "Content-Type": "application/json",
    "Idempotency-Key": key,
  });
}

function openIncompleteJsonPost(url, headers, body) {
  let request;
  const settled = new Promise((resolve) => {
    request = httpRequest(
      new URL(url),
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve({ kind: "response", status: response.statusCode }));
        response.on("aborted", () => resolve({ kind: "aborted" }));
      },
    );
    request.on("error", () => resolve({ kind: "error" }));
    request.on("close", () => resolve({ kind: "closed" }));
    request.write(body.slice(0, Math.max(1, Math.floor(body.length / 2))));
  });
  return { request, settled };
}

test("AC-003/006/017: Decision Inbox API is bounded, authenticated, and fail-closed", async () => {
  const fixture = await createReviewFixture({ decisionCount: 5, runId: "run_ui_security" });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
    closeGraceMs: 5_000,
  });
  try {
    const page = await fetch(server.url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/u);
    assert.equal(page.headers.get("access-control-allow-origin"), null);

    const endpoint = `${server.origin}/api/runs/${fixture.run.runId}`;
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal(
      (await fetch(endpoint, { headers: { Authorization: "Bearer invalid" } })).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${server.origin}/api/runs/a-different-run`, {
          headers: apiHeaders(server),
        })
      ).status,
      404,
    );

    const response = await fetch(endpoint, { headers: apiHeaders(server) });
    assert.equal(response.status, 200);
    const review = await response.json();
    assert.equal(review.decisions.length, 3);
    assert.equal(review.remainingDecisionCount, 2);
    assert.ok(review.decisions.every((item) => item.defaultOptionId === null));
    assert.ok(review.decisions[0].options[0].effects.length > 0);
    assert.ok(review.decisions[0].options[0].supportedByProbeIds.length > 0);
    assert.ok(review.decisions[0].evidenceRefs.length > 0);
    assert.doesNotMatch(JSON.stringify(review), /FULL PLAN SHOULD NOT LEAK/u);
    const evidence = await fetch(`${endpoint}/evidence`, { headers: apiHeaders(server) });
    assert.equal(evidence.status, 200);
    assert.match(JSON.stringify(await evidence.json()), /FULL PLAN SHOULD NOT LEAK/u);

    const decision = review.decisions[0];
    const decisionEndpoint = `${server.origin}/api/runs/${fixture.run.runId}/decisions/${decision.decisionId}`;
    const body = JSON.stringify({
      action: "select",
      selectedOptionId: decision.options[0].id,
      expectedVersion: review.version,
    });
    assert.equal(
      (
        await fetch(decisionEndpoint, {
          method: "POST",
          headers: mutationHeaders(server, "cross-origin", "https://attacker.example"),
          body,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(decisionEndpoint, {
          method: "POST",
          headers: apiHeaders(server, {
            "Content-Type": "application/json",
            "Idempotency-Key": "missing-origin",
          }),
          body,
        })
      ).status,
      403,
    );
    const accepted = await fetch(decisionEndpoint, {
      method: "POST",
      headers: mutationHeaders(server, "accept-decision"),
      body,
    });
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json();
    assert.equal(acceptedBody.version, review.version + 1);
    const replayed = await fetch(decisionEndpoint, {
      method: "POST",
      headers: mutationHeaders(server, "accept-decision"),
      body,
    });
    assert.equal(replayed.status, 200);
    assert.deepEqual(await replayed.json(), acceptedBody);

    const streamResponse = await fetch(`${server.origin}/api/runs/${fixture.run.runId}/events`, {
      headers: apiHeaders(server),
    });
    assert.equal(streamResponse.status, 200);
    const reader = streamResponse.body.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /event: run/u);
    await reader.cancel();

    assert.equal(new URL(server.url).search, "");
    assert.match(new URL(server.url).hash, /^#token=/u);

    const afterDecision = await (await fetch(endpoint, { headers: apiHeaders(server) })).json();
    const cancelBody = JSON.stringify({ expectedVersion: afterDecision.version });
    const cancelled = await fetch(`${endpoint}/cancel`, {
      method: "POST",
      headers: mutationHeaders(server, "cancel-security-run"),
      body: cancelBody,
    });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).state, "cancelled");
    const replayedCancel = await fetch(`${endpoint}/cancel`, {
      method: "POST",
      headers: mutationHeaders(server, "cancel-security-run"),
      body: cancelBody,
    });
    assert.equal(replayedCancel.status, 410);
    assert.deepEqual(await replayedCancel.json(), { code: "CAPABILITY_REVOKED" });
  } finally {
    await server.close();
    await fixture.close();
  }
});

test("Japanese reference translations are returned separately from authoritative review text", async () => {
  const fixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_japanese_presentation",
    presentationStatus: "available",
  });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
  });
  try {
    const endpoint = `${server.origin}/api/runs/${fixture.run.runId}`;
    const review = await (await fetch(endpoint, { headers: apiHeaders(server) })).json();
    assert.equal(review.presentation.status, "available");
    assert.equal(review.presentation.locale, "ja");
    assert.match(review.presentation.task, /永続レコード/u);
    assert.equal(review.presentation.decisions[0].decisionId, review.decisions[0].decisionId);
    assert.equal(
      review.presentation.decisions[0].options[0].optionId,
      review.decisions[0].options[0].id,
    );
    assert.match(review.presentation.decisions[0].options[0].effects[0], /選択肢1の影響1/u);
    assert.match(review.snapshot.task, /^Implement /u);
    assert.match(review.decisions[0].question, /^How /u);

    const before = fixture.store.getRun(fixture.run.runId).run;
    const contractBefore = fixture.controller.review(fixture.run.runId).contract;
    assert.equal(contractBefore, null);
    assert.deepEqual(fixture.store.getRun(fixture.run.runId).run, before);
  } finally {
    await server.close();
    await fixture.close();
  }
});

test("browser review source is sanitized without changing canonical persistence", async () => {
  const secret = "synthetic-secret-value";
  const task = `日本語 task with English context api_key=${secret}`;
  const fixture = await createReviewFixture({
    runId: "run_ui_sanitized_source",
    task,
    presentationStatus: "available",
    transformDecision: (decision) => ({
      ...decision,
      question: `${decision.question} api_key=${secret}`,
      options: decision.options.map((option, index) => ({
        ...option,
        effects: index === 0 ? [...option.effects, `api_key=${secret}`] : option.effects,
      })),
    }),
  });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
  });
  try {
    const canonicalBefore = fixture.controller.review(fixture.run.runId);
    const endpoint = `${server.origin}/api/runs/${fixture.run.runId}`;
    const responseText = await (await fetch(endpoint, { headers: apiHeaders(server) })).text();
    const review = JSON.parse(responseText);
    assert.equal(responseText.includes(secret), false);
    assert.match(review.snapshot.task, /\[REDACTED\]/u);
    assert.match(review.decisions[0].question, /\[REDACTED\]/u);
    assert.match(review.decisions[0].options[0].effects.at(-1), /\[REDACTED\]/u);

    const canonicalAfter = fixture.controller.review(fixture.run.runId);
    assert.deepEqual(canonicalAfter, canonicalBefore);
    assert.equal(canonicalAfter.snapshot.task, task);
    assert.equal(canonicalAfter.decisions[0].question.includes(secret), false);
    assert.match(canonicalAfter.decisions[0].question, /\[REDACTED\]/u);
    assert.equal(canonicalAfter.run.state, "needs_review");
  } finally {
    await server.close();
    await fixture.close();
  }
});

test("an unavailable translation exposes only fallback status, not internal failure details", async () => {
  const fixture = await createReviewFixture({
    runId: "run_ui_unavailable_presentation",
    presentationStatus: "unavailable",
  });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
  });
  try {
    const endpoint = `${server.origin}/api/runs/${fixture.run.runId}`;
    const review = await (await fetch(endpoint, { headers: apiHeaders(server) })).json();
    assert.deepEqual(review.presentation.decisions, []);
    assert.equal(review.presentation.task, null);
    assert.equal(review.presentation.status, "unavailable");
    assert.equal("errorCode" in review.presentation, false);
    assert.equal("model" in review.presentation, false);
  } finally {
    await server.close();
    await fixture.close();
  }
});

test("presentation translations do not change decision or contract identity", async () => {
  const runId = "run_presentation_contract_identity";
  const sourceOnly = await createReviewFixture({ runId });
  const localized = await createReviewFixture({
    runId,
    presentationStatus: "available",
  });
  try {
    const choose = (fixture) =>
      fixture.controller.decide({
        runId,
        decisionId: fixture.decisions[0].decisionId,
        selectedOptionId: fixture.decisions[0].options[0].id,
        freeformOverride: null,
        expectedVersion: fixture.run.version,
        idempotencyKey: "same-human-decision",
      });
    const sourceRun = choose(sourceOnly);
    const localizedRun = choose(localized);
    const sourceContract = sourceOnly.store.getContract(sourceRun.activeContractId);
    const localizedContract = localized.store.getContract(localizedRun.activeContractId);
    assert.equal(localizedContract.contractId, sourceContract.contractId);
    assert.equal(localizedContract.contentHash, sourceContract.contentHash);
    assert.deepEqual(localizedContract, sourceContract);
  } finally {
    await sourceOnly.close();
    await localized.close();
  }
});

test("contract decisions can be edited before explicit approval", async () => {
  const fixture = await createReviewFixture({ decisionCount: 1, runId: "run_ui_contract" });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
    closeGraceMs: 5,
  });
  const endpoint = `${server.origin}/api/runs/${fixture.run.runId}`;
  try {
    let review = await (await fetch(endpoint, { headers: apiHeaders(server) })).json();
    const decision = review.decisions[0];
    let response = await fetch(`${endpoint}/decisions/${decision.decisionId}`, {
      method: "POST",
      headers: mutationHeaders(server, "first-choice"),
      body: JSON.stringify({
        action: "select",
        selectedOptionId: decision.options[0].id,
        expectedVersion: review.version,
      }),
    });
    assert.equal(response.status, 200);
    review = await (await fetch(endpoint, { headers: apiHeaders(server) })).json();
    assert.equal(review.state, "ready_for_approval");
    assert.notEqual(review.contract, null);

    response = await fetch(`${endpoint}/contracts/reopen`, {
      method: "POST",
      headers: mutationHeaders(server, "edit-before-approval"),
      body: JSON.stringify({ expectedVersion: review.version }),
    });
    assert.equal(response.status, 200);
    const reopenedBody = await response.json();
    const replayedReopen = await fetch(`${endpoint}/contracts/reopen`, {
      method: "POST",
      headers: mutationHeaders(server, "edit-before-approval"),
      body: JSON.stringify({ expectedVersion: review.version }),
    });
    assert.equal(replayedReopen.status, 200);
    assert.deepEqual(await replayedReopen.json(), reopenedBody);
    review = await (await fetch(endpoint, { headers: apiHeaders(server) })).json();
    assert.equal(review.state, "needs_review");
    assert.equal(review.contract, null);
    assert.equal(review.decisions.length, 1);

    const revised = review.decisions[0];
    response = await fetch(`${endpoint}/decisions/${revised.decisionId}`, {
      method: "POST",
      headers: mutationHeaders(server, "revised-choice"),
      body: JSON.stringify({
        action: "select",
        selectedOptionId: revised.options[1].id,
        expectedVersion: review.version,
      }),
    });
    assert.equal(response.status, 200);
    review = await (await fetch(endpoint, { headers: apiHeaders(server) })).json();
    response = await fetch(`${endpoint}/contracts/approve`, {
      method: "POST",
      headers: mutationHeaders(server, "explicit-approval"),
      body: JSON.stringify({
        contractId: review.contract.contractId,
        expectedVersion: review.version,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, "approved");
    assert.deepEqual(await server.closed, { reason: "terminal_state" });
  } finally {
    await server.close();
    await fixture.close();
  }
});

test("review capability closes on idle, archive, and repeated close", async () => {
  const idleFixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_idle_lifecycle",
  });
  const idleServer = await startReviewServer({
    controller: idleFixture.controller,
    runId: idleFixture.run.runId,
    idleTimeoutMs: 20,
    lifecyclePollMs: 5,
    closeGraceMs: 5,
  });
  try {
    const result = await Promise.race([
      idleServer.closed,
      delay(1_000).then(() => {
        throw new Error("idle review server did not close");
      }),
    ]);
    assert.deepEqual(result, { reason: "idle_timeout" });
    await idleServer.close();
    await idleServer.close();
  } finally {
    await idleFixture.close();
  }

  const archivedFixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_archive_lifecycle",
  });
  const archivedServer = await startReviewServer({
    controller: archivedFixture.controller,
    runId: archivedFixture.run.runId,
    lifecyclePollMs: 5,
    closeGraceMs: 5,
  });
  try {
    archivedFixture.controller.archive(archivedFixture.run.runId);
    assert.deepEqual(await archivedServer.closed, { reason: "archived" });
  } finally {
    await archivedServer.close();
    await archivedFixture.close();
  }

  const initiallyArchivedFixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_initially_archived_lifecycle",
  });
  initiallyArchivedFixture.controller.archive(initiallyArchivedFixture.run.runId);
  try {
    await assert.rejects(
      startReviewServer({
        controller: initiallyArchivedFixture.controller,
        runId: initiallyArchivedFixture.run.runId,
        lifecyclePollMs: 5,
        closeGraceMs: 5,
      }),
      (error) => error?.code === "RUN_ARCHIVED",
    );
  } finally {
    await initiallyArchivedFixture.close();
  }

  const initiallyTerminalFixture = await createStateFixture(
    "completed",
    "run_ui_initially_terminal_lifecycle",
  );
  try {
    await assert.rejects(
      startReviewServer({
        controller: initiallyTerminalFixture.controller,
        runId: "run_ui_initially_terminal_lifecycle",
        lifecyclePollMs: 5,
        closeGraceMs: 5,
      }),
      (error) => error?.code === "RUN_NOT_REVIEWABLE",
    );
  } finally {
    await initiallyTerminalFixture.close();
  }
});

test("only the latest live Decision Inbox capability remains usable across SQLite connections", async () => {
  const fixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_single_live_capability",
  });
  const before = fixture.controller.status(fixture.run.runId);
  const firstServer = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
    lifecyclePollMs: 10,
    closeGraceMs: 5,
  });
  const secondStore = new SqlitePersistence({
    databasePath: fixture.store.databasePath,
    artifactRoot: join(fixture.root, "second-process-artifacts"),
  });
  const secondController = new LocalController({ store: secondStore });
  secondController.start();
  let secondServer;
  try {
    secondServer = await startReviewServer({
      controller: secondController,
      runId: fixture.run.runId,
      lifecyclePollMs: 10,
      closeGraceMs: 5,
    });

    const firstEndpoint = `${firstServer.origin}/api/runs/${fixture.run.runId}`;
    let firstStatus = null;
    try {
      firstStatus = (await fetch(firstEndpoint, { headers: apiHeaders(firstServer) })).status;
    } catch {
      // A listener that has already observed the new generation may refuse the connection.
    }
    assert.ok(firstStatus === null || firstStatus === 410);
    assert.deepEqual(await firstServer.closed, { reason: "superseded" });

    const secondEndpoint = `${secondServer.origin}/api/runs/${fixture.run.runId}`;
    assert.equal((await fetch(secondEndpoint, { headers: apiHeaders(secondServer) })).status, 200);
    assert.deepEqual(secondController.status(fixture.run.runId), before);
  } finally {
    await firstServer.close();
    await secondServer?.close();
    await secondController.stop();
    await fixture.close();
  }
});

test("final review decisions commit atomically when another process supersedes the capability", async (t) => {
  for (const scenario of [
    { name: "ready contract", runId: "run_ui_atomic_ready_race", cancellation: false },
    { name: "cancelled run", runId: "run_ui_atomic_cancel_race", cancellation: true },
  ]) {
    await t.test(scenario.name, async () => {
      const fixture = await createReviewFixture({
        decisionCount: 1,
        runId: scenario.runId,
        includeCancellationOption: scenario.cancellation,
      });
      const before = fixture.controller.review(fixture.run.runId);
      const firstServer = await startReviewServer({
        controller: fixture.controller,
        runId: fixture.run.runId,
        lifecyclePollMs: 5_000,
        closeGraceMs: 5,
      });
      const secondStore = new SqlitePersistence({
        databasePath: fixture.store.databasePath,
        artifactRoot: join(fixture.root, "artifacts"),
      });
      const secondController = new LocalController({ store: secondStore });
      secondController.start();
      const originalRecord = fixture.store.recordHumanDecisionOutcome.bind(fixture.store);
      let secondServer;
      let superseded = false;
      try {
        fixture.store.recordHumanDecisionOutcome = (input, createContract) => {
          if (!superseded) {
            superseded = true;
            secondController.claimReviewCapability(input.runId);
          }
          return originalRecord(input, createContract);
        };
        const selectedOption = scenario.cancellation
          ? fixture.decisions[0].options.find((option) => option.id.endsWith("_cancel"))
          : fixture.decisions[0].options[0];
        assert.notEqual(selectedOption, undefined);
        const body = JSON.stringify({
          action: "select",
          selectedOptionId: selectedOption.id,
          expectedVersion: fixture.run.version,
        });
        const endpoint = `${firstServer.origin}/api/runs/${fixture.run.runId}/decisions/${fixture.decisions[0].decisionId}`;
        const idempotencyKey = `atomic-final-${scenario.runId}`;
        const rejected = await fetch(endpoint, {
          method: "POST",
          headers: mutationHeaders(firstServer, idempotencyKey),
          body,
        });
        assert.equal(rejected.status, 410);
        assert.equal((await rejected.json()).code, "CAPABILITY_REVOKED");
        assert.deepEqual(await firstServer.closed, { reason: "superseded" });
        fixture.store.recordHumanDecisionOutcome = originalRecord;

        const unchanged = secondController.review(fixture.run.runId);
        assert.deepEqual(unchanged, before);
        assert.equal(secondStore.nextContractVersion(fixture.run.runId), 1);

        secondServer = await startReviewServer({
          controller: secondController,
          runId: fixture.run.runId,
          lifecyclePollMs: 5_000,
          closeGraceMs: 5,
        });
        const accepted = await fetch(
          `${secondServer.origin}/api/runs/${fixture.run.runId}/decisions/${fixture.decisions[0].decisionId}`,
          {
            method: "POST",
            headers: mutationHeaders(secondServer, idempotencyKey),
            body,
          },
        );
        assert.equal(accepted.status, 200);
        const acceptedBody = await accepted.json();
        assert.equal(
          acceptedBody.state,
          scenario.cancellation ? "cancelled" : "ready_for_approval",
        );
        assert.equal(acceptedBody.version, fixture.run.version + 2);

        const completed = secondController.review(fixture.run.runId);
        assert.equal(completed.decisions[0].status, "resolved");
        assert.equal(completed.humanDecisions.length, 1);
        assert.equal(completed.contract === null, scenario.cancellation);
        const replayed = secondController.decide({
          runId: fixture.run.runId,
          decisionId: fixture.decisions[0].decisionId,
          selectedOptionId: selectedOption.id,
          freeformOverride: null,
          expectedVersion: fixture.run.version,
          idempotencyKey,
          requireUnpinned: true,
        });
        assert.equal(replayed.state, acceptedBody.state);
        assert.equal(replayed.version, acceptedBody.version);
        assert.equal(secondController.review(fixture.run.runId).humanDecisions.length, 1);
      } finally {
        fixture.store.recordHumanDecisionOutcome = originalRecord;
        await firstServer.close();
        await secondServer?.close();
        await secondController.stop();
        await fixture.close();
      }
    });
  }
});

test("v0.1.1 split final-decision outcomes retain idempotent replay compatibility", async (t) => {
  for (const scenario of [
    { name: "ready contract", runId: "run_ui_legacy_ready_replay", cancellation: false },
    { name: "cancelled run", runId: "run_ui_legacy_cancel_replay", cancellation: true },
  ]) {
    await t.test(scenario.name, async () => {
      const fixture = await createReviewFixture({
        decisionCount: 1,
        runId: scenario.runId,
        includeCancellationOption: scenario.cancellation,
      });
      try {
        const selectedOption = scenario.cancellation
          ? fixture.decisions[0].options.find((option) => option.id.endsWith("_cancel"))
          : fixture.decisions[0].options[0];
        assert.notEqual(selectedOption, undefined);
        const idempotencyKey = `legacy-final-${scenario.runId}`;
        const decisionInput = {
          decisionId: fixture.decisions[0].decisionId,
          selectedOptionId: selectedOption.id,
          freeformOverride: null,
          rationale: null,
          expectedRunVersion: fixture.run.version,
          decidedAt: "2026-07-14T10:00:00.000Z",
        };

        // v0.1.1 persisted the answer first, then committed the derived outcome separately.
        const recorded = fixture.store.recordHumanDecision({
          idempotencyKey,
          runId: fixture.run.runId,
          decision: decisionInput,
        });
        let legacyOutcome;
        if (scenario.cancellation) {
          legacyOutcome = fixture.store.transitionRun(
            fixture.run.runId,
            "cancelled",
            recorded.run.version,
            "2026-07-14T10:01:00.000Z",
            "USER_CANCELLED",
          );
        } else {
          const comparison = fixture.store.getComparison(fixture.run.runId);
          const contract = createContractPreview({
            runId: fixture.run.runId,
            snapshot: fixture.store.getSnapshot(recorded.run.snapshotHash),
            plans: fixture.store.listPlanArtifacts(fixture.run.runId).map((item) => item.artifact),
            comparison: comparison.candidate,
            decisions: fixture.store.listDecisionPoints(fixture.run.runId),
            humanDecisions: fixture.store.listHumanDecisions(fixture.run.runId),
            comparatorModel: comparison.model,
            createdAt: "2026-07-14T10:01:00.000Z",
            version: fixture.store.nextContractVersion(fixture.run.runId),
          }).contract;
          legacyOutcome = fixture.store.saveContractAndReady(
            fixture.run.runId,
            contract,
            recorded.run.version,
            "2026-07-14T10:01:00.000Z",
          );
        }

        const replayed = fixture.controller.decide({
          runId: fixture.run.runId,
          decisionId: fixture.decisions[0].decisionId,
          selectedOptionId: selectedOption.id,
          freeformOverride: null,
          expectedVersion: fixture.run.version,
          idempotencyKey,
        });
        assert.deepEqual(replayed, legacyOutcome);
        assert.equal(fixture.controller.review(fixture.run.runId).humanDecisions.length, 1);

        const differentOption = fixture.decisions[0].options.find(
          (option) => option.id !== selectedOption.id,
        );
        assert.notEqual(differentOption, undefined);
        assert.throws(
          () =>
            fixture.controller.decide({
              runId: fixture.run.runId,
              decisionId: fixture.decisions[0].decisionId,
              selectedOptionId: differentOption.id,
              freeformOverride: null,
              expectedVersion: fixture.run.version,
              idempotencyKey,
            }),
          (error) => error?.code === "CONFLICTING_IDEMPOTENCY_KEY",
        );
      } finally {
        await fixture.close();
      }
    });
  }
});

test("review capability rejects archive races and closes when an SSE run disappears", async () => {
  const archiveFixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_archive_request_race",
  });
  const archiveServer = await startReviewServer({
    controller: archiveFixture.controller,
    runId: archiveFixture.run.runId,
    lifecyclePollMs: 1_000,
    closeGraceMs: 5,
  });
  try {
    archiveFixture.controller.archive(archiveFixture.run.runId);
    const response = await fetch(`${archiveServer.origin}/api/runs/${archiveFixture.run.runId}`, {
      headers: apiHeaders(archiveServer),
    });
    assert.equal(response.status, 410);
    assert.deepEqual(await archiveServer.closed, { reason: "archived" });
  } finally {
    await archiveServer.close();
    await archiveFixture.close();
  }

  const terminalFixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_terminal_request_race",
  });
  const terminalServer = await startReviewServer({
    controller: terminalFixture.controller,
    runId: terminalFixture.run.runId,
    lifecyclePollMs: 1_000,
    closeGraceMs: 5,
  });
  try {
    await terminalFixture.controller.cancel(terminalFixture.run.runId);
    const response = await fetch(`${terminalServer.origin}/api/runs/${terminalFixture.run.runId}`, {
      headers: apiHeaders(terminalServer),
    });
    assert.equal(response.status, 410);
    assert.deepEqual(await terminalServer.closed, { reason: "terminal_state" });
  } finally {
    await terminalServer.close();
    await terminalFixture.close();
  }

  const deletedFixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_deleted_sse_lifecycle",
  });
  const deletedServer = await startReviewServer({
    controller: deletedFixture.controller,
    runId: deletedFixture.run.runId,
    lifecyclePollMs: 5_000,
    closeGraceMs: 5,
  });
  try {
    const stream = await fetch(
      `${deletedServer.origin}/api/runs/${deletedFixture.run.runId}/events`,
      { headers: apiHeaders(deletedServer) },
    );
    const reader = stream.body.getReader();
    await reader.read();
    deletedFixture.controller.deleteRun(deletedFixture.run.runId);
    const result = await Promise.race([
      deletedServer.closed,
      delay(2_000).then(() => {
        throw new Error("deleted SSE run did not close");
      }),
    ]);
    assert.deepEqual(result, { reason: "run_unavailable" });
    await reader.cancel();
  } finally {
    await deletedServer.close();
    await deletedFixture.close();
  }

  const initialSendFixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_deleted_before_initial_sse",
  });
  let statusCalls = 0;
  const initialSendController = {
    claimReviewCapability(runId) {
      return initialSendFixture.controller.claimReviewCapability(runId);
    },
    isReviewCapabilityCurrent(runId, generation) {
      return initialSendFixture.controller.isReviewCapabilityCurrent(runId, generation);
    },
    status(runId) {
      statusCalls += 1;
      const status = initialSendFixture.controller.status(runId);
      if (statusCalls === 3) initialSendFixture.controller.deleteRun(runId);
      return status;
    },
  };
  const initialSendServer = await startReviewServer({
    controller: initialSendController,
    runId: initialSendFixture.run.runId,
    lifecyclePollMs: 5_000,
    closeGraceMs: 5,
  });
  try {
    const response = await fetch(
      `${initialSendServer.origin}/api/runs/${initialSendFixture.run.runId}/events`,
      { headers: apiHeaders(initialSendServer) },
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { code: "NOT_FOUND" });
    assert.equal(statusCalls, 3);
    assert.deepEqual(await initialSendServer.closed, { reason: "run_unavailable" });
  } finally {
    await initialSendServer.close();
    await initialSendFixture.close();
  }
});

test("archive revokes an in-flight review mutation before it can commit", async () => {
  const fixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_archive_slow_mutation",
  });
  let statusCalls = 0;
  let notifyRequestBoundary;
  const requestBoundaryReached = new Promise((resolve) => {
    notifyRequestBoundary = resolve;
  });
  const controller = new Proxy(fixture.controller, {
    get(target, property) {
      if (property === "status") {
        return (runId) => {
          statusCalls += 1;
          const status = target.status(runId);
          if (statusCalls === 3) notifyRequestBoundary();
          return status;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const server = await startReviewServer({
    controller,
    runId: fixture.run.runId,
    lifecyclePollMs: 5_000,
    closeGraceMs: 5,
  });
  try {
    const body = JSON.stringify({
      action: "select",
      selectedOptionId: fixture.decisions[0].options[0].id,
      expectedVersion: fixture.run.version,
    });
    const responsePromise = new Promise((resolve, reject) => {
      const url = new URL(
        `${server.origin}/api/runs/${fixture.run.runId}/decisions/${fixture.decisions[0].decisionId}`,
      );
      const request = httpRequest(
        url,
        {
          method: "POST",
          headers: {
            ...mutationHeaders(server, "archive-slow-mutation"),
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            }),
          );
        },
      );
      request.on("error", reject);
      const split = Math.floor(body.length / 2);
      request.write(body.slice(0, split));
      void requestBoundaryReached.then(() => {
        fixture.controller.archive(fixture.run.runId);
        request.end(body.slice(split));
      });
    });
    const response = await responsePromise;
    assert.equal(response.status, 410);
    assert.deepEqual(response.body, { code: "RUN_ARCHIVED" });
    assert.deepEqual(await server.closed, { reason: "archived" });
    const review = fixture.controller.review(fixture.run.runId);
    assert.equal(review.decisions[0].status, "unresolved");
    assert.equal(review.humanDecisions.length, 0);
    assert.throws(
      () =>
        fixture.controller.decide({
          runId: fixture.run.runId,
          decisionId: fixture.decisions[0].decisionId,
          selectedOptionId: fixture.decisions[0].options[0].id,
          freeformOverride: null,
          expectedVersion: fixture.run.version,
          idempotencyKey: "archive-atomic-guard",
          requireUnpinned: true,
        }),
      (error) => error?.code === "RUN_ARCHIVED",
    );
  } finally {
    await server.close();
    await fixture.close();
  }
});

test("authenticated request bodies time out without mutating review state", async () => {
  const fixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_request_body_timeout",
  });
  await assert.rejects(
    startReviewServer({
      controller: fixture.controller,
      runId: fixture.run.runId,
      requestBodyTimeoutMs: 0,
    }),
    /requestBodyTimeoutMs must be a positive integer/u,
  );
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
    requestBodyTimeoutMs: 20,
    closeGraceMs: 50,
  });
  const body = JSON.stringify({
    action: "select",
    selectedOptionId: fixture.decisions[0].options[0].id,
    expectedVersion: fixture.run.version,
  });
  const incomplete = openIncompleteJsonPost(
    `${server.origin}/api/runs/${fixture.run.runId}/decisions/${fixture.decisions[0].decisionId}`,
    mutationHeaders(server, "request-body-timeout"),
    body,
  );
  try {
    const result = await Promise.race([
      incomplete.settled,
      delay(1_000).then(() => {
        throw new Error("incomplete request body did not time out");
      }),
    ]);
    assert.notEqual(result.kind, "response");
    const review = fixture.controller.review(fixture.run.runId);
    assert.equal(review.decisions[0].status, "unresolved");
    assert.equal(review.humanDecisions.length, 0);
    const healthy = await fetch(`${server.origin}/api/runs/${fixture.run.runId}`, {
      headers: apiHeaders(server),
    });
    assert.equal(healthy.status, 200);
  } finally {
    incomplete.request.destroy();
    await server.close();
    await fixture.close();
  }
});

test("archive force-closes a never-finished authenticated POST within the close grace", async () => {
  const fixture = await createReviewFixture({
    decisionCount: 1,
    runId: "run_ui_archive_incomplete_post",
  });
  let statusCalls = 0;
  let notifyRequestBoundary;
  const requestBoundaryReached = new Promise((resolve) => {
    notifyRequestBoundary = resolve;
  });
  const controller = new Proxy(fixture.controller, {
    get(target, property) {
      if (property === "status") {
        return (runId) => {
          statusCalls += 1;
          const status = target.status(runId);
          if (statusCalls === 3) notifyRequestBoundary();
          return status;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const server = await startReviewServer({
    controller,
    runId: fixture.run.runId,
    requestBodyTimeoutMs: 10_000,
    lifecyclePollMs: 5_000,
    closeGraceMs: 20,
  });
  const body = JSON.stringify({
    action: "select",
    selectedOptionId: fixture.decisions[0].options[0].id,
    expectedVersion: fixture.run.version,
  });
  const incomplete = openIncompleteJsonPost(
    `${server.origin}/api/runs/${fixture.run.runId}/decisions/${fixture.decisions[0].decisionId}`,
    mutationHeaders(server, "archive-incomplete-post"),
    body,
  );
  try {
    await Promise.race([
      requestBoundaryReached,
      delay(1_000).then(() => {
        throw new Error("incomplete POST did not reach the authenticated request boundary");
      }),
    ]);
    fixture.controller.archive(fixture.run.runId);
    const archived = await fetch(`${server.origin}/api/runs/${fixture.run.runId}`, {
      headers: apiHeaders(server),
    });
    assert.equal(archived.status, 410);
    assert.deepEqual(await archived.json(), { code: "RUN_ARCHIVED" });
    const closed = await Promise.race([
      server.closed,
      delay(1_000).then(() => {
        throw new Error("archived review server stayed open on an incomplete POST");
      }),
    ]);
    assert.deepEqual(closed, { reason: "archived" });
    await Promise.race([
      incomplete.settled,
      delay(1_000).then(() => {
        throw new Error("forced connection close did not settle the incomplete POST");
      }),
    ]);
    const review = fixture.controller.review(fixture.run.runId);
    assert.equal(review.decisions[0].status, "unresolved");
    assert.equal(review.humanDecisions.length, 0);
  } finally {
    incomplete.request.destroy();
    await server.close();
    await fixture.close();
  }
});

test("recorded replay is labeled and rejects every mutation", async () => {
  const fixture = await createReviewFixture({ decisionCount: 1, runId: "run_ui_recorded" });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
    mode: "recorded",
  });
  const endpoint = `${server.origin}/api/runs/${fixture.run.runId}`;
  try {
    const review = await (await fetch(endpoint, { headers: apiHeaders(server) })).json();
    assert.equal(review.mode, "recorded");
    const response = await fetch(`${endpoint}/cancel`, {
      method: "POST",
      headers: mutationHeaders(server, "recorded-cancel"),
      body: JSON.stringify({ expectedVersion: review.version }),
    });
    assert.equal(response.status, 405);
    assert.deepEqual(await response.json(), { code: "RECORDED_REPLAY_READ_ONLY" });
    assert.equal(fixture.controller.status(fixture.run.runId).run.state, "needs_review");
  } finally {
    await server.close();
    await fixture.close();
  }
});
