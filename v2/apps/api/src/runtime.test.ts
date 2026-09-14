import assert from "node:assert/strict";
import test from "node:test";
import { assertSupportedNodeRuntime } from "./runtime.js";

test("the API fails fast outside the Node 24 runtime contract", () => {
  assert.doesNotThrow(() => assertSupportedNodeRuntime("24.8.0"));
  assert.throws(() => assertSupportedNodeRuntime("20.19.5"), /requires Node 24\.x/i);
  assert.throws(() => assertSupportedNodeRuntime("25.0.0"), /requires Node 24\.x/i);
});
