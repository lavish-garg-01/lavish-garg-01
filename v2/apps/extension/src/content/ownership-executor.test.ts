import assert from "node:assert/strict";
import test from "node:test";
import { FieldOwnershipTracker } from "./ownership.js";

test("execution ownership fails closed when the candidate owns a field", () => {
  const fieldRuntimeId = "field:12345678";
  const ownership = new FieldOwnershipTracker();
  ownership.markUserOwned(fieldRuntimeId);
  assert.equal(ownership.canAutomate(fieldRuntimeId), false);
});

test("Copilot ownership cannot overwrite a later candidate claim", () => {
  const fieldRuntimeId = "field:87654321";
  const ownership = new FieldOwnershipTracker();
  ownership.markCopilotOwned(fieldRuntimeId);
  assert.equal(ownership.canAutomate(fieldRuntimeId), true);
  ownership.markUserOwned(fieldRuntimeId);
  ownership.markCopilotOwned(fieldRuntimeId);
  assert.equal(ownership.ownershipOf(fieldRuntimeId), "USER_OWNED");
});
