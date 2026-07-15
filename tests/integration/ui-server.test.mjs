import assert from "node:assert/strict";
import test from "node:test";

import { startReviewServer } from "../../apps/ui/dist/index.js";
import { createReviewFixture } from "../helpers/review-fixture.mjs";

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

test("AC-003/006/017: Decision Inbox API is bounded, authenticated, and fail-closed", async () => {
  const fixture = await createReviewFixture({ decisionCount: 5, runId: "run_ui_security" });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
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
    const cancelledBody = await cancelled.json();
    const replayedCancel = await fetch(`${endpoint}/cancel`, {
      method: "POST",
      headers: mutationHeaders(server, "cancel-security-run"),
      body: cancelBody,
    });
    assert.equal(replayedCancel.status, 200);
    assert.deepEqual(await replayedCancel.json(), cancelledBody);
  } finally {
    await server.close();
    await fixture.close();
  }
});

test("contract decisions can be edited before explicit approval", async () => {
  const fixture = await createReviewFixture({ decisionCount: 1, runId: "run_ui_contract" });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
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
  } finally {
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
