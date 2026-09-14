import assert from "node:assert/strict";
import test from "node:test";
import { PrivateNoteRetries } from "./private-note.js";
import { createRequest, ExtensionRequestSchema } from "../shared/contracts.js";

test("private note retry identity binds answer, question and application", async () => {
  const retries = new PrivateNoteRetries();
  const snapshot = { question: "Unknown", answer: "Synthetic", application: "one" };
  assert.equal(await retries.id(snapshot), await retries.id(snapshot));
  assert.notEqual(await retries.id(snapshot), await retries.id({ ...snapshot, answer: "Changed" }));
  assert.notEqual(await retries.id(snapshot), await retries.id({ ...snapshot, application: "two" }));
  for (let i = 0; i < 197; i++) await retries.id({ i });
  await assert.rejects(retries.id({ overflow: true }), /limit/);
  assert.equal(await retries.id(snapshot), await retries.id(snapshot));
});

test("inbox messages cannot be downgraded to structural or telemetry transport", () => {
  const request = createRequest("CONTENT_INBOX_CAPTURE", "CONTENT", { pageInstanceId: crypto.randomUUID(), capture: { schemaVersion: 1, itemId: crypto.randomUUID(), applicationId: crypto.randomUUID(), applicationRunId: crypto.randomUUID(), question: "Unknown", answer: "Private", source: "EXPLICIT_SAVE" } });
  assert.equal(request.dataClass, "CANDIDATE_PRIVATE");
  assert.equal(ExtensionRequestSchema.safeParse(request).success, true);
  for (const dataClass of ["STRUCTURAL", "VALUE_FREE_TELEMETRY"]) assert.equal(ExtensionRequestSchema.safeParse({ ...request, dataClass }).success, false);
});
