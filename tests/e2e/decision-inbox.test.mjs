import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "@playwright/test";

import { startReviewServer } from "../../apps/ui/dist/index.js";
import { createReviewFixture, createStateFixture } from "../helpers/review-fixture.mjs";

test("AC-003/015: keyboard-only review, approval, and state announcements", async () => {
  const fixture = await createReviewFixture({ decisionCount: 1, runId: "run_ui_browser" });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requestOrigins = new Set();
  page.on("request", (request) => requestOrigins.add(new URL(request.url()).origin));
  try {
    await page.goto(server.url);
    await page.getByRole("heading", { name: "Decisions requiring review" }).waitFor();
    assert.equal(await page.getByRole("radio").count(), 2);
    assert.deepEqual(
      await page.getByRole("radio").evaluateAll((items) => items.map((item) => item.checked)),
      [false, false],
    );
    await page.getByRole("radio", { name: /Delete immediately/u }).focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Record decision" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Approve the bounded execution" }).waitFor();
    assert.equal(await page.getByRole("status").textContent(), "Contract is ready for approval");
    await page.getByRole("button", { name: "Approve contract" }).focus();
    await page.keyboard.press("Enter");
    await page.getByText("Contract approved", { exact: true }).last().waitFor();
    assert.equal(await page.getByRole("status").textContent(), "Contract approved");
    assert.equal(await page.getByText(/FULL PLAN SHOULD NOT LEAK/u).count(), 0);
    await page.getByText("Open full sanitized plan artifacts", { exact: true }).click();
    assert.equal(await page.getByText(/FULL PLAN SHOULD NOT LEAK/u).count(), 0);
    await page.getByRole("button", { name: "Load plan artifacts" }).click();
    await page
      .getByText(/FULL PLAN SHOULD NOT LEAK/u)
      .first()
      .waitFor();
    assert.deepEqual([...requestOrigins], [server.origin]);
  } finally {
    await page.close();
    await browser.close();
    await server.close();
    await fixture.close();
  }
});

test("AC-015: probe, pause, and completion states are announced", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    for (const [state, label] of [
      ["probing", "Planning probes are running"],
      ["paused", "Execution paused for review"],
      ["completed", "Execution completed"],
    ]) {
      const runId = `run_ui_state_${state}`;
      const fixture = await createStateFixture(state, runId);
      const server = await startReviewServer({ controller: fixture.controller, runId });
      try {
        await page.goto(server.url);
        await page.getByRole("status").waitFor();
        assert.equal(await page.getByRole("status").textContent(), label);
      } finally {
        await server.close();
        await fixture.close();
      }
    }
  } finally {
    await page.close();
    await browser.close();
  }
});

test("AC-006/015: review shows three blockers plus remaining count and supports cancel", async () => {
  const fixture = await createReviewFixture({ decisionCount: 5, runId: "run_ui_browser_cancel" });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(server.url);
    await page.getByRole("heading", { name: "Decisions requiring review" }).waitFor();
    assert.equal(await page.locator("article.decision-card").count(), 3);
    await page.getByText("3 shown · 2 remaining after these", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Approve contract" }).count(), 0);
    await page.getByRole("button", { name: "Cancel run" }).focus();
    await page.keyboard.press("Enter");
    await page.getByText("Run cancelled", { exact: true }).last().waitFor();
    assert.equal(await page.getByRole("status").textContent(), "Run cancelled");
  } finally {
    await page.close();
    await browser.close();
    await server.close();
    await fixture.close();
  }
});

test("recorded replay is visibly labeled and cannot mutate review state", async () => {
  const fixture = await createReviewFixture({ decisionCount: 1, runId: "run_ui_browser_recorded" });
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
    mode: "recorded",
  });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(server.url);
    await page.getByText("Recorded replay · read-only", { exact: true }).waitFor();
    assert.equal(await page.getByText(/does not call Codex or execute code/u).count(), 1);
    assert.deepEqual(
      await page
        .getByRole("radio")
        .evaluateAll((items) => items.map((item) => item.matches(":disabled"))),
      [true, true],
    );
    assert.equal(await page.getByRole("button", { name: "Cancel run" }).count(), 0);
    assert.equal(fixture.controller.status(fixture.run.runId).run.state, "needs_review");
  } finally {
    await page.close();
    await browser.close();
    await server.close();
    await fixture.close();
  }
});
