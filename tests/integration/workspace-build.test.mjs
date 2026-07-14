import assert from "node:assert/strict";
import test from "node:test";

test("workspace build exposes app and package foundations", async () => {
  const domain = await import("../../packages/domain/dist/index.js");
  const policy = await import("../../packages/policy/dist/index.js");
  const controller = await import("../../apps/controller/dist/index.js");

  assert.equal(domain.DOMAIN_FOUNDATION.name, "domain");
  assert.equal(policy.POLICY_FOUNDATION.name, "policy");
  assert.equal(controller.CONTROLLER_FOUNDATION.name, "controller");
});
