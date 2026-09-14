import assert from "node:assert/strict";
import test from "node:test";
import { AutofillProgressSchema, ContentCommandAckSchema, ExtensionRequestSchema, createRequest } from "./contracts.js";
import { failure } from "./errors.js";
import { TelemetryEventSchema } from "./telemetry.js";

test("typed message factory produces a versioned strict request", () => {
  const request = createRequest("UI_STATUS_REQUEST", "SIDEPANEL", {});
  assert.equal(request.protocolVersion, 1);
  assert.equal(request.source, "SIDEPANEL");
  assert.equal(request.type, "UI_STATUS_REQUEST");
});

test("autofill progress carries structural state, never candidate answers or raw labels", () => {
  const field = { fieldRuntimeId: "field:12345678", canonicalKey: "EMAIL", required: true, state: "COMPLETED", reason: null };
  const progress = { pageInstanceId: crypto.randomUUID(), phase: "REVIEW", fields: [field], containsCandidateValue: false };
  assert.equal(AutofillProgressSchema.safeParse(progress).success, true);
  for (const extra of [{ value: "private@example.test" }, { label: "private employer prompt" }]) {
    assert.equal(AutofillProgressSchema.safeParse({ ...progress, fields: [{ ...field, ...extra }] }).success, false);
  }
  assert.equal(AutofillProgressSchema.safeParse({ ...progress, containsCandidateValue: true }).success, false);
});

test("malformed and unknown extension messages are rejected", () => {
  assert.equal(ExtensionRequestSchema.safeParse({ type: "SCAN_ANYTHING", data: {} }).success, false);
  const valid = createRequest("UI_STATUS_REQUEST", "SIDEPANEL", {});
  assert.equal(ExtensionRequestSchema.safeParse({ ...valid, surprise: true }).success, false);
  assert.throws(() => createRequest("CONTENT_HELLO", "CONTENT", {
    pageInstanceId: crypto.randomUUID(),
    applicationKey: null,
    origin: "null",
    pathHash: "abcd1234",
    hasForms: false,
    frameKind: "CHILD",
    extensionVersion: "2.0.0"
  }));
});

test("telemetry rejects candidate-value shaped metadata", () => {
  const base = {
    schemaVersion: 1 as const,
    telemetryId: crypto.randomUUID(),
    eventType: "SCAN_COMPLETED" as const,
    occurredAt: new Date().toISOString(),
    applicationRunId: null,
    pageInstanceId: null,
    fieldRuntimeId: null,
    operationId: null,
    outcome: "RECORDED",
    durationMs: 12,
    valuePrivate: true as const,
    containsCandidateValue: false as const
  };
  assert.equal(TelemetryEventSchema.safeParse({ ...base, metadata: { fieldCount: 4 } }).success, true);
  assert.equal(TelemetryEventSchema.safeParse({ ...base, metadata: { candidateAnswer: "private" } }).success, false);
});

test("content command acknowledgements cannot hide a rejected command", () => {
  assert.equal(ContentCommandAckSchema.safeParse({ accepted: true }).success, true);
  const rejected = ContentCommandAckSchema.parse({
    accepted: false,
    failure: failure("FIELD_STALE", "The form changed before it could be filled.", { category: "STALE", retryable: true })
  });
  assert.equal(rejected.accepted, false);
  assert.equal(ContentCommandAckSchema.safeParse({ accepted: false }).success, false);
  assert.equal(ContentCommandAckSchema.safeParse({ accepted: true, failure: rejected.failure }).success, false);
});
