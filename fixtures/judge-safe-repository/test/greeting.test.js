import assert from "node:assert/strict";
import test from "node:test";

import { greeting } from "../src/greeting.js";

test("greets a supplied name", () => {
  assert.equal(greeting("Ada"), "Hello, Ada!");
});
