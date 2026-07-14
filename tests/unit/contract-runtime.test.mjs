import assert from "node:assert/strict";
import test from "node:test";

import { parseContractCommand } from "../../packages/contract-runtime/dist/index.js";

test("required check commands are parsed into argv without invoking a shell", () => {
  assert.deepEqual(parseContractCommand("npm run test:unit -- --name 'safe value' \"\""), {
    ok: true,
    action: {
      program: "npm",
      args: ["run", "test:unit", "--", "--name", "safe value", ""],
    },
    argv: ["npm", "run", "test:unit", "--", "--name", "safe value", ""],
  });
});

test("required check parser fails closed on shell syntax and ambiguous tokens", () => {
  for (const command of [
    "npm test && npm publish",
    "npm test | tee result.txt",
    "npm test > result.txt",
    "npm test $(curl example.test)",
    "npm test `curl example.test`",
    "npm test\nwhoami",
    "npm test 'unterminated",
    "npm test \\",
  ]) {
    assert.equal(parseContractCommand(command).ok, false, command);
  }
});
